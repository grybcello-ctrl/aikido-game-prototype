import type {
  Actor, FailureRules, Grade, JudgeReaction, Ms, Phase, ResolvedTimeline, ScheduledBeat, SequenceKey, TechniqueData,
} from '../types/technique';
import { EngineArgumentError, TechniqueDataError } from './errors';
import { judgeOffset } from './judge';
import { ScoreBoard } from './scoring';
import { assertProgressionCount, beatPhases, resolveTimeline } from './timeline';
import type {
  CueSource, EngineEvent, EngineListener, EngineResult, EngineSnapshot, EngineStatus, FailReason, IgnoreReason,
} from './types';
import { validateTechnique } from './validate';

/**
 * TimingEngine — 원버튼 타이밍 판정 상태 머신 (렌더링·프레임워크 비의존)
 *
 *  도입부(1) ─▶ 진행부(1..N) ─▶ 던지기(1) ─▶ 낙법(점수 비율로 Perfect/Good/Bad)
 *       └──── Miss 실패 규칙(abortOnMiss / maxConsecutiveMiss / failOnNoInput) ────▶ 실패
 *
 * 시간 모델
 * - 호출자가 준 시각(performance.now 계열 등)을 그대로 받는다. press(t) 는 큐에 쌓이고 update(now) 에서
 *   타임스탬프 순서대로 처리되므로, 판정 정밀도가 프레임 간격에 묶이지 않는다.
 * - 이벤트의 atMs 는 "엔진 로컬 시간" = start 시각 기준, 일시정지 구간 제외.
 * - 구간 경계는 포함(|d| ≤ 허용치). 구간 종료·페이즈 종료는 "그 시각을 지나야" 확정된다.
 */

export interface TimingEngineOptions {
  /** 진행부 횟수. 기본 repeat.default, repeat.min~max 범위 */
  progressionCount?: number;
  /** 데이터의 failure 규칙을 덮어쓰기. maxConsecutiveMiss: null = 제한 해제 */
  failure?: Omit<FailureRules, 'maxConsecutiveMiss'> & { maxConsecutiveMiss?: number | null };
  /** 리스너 예외 처리. 기본: 엔진 흐름은 계속하고 비동기로 다시 던짐 */
  onListenerError?: (error: unknown, event: EngineEvent) => void;
}

interface ResolvedFailure { abortOnMiss: ReadonlySet<string>; maxConsecutiveMiss: number | null; failOnNoInput: boolean }

type ItemKind = 'enter' | 'open' | 'cue' | 'close' | 'throwEnd' | 'ukemiEnd';
interface Item {
  kind: ItemKind;
  at: Ms;
  seq: number;
  beat?: number;
  actor?: Actor;
  key?: SequenceKey;
  source?: CueSource;
}
interface Queued { at: number; seq: number }

/** 마감형 이벤트: 해당 시각을 "지나야" 발생 (경계 시각 입력을 먼저 판정하기 위해) */
const STRICT: ReadonlySet<ItemKind> = new Set(['close', 'throwEnd', 'ukemiEnd']);
/** 같은 시각이면 마감 → 진입 → 큐 → 구간 열림 순 */
const ORDER: Record<ItemKind, number> = { close: 0, throwEnd: 1, ukemiEnd: 2, enter: 3, cue: 4, open: 5 };
const MAX_STEPS = 100_000;

const assertTime = (name: string, v: number): void => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new EngineArgumentError(`${name} 는 유한한 숫자(ms)여야 함 (받은 값: ${String(v)})`);
};

export class TimingEngine {
  readonly data: TechniqueData;
  private readonly listeners = new Set<EngineListener>();
  private readonly onListenerError: (error: unknown, event: EngineEvent) => void;
  private readonly baseFailure: ResolvedFailure;

  private timelineCache: ResolvedTimeline;
  private phases: Phase[] = [];
  private status: EngineStatus = 'idle';
  private origin = 0;
  private pauses: [number, number][] = [];
  private pausedAt: number | null = null;
  private lastUpdate = -Infinity;
  private now: Ms = 0;
  private items: Item[] = [];
  private seq = 0;
  private queue: Queued[] = [];
  private judged: boolean[] = [];
  private board: ScoreBoard;
  private failure: ResolvedFailure;
  private consecutiveMiss = 0;
  private presses = 0;
  private lockedUntil: Ms | null = null;
  private result: EngineResult | null = null;
  private outbox: EngineEvent[] = [];

