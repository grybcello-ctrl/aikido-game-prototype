import { computeTotalDuration } from '../engine/timeline';
import type {
  Actor, AnimationCue, JudgeWindow, ProgressionPhase, ProgressionStep, TechniqueData, UkemiGrade, WindowTier,
} from '../types/technique';
import { clone } from './skillPack';

/**
 * 에디터 폼 ↔ TechniqueData 변환 도우미 (DOM 비의존 — 노드 스크립트로도 검사 가능).
 */

export const TIERS = ['perfect', 'good', 'bad'] as const;
export type Tier = (typeof TIERS)[number];
export const UKEMI_GRADES: UkemiGrade[] = ['perfect', 'good', 'bad'];
export const ID_PATTERN = /^[a-z0-9_]+$/;
export const KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

// ───────────────────────────── 판정 윈도우 ─────────────────────────────

export const tierPair = (t: WindowTier | undefined): { early: number; late: number } =>
  typeof t === 'number' ? { early: t, late: t } : { early: t?.early ?? 0, late: t?.late ?? 0 };

/** 앞뒤가 같으면 숫자(대칭)로, 다르면 {early, late} 로 저장 */
export const makeTier = (early: number, late: number): WindowTier => (early === late ? early : { early, late });

/** 판정 구간(페이즈 시작 기준 ms) */
export const windowRanges = (perfectMs: number, w: JudgeWindow): Record<Tier, [number, number]> => {
  const r = {} as Record<Tier, [number, number]>;
  for (const k of TIERS) {
    const { early, late } = tierPair(w[k]);
    r[k] = [perfectMs - early, perfectMs + late];
  }
  return r;
};

// ───────────────────────────── 진행부 회차 ─────────────────────────────

/** 폼에 보여 줄 진행부 회차 목록. steps 가 없으면 repeat.default 개를 공통 타이밍으로 펼친다 (데이터는 그대로) */
export const viewSteps = (p: ProgressionPhase): ProgressionStep[] =>
  p.steps?.length
    ? p.steps
    : Array.from({ length: p.repeat.default }, () => ({ durationMs: p.durationMs, perfectMs: p.perfectMs, window: clone(p.window) }));

/**
 * 진행부 회차를 편집 가능한 steps 로 확정 (처음 편집할 때 1회).
 * 이후 기본 N = 회차 수, 랜덤 범위(min~max)는 회차 수를 포함하도록 넓힌다.
 */
export const materializeSteps = (p: ProgressionPhase): ProgressionStep[] => {
  if (!p.steps?.length) p.steps = viewSteps(p).map((s) => clone(s));
  syncProgression(p);
  return p.steps;
};

/** 회차 수가 바뀐 뒤: repeat.default = 회차 수, 공통 타이밍 = 1회차 (스키마 필수 필드 유지) */
export const syncProgression = (p: ProgressionPhase): void => {
  const steps = p.steps;
  if (!steps?.length) return;
  const n = steps.length;
  p.repeat = { min: Math.min(p.repeat.min, n), max: Math.max(p.repeat.max, n), default: n };
  const first = steps[0]!;
  p.durationMs = first.durationMs;
  p.perfectMs = first.perfectMs;
  p.window = clone(first.window);
};

// ───────────────────────────── 총 시간 ─────────────────────────────