  /**
   * @throws TechniqueDataError 데이터가 규칙을 위반하면 (문제 목록 포함)
   * @throws EngineArgumentError progressionCount 가 범위 밖이면
   */
  constructor(data: TechniqueData, private readonly options: TimingEngineOptions = {}) {
    const issues = validateTechnique(data);
    if (issues.length) throw new TechniqueDataError(typeof data?.id === 'string' ? data.id : '(unknown)', issues);
    this.data = data;
    this.onListenerError = options.onListenerError ?? ((e) => queueMicrotask(() => { throw e; }));
    this.baseFailure = this.resolveFailure(options.failure);
    this.failure = this.baseFailure;
    const n = options.progressionCount ?? data.phases[1].repeat.default;
    this.timelineCache = resolveTimeline(data, n);
    this.board = new ScoreBoard(data.scoring, this.timelineCache.beats);
  }

  // ───────────────────────────── public API ─────────────────────────────

  /** 이번 판 타임라인 (start 전에도 기본 N 기준으로 조회 가능) */
  get timeline(): ResolvedTimeline {
    return this.timelineCache;
  }

  on(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 기술 시작 (진행 중이어도 처음부터 다시 시작).
   * @param nowMs 호출자 시계의 현재 시각
   * @param progressionCount 이번 판 진행부 횟수 (생략 시 생성자 옵션 → repeat.default)
   */
  start(nowMs: number, progressionCount?: number): EngineEvent[] {
    assertTime('nowMs', nowMs);
    const n = progressionCount ?? this.options.progressionCount ?? this.data.phases[1].repeat.default;
    assertProgressionCount(this.data, n);

    this.timelineCache = resolveTimeline(this.data, n);
    this.phases = beatPhases(this.data, n).map((b) => b.phase);
    this.board = new ScoreBoard(this.data.scoring, this.timelineCache.beats);
    this.failure = this.baseFailure;
    this.status = 'running';
    this.origin = nowMs;
    this.pauses = [];
    this.pausedAt = null;
    this.lastUpdate = nowMs;
    this.now = 0;
    this.items = [];
    this.queue = [];
    this.judged = this.timelineCache.beats.map(() => false);
    this.consecutiveMiss = 0;
    this.presses = 0;
    this.lockedUntil = null;
    this.result = null;

    for (const b of this.timelineCache.beats) {
      this.schedule({ kind: 'enter', at: b.startMs, beat: b.index });
      this.schedule({ kind: 'open', at: b.window.bad[0], beat: b.index });
      this.schedule({ kind: 'close', at: b.window.bad[1], beat: b.index });
    }
    for (const c of this.timelineCache.cues)
      this.schedule({ kind: 'cue', at: c.absMs, beat: c.beatIndex, actor: c.actor, key: c.key, source: 'phase' });
    this.schedule({ kind: 'throwEnd', at: this.timelineCache.totalDurationMs });

    this.emit({ type: 'start', atMs: 0, progressionCount: n, totalDurationMs: this.timelineCache.totalDurationMs });
    this.advanceTo(0);
    return this.flush();
  }

  /**
   * 원버튼 입력 (터치 / 스페이스바). 실제 처리는 다음 update() 에서 타임스탬프 순으로.
   * @param atMs 입력이 발생한 시각 (KeyboardEvent.timeStamp 등, start 와 같은 시계)
   */
  press(atMs: number): void {
    assertTime('atMs', atMs);
    if (this.status === 'idle') {
      this.emit({ type: 'inputIgnored', atMs: null, reason: 'not_running' });
      return;
    }
    this.queue.push({ at: atMs, seq: this.seq++ });
  }

  /** 매 프레임 호출. 큐의 입력과 예약 이벤트(구간 열림/닫힘, 페이즈 전환, 큐)를 시간순 처리 */
  update(nowMs: number): EngineEvent[] {
    assertTime('nowMs', nowMs);
    this.step(nowMs);
    return this.flush();
  }

  /** update 본체 (flush 없음) — pause/abort 가 처리한 이벤트까지 한 번에 반환하기 위해 분리 */
  private step(nowMs: number): void {
    if (this.status === 'idle') return;
    const target = Math.max(nowMs, this.lastUpdate); // 시계가 뒤로 가도 되감지 않음
    this.lastUpdate = target;

    this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    let i = 0;
    for (; i < this.queue.length && (this.queue[i] as Queued).at <= target; i++) {
      const q = this.queue[i] as Queued;
      const { t, paused } = this.toLocal(q.at);
      this.advanceTo(t);
      if (paused) this.ignore('paused');
      else this.applyPress(t);
    }
    this.queue.splice(0, i);
    this.advanceTo(this.toLocal(target).t);
  }

  /** 일시정지. 이 시각 이후 입력은 무시되고 엔진 시간이 멈춘다 */
  pause(nowMs: number): EngineEvent[] {
    assertTime('nowMs', nowMs);
    if (this.status === 'idle' || this.status === 'finished' || this.pausedAt !== null) return this.flush();
    this.step(nowMs);
    this.pausedAt = Math.max(nowMs, this.lastUpdate);
    this.emit({ type: 'paused', atMs: this.now });
    return this.flush();
  }

  resume(nowMs: number): EngineEvent[] {
    assertTime('nowMs', nowMs);
    if (this.pausedAt === null) return this.flush();
    const end = Math.max(nowMs, this.pausedAt);
    this.pauses.push([this.pausedAt, end]);
    this.pausedAt = null;
    this.lastUpdate = Math.max(this.lastUpdate, end);
    this.emit({ type: 'resumed', atMs: this.now });
    return this.flush();
  }

  /** 진행 중 강제 종료 (플레이어 이탈 등) → 실패 처리 */
  abort(nowMs: number): EngineEvent[] {
    assertTime('nowMs', nowMs);
    if (this.status !== 'running') return this.flush();
    this.step(nowMs);
    if (this.status === 'running') this.fail({ type: 'aborted' });
    return this.flush();
  }

  getResult(): EngineResult | null {
    return this.result;
  }

  getState(): EngineSnapshot {
    const beats = this.timelineCache.beats;
    const t = this.now;
    const running = this.status !== 'idle';
    const cur = running ? beats.find((b) => t >= b.startMs && t < b.endMs) : undefined;
    const next = running ? beats.find((b) => !this.judged[b.index]) : undefined;
    const open = running && this.status === 'running'
      ? beats.find((b) => !this.judged[b.index] && t >= b.window.bad[0] && t <= b.window.bad[1])
      : undefined;
    return {
      status: this.status,
      paused: this.pausedAt !== null,
      nowMs: t,
      progressionCount: this.timelineCache.progressionCount,
      totalDurationMs: this.timelineCache.totalDurationMs,
      beatIndex: cur?.index ?? null,
      nextJudgeBeat: this.status === 'running' ? next?.index ?? null : null,
      openWindowBeat: open?.index ?? null,
      score: this.board.snapshot(),
      consecutiveMiss: this.consecutiveMiss,
      presses: this.presses,
      lockedUntilMs: this.lockedUntil !== null && this.lockedUntil > t ? this.lockedUntil : null,
      result: this.result,
    };
  }

  // ───────────────────────────── clock ─────────────────────────────

  /** 호출자 시각 → 엔진 로컬 시간. 일시정지 구간 안이면 paused */
  private toLocal(abs: number): { t: Ms; paused: boolean } {
    let off = this.origin;
    for (const [s, e] of this.pauses) {
      if (abs < s) break;
      if (abs < e) return { t: s - off, paused: true };
      off += e - s;
    }
    if (this.pausedAt !== null && abs >= this.pausedAt) return { t: this.pausedAt - off, paused: true };
    return { t: abs - off, paused: false };
  }

  // ───────────────────────────── scheduler ─────────────────────────────

  private schedule(item: Omit<Item, 'seq'>): void {
    this.items.push({ ...item, seq: this.seq++ });
  }

  private isDue(it: Item, t: Ms): boolean {
    return STRICT.has(it.kind) ? it.at < t : it.at <= t;
  }

  /** t 시점까지 도래한 예약 이벤트를 순서대로 발생 */
  private advanceTo(t: Ms): void {
    for (let step = 0; ; step++) {
      if (step > MAX_STEPS) throw new Error('[TimingEngine] 스케줄러가 수렴하지 않음');
      let best = -1;
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i] as Item;
        if (!this.isDue(it, t)) continue;
        const b = best >= 0 ? (this.items[best] as Item) : null;
        if (!b || it.at < b.at || (it.at === b.at && (ORDER[it.kind] - ORDER[b.kind] || it.seq - b.seq) < 0)) best = i;
      }
      if (best < 0) break;
      const [it] = this.items.splice(best, 1) as [Item];
      this.now = Math.max(this.now, it.at);
      this.fire(it);
      this.maybeFinishAftermath();
    }
    this.now = Math.max(this.now, t);
  }

  private fire(it: Item): void {
    const beat = it.beat !== undefined ? this.timelineCache.beats[it.beat] : undefined;
    switch (it.kind) {
      case 'enter':
        if (beat) this.emit({
          type: 'phaseEnter', atMs: it.at, beatIndex: beat.index,
          phaseType: beat.phaseType, phaseId: beat.phaseId, iteration: beat.iteration,
        });
        break;
      case 'open':
        if (beat) this.emit({ type: 'windowOpen', atMs: it.at, beatIndex: beat.index, perfectAtMs: beat.perfectAtMs, closeAtMs: beat.window.bad[1] });
        break;
      case 'cue':
        this.emit({ type: 'cue', atMs: it.at, actor: it.actor as Actor, key: it.key as SequenceKey, beatIndex: it.beat ?? null, source: it.source ?? 'phase' });
        break;
      case 'close':
        // 구간이 끝날 때까지 입력 없음 → Miss (판정 시각 = 구간 종료)
        if (beat && !this.judged[beat.index] && this.status === 'running') this.judge(beat, 'miss', null, it.at, 0);
        break;
      case 'throwEnd':
        if (this.status === 'running') this.startUkemi(it.at);
        break;
      case 'ukemiEnd':
        if (this.status === 'ukemi') this.finish(it.at);
        break;
    }
  }

  // ───────────────────────────── input ─────────────────────────────

  private ignore(reason: IgnoreReason, lockedUntilMs?: Ms): void {
    this.emit({ type: 'inputIgnored', atMs: this.now, reason, ...(lockedUntilMs !== undefined ? { lockedUntilMs } : {}) });
  }

  /** @param t 입력의 엔진 로컬 시각 (처리 커서보다 이르면 커서로 당겨 처리) */
  private applyPress(t: Ms): void {
    const at = Math.max(t, this.now);
    const clampedMs = at - t;
    if (this.status !== 'running') return this.ignore('not_running');
    this.presses++;
    if (this.lockedUntil !== null && at < this.lockedUntil) return this.ignore('lockout', this.lockedUntil);

    let hitJudged = false;
    for (const b of this.timelineCache.beats) {
      const [from, to] = b.window.bad;
      if (at < from || at > to) continue;
      if (this.judged[b.index]) {
        hitJudged = true;
        continue;
      }
      const d = at - b.perfectAtMs;
      const grade = judgeOffset((this.phases[b.index] as Phase).window, d) ?? 'bad';
      this.judge(b, grade, d, at, clampedMs);
      return;
    }
    if (hitJudged) return this.ignore('already_judged');
    const lockout = this.data.input?.lockoutMs ?? 0;
    if (lockout > 0) {
      this.lockedUntil = at + lockout;
      return this.ignore('outside_window', this.lockedUntil);
    }
    this.ignore('outside_window');
  }

  // ───────────────────────────── judgement ─────────────────────────────

  private judge(beat: ScheduledBeat, grade: Grade, offsetMs: Ms | null, at: Ms, clampedMs: Ms): void {
    this.judged[beat.index] = true;
    const rec = this.board.add(beat.index, grade, offsetMs);
    this.emit({
      type: 'judge', atMs: at, beatIndex: beat.index, phaseType: beat.phaseType, phaseId: beat.phaseId,
      iteration: beat.iteration, grade, offsetMs, points: rec.points, totalScore: this.board.total, clampedMs,
    });

    const reaction = (this.phases[beat.index] as Phase).onJudge?.[grade];
    if (reaction) this.applyReaction(beat, reaction, at);

    // 실패 규칙
    this.consecutiveMiss = grade === 'miss' ? this.consecutiveMiss + 1 : 0;
    if (grade !== 'miss') return;
    const f = this.failure;
    if (f.abortOnMiss.has(beat.phaseType)) {
      this.fail({ type: 'miss_abort', phaseType: beat.phaseType, phaseId: beat.phaseId, beatIndex: beat.index });
    } else if (f.maxConsecutiveMiss !== null && this.consecutiveMiss >= f.maxConsecutiveMiss) {
      this.fail({ type: 'consecutive_miss', count: this.consecutiveMiss, beatIndex: beat.index });
    } else if (f.failOnNoInput && this.judged.every(Boolean) && this.board.snapshot().counts.miss === this.judged.length) {
      this.fail({ type: 'no_input', presses: this.presses });
    }
  }

  /** onJudge 반응: 판정 시각 기준 큐 예약, replaceRemaining 이면 해당 actor 의 남은 기본 큐 취소 */
  private applyReaction(beat: ScheduledBeat, r: JudgeReaction, at: Ms): void {
    if (r.replaceRemaining) {
      const actors = new Set(r.cues.map((c) => c.actor));
      this.items = this.items.filter((it) => {
        const cancel = it.kind === 'cue' && it.source === 'phase' && it.beat === beat.index && actors.has(it.actor as Actor);
        if (cancel) this.emit({
          type: 'cueCancelled', atMs: at, actor: it.actor as Actor, key: it.key as SequenceKey, beatIndex: beat.index, scheduledAtMs: it.at,
        });
        return !cancel;
      });
    }
    for (const c of r.cues)
      this.schedule({ kind: 'cue', at: at + c.atMs, beat: beat.index, actor: c.actor, key: c.key, source: 'reaction' });
  }

  // ───────────────────────────── outcomes ─────────────────────────────

  private fail(reason: FailReason): void {
    this.status = 'failed';
    // 실패를 일으킨 판정의 반응 큐만 남기고 나머지 예약(판정·기본 큐·던지기 종료) 취소
    this.items = this.items.filter((it) => it.kind === 'cue' && it.source === 'reaction');
    const score = this.board.snapshot();
    this.result = {
      outcome: 'failed', reason, score, judgements: this.board.judgements,
      progressionCount: this.timelineCache.progressionCount, failedAtMs: this.now,
    };
    this.emit({ type: 'fail', atMs: this.now, reason, score });
    this.maybeFinishAftermath();
  }

  /** 던지기 페이즈 종료: 최종 점수 비율로 낙법 결정 → 낙법 시퀀스 예약 */
  private startUkemi(at: Ms): void {
    const summary = this.board.summarize(this.data.ukemi.thresholds);
    const res = this.data.ukemi.results[summary.ukemi];
    this.status = 'ukemi';
    this.result = {
      outcome: 'success', ukemi: summary.ukemi, score: summary, judgements: this.board.judgements,
      progressionCount: this.timelineCache.progressionCount, decidedAtMs: at,
    };
    this.emit({ type: 'ukemi', atMs: at, grade: summary.ukemi, score: summary, durationMs: res.durationMs });
    for (const c of res.animations) this.schedule({ kind: 'cue', at: at + c.atMs, actor: c.actor, key: c.key, source: 'ukemi' });
    this.schedule({ kind: 'ukemiEnd', at: at + res.durationMs });
  }

  private maybeFinishAftermath(): void {
    if (this.status === 'failed' && this.items.length === 0) this.finish(this.now);
  }

  private finish(at: Ms): void {
    this.status = 'finished';
    this.items = [];
    this.queue = [];
    if (this.result) this.emit({ type: 'finish', atMs: at, result: this.result });
  }

  private resolveFailure(o: TimingEngineOptions['failure']): ResolvedFailure {
    const d = this.data.failure ?? {};
    const max = o && 'maxConsecutiveMiss' in o ? o.maxConsecutiveMiss : d.maxConsecutiveMiss;
    if (max !== undefined && max !== null && !(Number.isInteger(max) && max >= 1))
      throw new EngineArgumentError(`failure.maxConsecutiveMiss 는 1 이상 정수 또는 null (받은 값: ${max})`);
    return {
      abortOnMiss: new Set(o?.abortOnMiss ?? d.abortOnMiss ?? []),
      maxConsecutiveMiss: max ?? null,
      failOnNoInput: o?.failOnNoInput ?? d.failOnNoInput ?? true,
    };
  }

  // ───────────────────────────── events ─────────────────────────────

  private emit(e: EngineEvent): void {
    this.outbox.push(e);
  }

  /** 리스너는 호출 종료 시점에 일괄 호출 → 리스너 안에서 press() 등을 불러도 재진입 안전 */
  private flush(): EngineEvent[] {
    const out = this.outbox;
    this.outbox = [];
    for (const e of out)
      for (const fn of this.listeners) {
        try {
          fn(e);
        } catch (err) {
          this.onListenerError(err, e);
        }
      }
    return out;
  }
}