/** 기술 총 시간 = 도입 + 진행부 회차 합(N = default) + 던지기. 구조가 깨져 있으면 null */
export const totalOf = (t: TechniqueData): number | null => {
  try {
    const v = computeTotalDuration(t, t.phases[1].repeat.default);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
};

/** totalDurationMs 를 페이즈 합으로 다시 맞춤 (폼 값이 바뀔 때마다) */
export const syncTotal = (t: TechniqueData): void => {
  const v = totalOf(t);
  if (v !== null && v > 0) t.totalDurationMs = v;
};

/** "900 + (600+600+600) + 800" */
export const totalBreakdown = (t: TechniqueData): string => {
  const [a, p, c] = t.phases;
  const steps = viewSteps(p);
  const n = p.repeat.default;
  const prog = Array.from({ length: n }, (_, i) => steps[i % steps.length]?.durationMs ?? p.durationMs);
  return `도입 ${a.durationMs} + 진행 (${prog.join(' + ')}) + 던지기 ${c.durationMs}`;
};

/**
 * 총 시전 시간 변경 → 모든 페이즈·회차의 길이, 퍼펙트 시각, 큐 시각을 같은 비율로 늘이거나 줄임.
 * 판정 윈도우(오차 ms)는 그대로 — 손맛(허용 오차)은 유지하고 템포만 바꾼다. 반올림 오차는 던지기에서 흡수.
 */
export const scaleTechnique = (t: TechniqueData, newTotal: number): void => {
  const old = totalOf(t);
  if (!old || !(newTotal > 0)) return;
  const f = newTotal / old;
  const sc = (v: number) => Math.max(0, Math.round(v * f));
  const scaleCues = (cues: AnimationCue[] | undefined, dur: number) =>
    cues?.forEach((c) => { c.atMs = Math.min(sc(c.atMs), Math.max(0, dur - 1)); });
  const scaleTiming = (x: { durationMs: number; perfectMs: number; animations?: AnimationCue[] }) => {
    x.durationMs = Math.max(1, sc(x.durationMs));
    x.perfectMs = Math.min(sc(x.perfectMs), x.durationMs);
    scaleCues(x.animations, x.durationMs);
  };
  const [intro, prog, thr] = t.phases;
  scaleTiming(intro);
  scaleTiming(thr);
  if (prog.steps?.length) {
    prog.steps.forEach(scaleTiming);
    // 공통 animations 는 회차 길이 기준으로만 비율 조정
    scaleCues(prog.animations, Math.min(...prog.steps.map((s) => s.durationMs)));
    syncProgression(prog);
  } else {
    scaleTiming(prog);
  }
  const now = totalOf(t) ?? newTotal;
  thr.durationMs = Math.max(1, thr.durationMs + (newTotal - now));
  thr.perfectMs = Math.min(thr.perfectMs, thr.durationMs);
  syncTotal(t);
};

// ───────────────────────────── 이미지 슬롯 ─────────────────────────────

/** 슬롯 = 이 큐 목록에서 actor 의 0ms 큐 (페이즈 시작 · 낙법 시작 때 재생할 이미지) */
export const slotCue = (cues: AnimationCue[], actor: Actor): AnimationCue | undefined =>
  cues.find((c) => c.actor === actor && c.atMs === 0) ?? cues.find((c) => c.actor === actor);

export const setSlotKey = (cues: AnimationCue[], actor: Actor, key: string): void => {
  const c = cues.find((x) => x.actor === actor && x.atMs === 0);
  if (c) c.key = key;
  else cues.unshift({ atMs: 0, actor, key });
};

/** 슬롯 외의 큐 (같은 actor 의 나중 큐 등) — 폼에서 "추가 큐" 로 표시 */
export const extraCues = (cues: AnimationCue[], actor: Actor): AnimationCue[] => {
  const main = cues.find((x) => x.actor === actor && x.atMs === 0);
  return cues.filter((c) => c.actor === actor && c !== main);
};

// ───────────────────────────── 새 기술 ─────────────────────────────

const W = (perfect: WindowTier, good: WindowTier, bad: WindowTier): JudgeWindow => ({ perfect, good, bad });

/** 고유 ID: skill_1, skill_2 … */
export const uniqueId = (base: string, taken: Set<string>): string => {
  const b = base.replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'skill';
  if (!taken.has(b)) return b;
  for (let i = 2; ; i++) if (!taken.has(`${b}_${i}`)) return `${b}_${i}`;
};

export const nextSkillId = (taken: Set<string>): string => {
  for (let i = 1; ; i++) if (!taken.has(`skill_${i}`)) return `skill_${i}`;
};

/**
 * [+ 새 기술 추가] 기본값: 바로 TEST 가능한 최소 기술 (도입 → 진행 1회 → 던지기 → 낙법).
 * 이름은 비워 두어 사용자가 처음부터 채우게 한다 (이름이 비면 검증에서 알려 줌).
 */
export const newTechnique = (taken: Set<string>): TechniqueData => {
  const t: TechniqueData = {
    $schema: '../../schema/technique.schema.json',
    schemaVersion: 1,
    id: nextSkillId(taken),
    name: '',
    description: '',
    totalDurationMs: 2300,
    input: { lockoutMs: 150 },
    spacing: { startPx: 56, moveMs: 120, slackPx: { good: 4, bad: 10 } },
    phases: [
      {
        type: 'intro', id: 'intro', label: '도입부',
        durationMs: 900, perfectMs: 600, window: W(50, 100, 150), weight: 1,
        animations: [{ atMs: 0, actor: 'tori', key: 'tori.kamae' }, { atMs: 0, actor: 'uke', key: 'uke.shomen_windup' }],
        onJudge: { perfect: { cues: [{ atMs: 0, actor: 'fx', key: 'fx.musubi_flash' }] } },
        spacing: { targetPx: 40, anchor: 'tori' },
      },
      {
        type: 'progression', id: 'progression', label: '진행부',
        durationMs: 600, perfectMs: 400, window: W(40, 80, 130), weight: 1,
        repeat: { min: 1, max: 1, default: 1 },
        steps: [{ durationMs: 600, perfectMs: 400, window: W(40, 80, 130) }],
        animations: [{ atMs: 0, actor: 'tori', key: 'tori.tenkan_lead' }, { atMs: 0, actor: 'uke', key: 'uke.drawn_spiral' }],
        onJudge: { perfect: { cues: [{ atMs: 0, actor: 'fx', key: 'fx.kuzushi_ring' }] } },
        spacing: { deltaPx: -3, anchor: 'center' },
      },
      {
        type: 'throw', id: 'throw', label: '던지기',
        durationMs: 800, perfectMs: 500, window: W(50, 100, 150), weight: 2,
        animations: [{ atMs: 0, actor: 'tori', key: 'tori.throw_cut' }, { atMs: 0, actor: 'uke', key: 'uke.thrown' }],
        onJudge: {
          perfect: {
            cues: [
              { atMs: 0, actor: 'tori', key: 'tori.throw_perfect' },
              { atMs: 0, actor: 'uke', key: 'uke.ukemi_perfect_air' },
              { atMs: 0, actor: 'fx', key: 'fx.impact_flash' },
            ],
          },
        },
        spacing: { targetPx: 22, anchor: 'tori', moveMs: 90 },
      },
    ],
    scoring: { points: { perfect: 100, good: 60, bad: 20, miss: 0 } },
    failure: { abortOnMiss: [], maxConsecutiveMiss: 3, failOnNoInput: true },
    ukemi: {
      thresholds: { perfect: 0.85, good: 0.55 },
      results: {
        perfect: {
          label: '완벽한 낙법', durationMs: 900,
          animations: [{ atMs: 0, actor: 'tori', key: 'tori.zanshin' }, { atMs: 0, actor: 'uke', key: 'uke.ukemi_back_roll' }],
          spacing: { targetPx: 84, anchor: 'uke', moveMs: 360 },
        },
        good: {
          label: '흐트러진 낙법', durationMs: 900,
          animations: [{ atMs: 0, actor: 'tori', key: 'tori.zanshin' }, { atMs: 0, actor: 'uke', key: 'uke.ukemi_sloppy' }],
          spacing: { targetPx: 70, anchor: 'uke', moveMs: 300 },
        },
        bad: {
          label: '낙법 실패', durationMs: 1100,
          animations: [{ atMs: 0, actor: 'tori', key: 'tori.zanshin' }, { atMs: 0, actor: 'uke', key: 'uke.ukemi_crash' }],
          spacing: { targetPx: 52, anchor: 'uke', moveMs: 200 },
        },
      },
    },
  };
  syncTotal(t);
  return t;
};

/** 복제: 새 ID + " (복사)" */
export const duplicateTechnique = (t: TechniqueData, taken: Set<string>): TechniqueData => {
  const c = clone(t);
  c.id = uniqueId(`${t.id}_copy`, taken);
  c.name = `${t.name || c.id} (복사)`;
  return c;
};
