import { SPRITES } from '../art/sprites.generated';
import type { EngineEvent } from '../engine/types';
import { validateTechnique } from '../engine/validate';
import { isTypingTarget } from '../input/oneButton';
import { CHAR_FRAME, TORI_PALETTE, UKE_PALETTE, drawFigure } from '../render/placeholderArt';
import type { AnimationManifest, PoseHint } from '../types/animations';
import type {
  AnimationCue, Grade, IntroPhase, JudgeWindow, ProgressionPhase, ProgressionStep, ResolvedTimeline, TechniqueData, ThrowPhase, UkemiGrade,
} from '../types/technique';
import { copyText, downloadText, h, loadImage, readDataUri } from './dom';
import { EDITOR_CSS } from './editorStyles';
import {
  CUSTOM_SEQ_PREFIX, assetKeyFor, clone, cuesOf, emptyPack, exportPackJson, loadPack, parsePack, prunePack, savePack, type SkillPack,
} from './skillPack';
import {
  ID_PATTERN, KEY_PATTERN, TIERS, UKEMI_GRADES, duplicateTechnique, extraCues, makeTier, materializeSteps, newTechnique,
  scaleTechnique, setSlotKey, slotCue, syncProgression, syncTotal, tierPair, totalBreakdown, totalOf, uniqueId, viewSteps, windowRanges,
} from './techniqueTemplate';

/** 에디터 ↔ Phaser 연결 (EditorScene 이 구현) */
export interface DevEditorHost {
  /** 팩이 비었을 때 / "기본 기술로 초기화" 때 쓰는 기본 기술 */
  builtins: TechniqueData[];
  /** 기본 애니메이션 매니페스트 (Key 자동완성·미리보기) */
  manifest: AnimationManifest;
  /** TEST: 폼 데이터를 TimingEngine 에 주입해 가운데 캔버스에서 재생 */
  onTest: (technique: TechniqueData, pack: SkillPack, progressionCount: number) => void;
  /** STOP: 테스트 종료 → 대기 화면 */
  onStop: () => void;
  /** ← 타이틀 */
  onExit: () => void;
}

type Timing = { durationMs: number; perfectMs: number; window: JudgeWindow };
type Slot = 'tori' | 'uke';

const GRADE_LABEL: Record<Grade, string> = { perfect: 'PERFECT', good: 'GOOD', bad: 'BAD', miss: 'MISS' };
const UKEMI_LABEL: Record<UkemiGrade, string> = { perfect: 'Perfect', good: 'Good', bad: 'Bad' };
const TIER_LABEL = { perfect: 'Perfect', good: 'Good', bad: 'Bad' } as const;
const IGNORE_TEXT: Record<string, string> = {
  outside_window: '판정 구간 밖 입력', lockout: '연타 잠금 중 입력', already_judged: '이미 판정된 구간', not_running: '재생 중 아님', paused: '일시정지 중',
};
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const LOG_LIMIT = 300;

/**
 * 개발자 모드 — HTML DOM 오버레이 기술 에디터.
 *
 * ┌ 상단 바: 제목 · 자동 저장 상태 · Import · Export JSON · ← 타이틀 ────────────────┐
 * │ 좌: 기술 목록 + [+ 새 기술 추가] │ 가운데: Phaser 캔버스(TEST 재생) │ 우: 세부 기술 세팅 폼 │
 * │                                  │ 아래: ▶ TEST · ■ STOP · N · 판정 로그 │                      │
 * └──────────────────────────────────────────────────────────────────────────────────┘
 *
 * 입력 충돌 방지
 *   - 패널과 캔버스는 서로 겹치지 않는 사각형 (editorStyles.ts 참고) → 클릭이 섞이지 않음
 *   - 게임의 Space / 단축키는 글자 입력 요소(input · textarea · select)에 포커스가 있으면 무시 (isTypingTarget)
 *   - 테스트 중 버튼에 포커스가 남아 있으면 Space 가 버튼을 다시 누르지 않도록 기본 동작을 막고 포커스를 뺀다
 */
export class DevEditor {
  private pack: SkillPack;
  private sel = 0;
  private running = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshers: (() => void)[] = [];
  private thumbCache = new Map<string, string>();
  private cleanups: (() => void)[] = [];

  private root!: HTMLDivElement;
  private listEl!: HTMLUListElement;
  private listCount!: HTMLElement;
  private formEl!: HTMLDivElement;
  private logEl!: HTMLOListElement;
  private saveEl!: HTMLElement;
  private runEl!: HTMLElement;
  private testBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private nSelect!: HTMLSelectElement;
  private changedEl!: HTMLElement;
  private toriKeys!: HTMLDataListElement;
  private ukeKeys!: HTMLDataListElement;

  constructor(private readonly host: DevEditorHost) {
    this.pack = loadPack() ?? emptyPack(host.builtins);
  }

  get isMounted(): boolean {
    return !!this.root?.isConnected;
  }

  /** 현재 선택된 기술 */
  private get cur(): TechniqueData | undefined {
    return this.pack.techniques[this.sel];
  }

  // ───────────────────────────── 생명주기 ─────────────────────────────

  mount(): void {
    if (this.isMounted) return;
    if (!document.getElementById('dev-editor-style')) document.head.append(h('style', { id: 'dev-editor-style' }, EDITOR_CSS));
    this.root = this.build();
    document.body.append(this.root);
    document.body.classList.add('dev-mode');
    this.installKeyGuards();
    this.renderList();
    this.renderForm();
    this.setRunning(false);
    this.log('개발자 모드 — 왼쪽에서 기술을 고르거나 [+ 새 기술 추가] → 오른쪽 폼에서 세팅 → ▶ TEST', 'sys');
  }

  unmount(): void {
    this.flushSave();
    this.cleanups.forEach((f) => f());
    this.cleanups = [];
    this.root?.remove();
    document.body.classList.remove('dev-mode');
  }

  /** 테스트 재생 상태 (EditorScene 이 Stop / 종료 때 호출) */
  setRunning(on: boolean): void {
    this.running = on;
    if (!this.isMounted) return;
    this.stopBtn.disabled = !on;
    this.testBtn.textContent = on ? '▶ RE-TEST' : '▶ TEST';
    this.runEl.textContent = on ? '● 테스트 중 — Space / 화면 클릭 = 입력 · Esc = 정지' : '대기 중';
    this.runEl.className = on ? 'dev-running' : 'hint';
    if (!on) this.changedEl.textContent = '';
  }

  /** GameScene(embedded) 이 보내는 엔진 이벤트 → 판정 로그 */
  readonly onEngineEvent = (e: EngineEvent, tl: ResolvedTimeline): void => {
    switch (e.type) {
      case 'start':
        this.log(`── 라운드 시작 · 진행 ×${e.progressionCount} · 총 ${e.totalDurationMs}ms ──`, 'sys');
        break;
      case 'judge': {
        const b = tl.beats[e.beatIndex];
        const where = e.phaseType === 'intro' ? 'P1 도입' : e.phaseType === 'throw' ? 'P3 던지기' : `P2 진행 #${(b?.iteration ?? e.iteration) + 1}`;
        const off = e.offsetMs === null ? '입력 없음' : `${e.offsetMs >= 0 ? '+' : ''}${Math.round(e.offsetMs)}ms ${e.offsetMs < 0 ? '(빠름)' : e.offsetMs > 0 ? '(늦음)' : ''}`;
        this.log(`${where.padEnd(10)} ${GRADE_LABEL[e.grade].padEnd(8)} ${off}   +${e.points}점`, e.grade);
        break;
      }
      case 'inputIgnored':
        if (e.reason !== 'not_running') this.log(`  · ${IGNORE_TEXT[e.reason] ?? e.reason}`, 'sys');
        break;
      case 'ukemi':
        this.log(`낙법 ${UKEMI_LABEL[e.grade].toUpperCase()} · ${Math.round(e.score.ratio * 100)}% (${e.score.raw} / ${e.score.max})`, 'ukemi');
        break;
      case 'fail':
        this.log(`FAIL · ${e.reason.type}`, 'fail');
        break;
      case 'finish':
        this.log(`■ 종료 · ${e.result.outcome === 'success' ? `성공 (낙법 ${e.result.ukemi})` : '실패'} · 점수 ${e.result.score.raw} / ${e.result.score.max}`, 'sys');
        break;
      default:
        break;
    }
  };

  // ───────────────────────────── 레이아웃 ─────────────────────────────

  private build(): HTMLDivElement {
    this.saveEl = h('span', { class: 'dev-save' }, '');
    const top = h('div', { class: 'dev-top' },
      h('h1', {}, h('b', {}, 'DEVELOPER MODE'), ' — 기술 에디터'),
      this.saveEl,
      h('span', { class: 'dev-spacer' }),
      h('button', { on: { click: () => this.openImport() }, title: '스킬 팩 JSON 불러오기' }, 'Import'),
      h('button', { class: 'primary', on: { click: () => this.openExport() }, title: '모든 기술을 하나의 JSON 으로 클립보드에 복사' }, 'Export JSON'),
      h('button', { on: { click: () => this.exit() } }, '← 타이틀'),
    );

    this.listCount = h('h2', {}, '기술 목록');
    this.listEl = h('ul', {});
    const list = h('div', { class: 'dev-list' },
      h('header', {}, this.listCount, h('button', { class: 'primary', on: { click: () => this.addSkill() } }, '+ 새 기술 추가')),
      this.listEl,
      h('footer', {},
        h('div', { class: 'hint' }, '자동 저장 → PLAY MODE 에서 이 목록으로 플레이'),
        h('button', { class: 'small', on: { click: () => this.resetToBuiltins() } }, '기본 기술로 초기화'),
      ),
    );

    this.formEl = h('div', { class: 'dev-form' });

    this.testBtn = h('button', { class: 'test', on: { click: () => this.test() } }, '▶ TEST');
    this.stopBtn = h('button', { on: { click: () => this.stop() } }, '■ STOP');
    this.nSelect = h('select', { title: '테스트할 진행부 횟수 N' });
    this.nSelect.addEventListener('change', () => { this.nSelect.dataset.user = '1'; });
    this.runEl = h('span', { class: 'hint' }, '대기 중');
    this.changedEl = h('span', { class: 'warn' }, '');
    this.logEl = h('ol', {});
    const log = h('div', { class: 'dev-log' },
      h('div', { class: 'bar' },
        this.testBtn, this.stopBtn,
        h('label', { class: 'hint' }, '진행 횟수 N ', this.nSelect),
        this.runEl, this.changedEl,
        h('span', { class: 'sp' }),
        h('button', { class: 'small', on: { click: () => this.logEl.replaceChildren() } }, '로그 지우기'),
      ),
      this.logEl,
    );

    this.toriKeys = h('datalist', { id: 'dev-keys-tori' });
    this.ukeKeys = h('datalist', { id: 'dev-keys-uke' });
    return h('div', { id: 'dev-editor' }, top, list, h('div', { class: 'dev-stage-slot' }), log, this.formEl, this.toriKeys, this.ukeKeys);
  }

  /**
   * 테스트 중 Space 가 포커스 남은 <button> 을 누르지 않게 (keydown 에서 기본 동작 차단 → 게임 입력으로만 쓰임).
   * 글자 입력 요소는 건드리지 않음 (폼에서 띄어쓰기 가능, 게임도 무시).
   */
  private installKeyGuards(): void {
    const isButtonish = (t: EventTarget | null) => t instanceof HTMLElement && this.root.contains(t) && !isTypingTarget(t) && /^(BUTTON|A|SUMMARY)$/.test(t.tagName);
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !this.running || !isButtonish(e.target)) return;
      e.preventDefault();
      (e.target as HTMLElement).blur();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && this.running && isButtonish(e.target)) e.preventDefault();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    this.cleanups.push(() => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    });
  }

  // ───────────────────────────── 목록 ─────────────────────────────

  private renderList(): void {
    const ts = this.pack.techniques;
    this.listCount.textContent = `기술 목록 (${ts.length})`;
    this.listEl.replaceChildren(
      ...ts.map((t, i) => {
        const issues = this.issuesOf(t);
        const total = totalOf(t);
        return h('li', { class: i === this.sel ? 'sel' : '', on: { click: () => this.select(i) } },
          h('div', { class: 'n' }, t.name || '(이름 없음)', issues.errors.length ? h('i', { class: 'err', title: issues.errors.join('\n') }, `오류 ${issues.errors.length}`) : h('i', { class: 'ok' }, 'OK')),
          h('div', { class: 'm' }, `${t.id} · 총 ${total ?? '?'}ms · 진행 ×${t.phases?.[1]?.repeat?.default ?? '?'}`),
        );
      }),
    );
    if (!ts.length) this.listEl.append(h('li', { class: 'hint' }, '기술이 없습니다. [+ 새 기술 추가]'));
  }

  private select(i: number): void {
    if (i === this.sel) return;
    this.sel = i;
    this.renderList();
    this.renderForm();
  }

  private takenIds(except?: TechniqueData): Set<string> {
    return new Set(this.pack.techniques.filter((t) => t !== except).map((t) => t.id));
  }

  private addSkill(): void {
    this.pack.techniques.push(newTechnique(this.takenIds()));
    this.sel = this.pack.techniques.length - 1;
    this.afterStructure();
    (this.formEl.querySelector('input[data-f=name]') as HTMLInputElement | null)?.focus();
  }

  private duplicate(): void {
    const t = this.cur;
    if (!t) return;
    this.pack.techniques.splice(this.sel + 1, 0, duplicateTechnique(t, this.takenIds()));
    this.sel++;
    this.afterStructure();
  }

  private remove(): void {
    const t = this.cur;
    if (!t || !confirm(`'${t.name || t.id}' 기술을 삭제할까요?`)) return;
    this.pack.techniques.splice(this.sel, 1);
    this.sel = Math.max(0, Math.min(this.sel, this.pack.techniques.length - 1));
    if (this.running) this.stop();
    this.afterStructure();
  }

  private resetToBuiltins(): void {
    if (!confirm('편집한 기술을 모두 지우고 기본 기술로 되돌릴까요? (먼저 Export 로 백업 권장)')) return;
    this.pack = emptyPack(this.host.builtins);
    this.sel = 0;
    if (this.running) this.stop();
    this.afterStructure();
  }

  /** 목록/폼 구조가 바뀐 뒤: 다시 그리고 저장 */
  private afterStructure(): void {
    this.renderList();
    this.renderForm();
    this.scheduleSave();
  }

  // ───────────────────────────── 검증 ─────────────────────────────

  private knownKeys(): Set<string> {
    return new Set([...Object.keys(this.host.manifest.sequences), ...Object.keys(this.pack.animations.sequences)]);
  }

  /** errors = 엔진이 거부하는 문제 (TEST 불가), warnings = 동작은 하지만 확인할 것 */
  private issuesOf(t: TechniqueData): { errors: string[]; warnings: string[] } {
    const errors = validateTechnique(t);
    if (this.pack.techniques.some((o) => o !== t && o.id === t.id)) errors.push(`id: '${t.id}' 가 다른 기술과 중복`);
    const warnings: string[] = [];
    if (!errors.length) {
      const known = this.knownKeys();
      const unknown = [...new Set(cuesOf(t).map((c) => c.key).filter((k) => !known.has(k)))];
      if (unknown.length) warnings.push(`등록되지 않은 애니메이션 Key (테스트 시 마젠타 체크무늬): ${unknown.join(', ')}`);
    }
    return { errors, warnings };
  }

  // ───────────────────────────── 폼 ─────────────────────────────

  private renderForm(): void {
    this.refreshers = [];
    this.fillDatalists();
    const t = this.cur;
    if (!t) {
      this.formEl.replaceChildren(h('div', { class: 'dev-empty' }, '왼쪽에서 기술을 선택하거나 [+ 새 기술 추가] 를 누르세요.'));
      this.updateNOptions();
      return;
    }
    const title = h('span', { class: 't' });
    const pill = h('span', { class: 'dev-status' });
    this.refreshers.push(() => {
      title.textContent = t.name || '(이름 없음)';
      const { errors } = this.issuesOf(t);
      pill.textContent = errors.length ? `오류 ${errors.length}` : '유효';
      pill.className = `dev-status ${errors.length ? 'ng' : 'ok'}`;
    });
    const head = h('div', { class: 'dev-form-head' },
      title, pill,
      h('button', { class: 'test small', on: { click: () => this.test() } }, '▶ TEST'),
      h('button', { class: 'small', on: { click: () => this.duplicate() } }, '복제'),
      h('button', { class: 'small danger', on: { click: () => this.remove() } }, '삭제'),
    );
    const [intro, prog, thr] = t.phases;
    const body = h('div', { class: 'dev-body' },
      this.secBasic(t),
      this.secPhase(t, intro, 'Phase 1', '도입부', 'p1', 'intro'),
      this.secProgression(t, prog),
      this.secPhase(t, thr, 'Phase 3', '던지기', 'p3', 'throw'),
      this.secUkemi(t),
      this.secValidation(t),
    );
    this.formEl.replaceChildren(head, body);
    this.updateNOptions();
    this.refresh();
  }

  /** 값 변경 후: 총 시간 동기화 → 화면 갱신 → 저장 */
  private changed(): void {
    const t = this.cur;
    if (t) syncTotal(t);
    this.refresh();
    this.renderList();
    this.updateNOptions();
    this.scheduleSave();
    if (this.running) this.changedEl.textContent = '변경됨 → ▶ RE-TEST 로 적용';
  }

  private refresh(): void {
    for (const f of this.refreshers) f();
  }

  // ── 입력 도우미 ──

  /** 숫자 입력. 유효할 때만 set → changed (빈칸·범위 밖은 빨간 테두리) */
  private num(get: () => number, set: (v: number) => void, o: { min?: number; max?: number; int?: boolean; w?: number; title?: string } = {}): HTMLInputElement {
    const el = h('input', { type: 'number', min: o.min ?? 0, max: o.max, step: o.int === false ? 0.01 : 1, value: String(get()), title: o.title, style: o.w ? `width:${o.w}px` : undefined });
    el.addEventListener('input', () => {
      const v = Number(el.value);
      const ok = el.value.trim() !== '' && Number.isFinite(v) && v >= (o.min ?? 0) && (o.max === undefined || v <= o.max) && (o.int === false || Number.isInteger(v));
      el.classList.toggle('bad', !ok);
      if (!ok) return;
      set(v);
      this.changed();
    });
    // 외부에서 값이 바뀌면(총 시간 조정 등) 포커스 없을 때만 갱신
    this.refreshers.push(() => {
      if (document.activeElement !== el && !el.classList.contains('bad')) el.value = String(get());
    });
    return el;
  }

  private text(get: () => string, set: (v: string) => void, o: { placeholder?: string; pattern?: RegExp; f?: string; check?: (v: string) => boolean } = {}): HTMLInputElement {
    const el = h('input', { type: 'text', value: get(), placeholder: o.placeholder, 'data-f': o.f, spellcheck: 'false' });
    el.addEventListener('input', () => {
      const v = el.value;
      const ok = (!o.pattern || o.pattern.test(v)) && (!o.check || o.check(v));
      el.classList.toggle('bad', !ok);
      if (!ok) return;
      set(v);
      this.changed();
    });
    return el;
  }

  private sec(tag: string, tagClass: string, title: string, ...kids: (Node | null)[]): HTMLElement {
    return h('section', { class: 'dev-sec' },
      h('h3', {}, tag ? h('span', { class: `tag ${tagClass}` }, tag) : null, title),
      h('div', { class: 'in' }, ...kids),
    );
  }

  // ── [기본 정보] ──

  private secBasic(t: TechniqueData): HTMLElement {
    const breakdown = h('div', { class: 'hint' });
    const total = h('input', { type: 'number', min: 3, step: 10, value: String(t.totalDurationMs), title: '바꾸면 모든 페이즈 길이·퍼펙트 시각이 같은 비율로 늘어나거나 줄어듦' });
    total.addEventListener('change', () => {
      const v = Math.round(Number(total.value));
      if (!(v >= 3)) {
        total.classList.add('bad');
        return;
      }
      total.classList.remove('bad');
      scaleTechnique(t, v);
      this.renderForm(); // 모든 페이즈 값이 바뀌므로 다시 그림
      this.changed();
      this.log(`총 시전 시간 → ${t.totalDurationMs}ms (페이즈 길이·퍼펙트 시각 비율 조정, 판정 오차 유지)`, 'sys');
    });
    this.refreshers.push(() => {
      if (document.activeElement !== total) total.value = String(t.totalDurationMs);
      breakdown.textContent = `= ${totalBreakdown(t)} = ${totalOf(t) ?? '?'}ms  (낙법 연출 제외)`;
    });
    const idTaken = (v: string) => !this.takenIds(t).has(v);
    return this.sec('', '', '기본 정보',
      h('label', { class: 'f' }, h('span', {}, '기술명'), this.text(() => t.name, (v) => { t.name = v; }, { placeholder: '예: 찌르기-사방던지기', f: 'name' })),
      h('label', { class: 'f' }, h('span', {}, 'ID'), this.text(() => t.id, (v) => { t.id = v; }, { pattern: ID_PATTERN, check: idTaken, placeholder: '영문 소문자·숫자·_ (예: tsuki_shihonage)' })),
      h('label', { class: 'f' }, h('span', {}, '설명'), this.text(() => t.description ?? '', (v) => { t.description = v; }, { placeholder: '(선택)' })),
      h('label', { class: 'f' }, h('span', {}, '총 시전 시간 (ms)'), h('div', { class: 'dev-row' }, total, h('span', { class: 'hint' }, 'Enter / 포커스 이동 시 비율 조정'))),
      breakdown,
    );
  }

  // ── 타이밍 블록 (길이 · 퍼펙트 시각 · 판정 윈도우 · 막대) ──

  /**
   * @param read  화면 표시용 (진행부 가상 회차 포함)
   * @param write 값 쓰기 대상 (필요 시 진행부 회차를 확정한 뒤 반환)
   */
  private timingBlock(read: () => Timing, write: () => Timing, after: () => void = () => undefined): HTMLElement {
    const setW = (k: (typeof TIERS)[number], side: 'early' | 'late', v: number) => {
      const w = write();
      const p = tierPair(w.window[k]);
      p[side] = v;
      w.window[k] = makeTier(p.early, p.late);
      after();
    };
    const ranges: Record<string, HTMLElement> = {};
    const rows = TIERS.map((k) => {
      ranges[k] = h('td', { class: 'r' });
      return h('tr', {},
        h('td', { class: `g ${k}` }, TIER_LABEL[k]),
        h('td', {}, '−', this.num(() => tierPair(read().window[k]).early, (v) => setW(k, 'early', v), { title: '일찍 누른 허용 오차 (ms)' })),
        h('td', {}, '+', this.num(() => tierPair(read().window[k]).late, (v) => setW(k, 'late', v), { title: '늦게 누른 허용 오차 (ms)' })),
        ranges[k]!,
      );
    });
    const bar = h('div', { class: 'dev-bar' });
    const axis = h('div', { class: 'dev-bar-axis' });
    this.refreshers.push(() => {
      const x = read();
      const r = windowRanges(x.perfectMs, x.window);
      for (const k of TIERS) ranges[k]!.textContent = `${r[k][0]} ~ ${r[k][1]}ms`;
      this.drawBar(bar, axis, x);
    });
    return h('div', {},
      h('div', { class: 'dev-row' },
        h('label', {}, '길이', this.num(() => read().durationMs, (v) => { write().durationMs = v; after(); }, { min: 1 }), 'ms'),
        h('label', {}, '퍼펙트 시각', this.num(() => read().perfectMs, (v) => { write().perfectMs = v; after(); }), 'ms'),
      ),
      h('table', { class: 'dev-win' },
        h('thead', {}, h('tr', {}, h('th', {}, '판정'), h('th', {}, '일찍 (early)'), h('th', {}, '늦게 (late)'), h('th', {}, '구간 (페이즈 기준)'))),
        h('tbody', {}, ...rows),
      ),
      bar, axis,
    );
  }

  /** 0 ~ durationMs 막대 위에 Bad ⊃ Good ⊃ Perfect 구간과 퍼펙트 시각. 페이즈 밖으로 넘치면 빗금 */
  private drawBar(bar: HTMLElement, axis: HTMLElement, x: Timing): void {
    const d = Math.max(1, x.durationMs);
    const r = windowRanges(x.perfectMs, x.window);
    const pct = (v: number) => (Math.max(0, Math.min(d, v)) / d) * 100;
    const kids: HTMLElement[] = [];
    for (const k of ['bad', 'good', 'perfect'] as const) {
      const [a, b] = r[k];
      kids.push(h('div', { class: k, style: `left:${pct(a)}%;width:${Math.max(0, pct(b) - pct(a))}%` }));
    }
    if (r.bad[0] < 0) kids.push(h('div', { class: 'over', style: 'left:0;width:4%', title: '판정 구간이 페이즈 시작 전으로 넘침' }));
    if (r.bad[1] > d) kids.push(h('div', { class: 'over', style: 'right:0;width:4%', title: '판정 구간이 페이즈 끝을 넘침' }));
    kids.push(h('div', { class: 'mark', style: `left:calc(${pct(x.perfectMs)}% - 1px)`, title: `퍼펙트 ${x.perfectMs}ms` }));
    bar.replaceChildren(...kids);
    axis.replaceChildren(h('span', {}, '0'), h('span', {}, `퍼펙트 ${x.perfectMs}ms`), h('span', {}, `${x.durationMs}ms`));
  }

  // ── Phase 1 / 3 ──

  private secPhase(t: TechniqueData, ph: IntroPhase | ThrowPhase, tag: string, name: string, cls: string, slotBase: string): HTMLElement {
    return this.sec(tag, cls, name,
      h('label', { class: 'f' }, h('span', {}, '라벨'), this.text(() => ph.label ?? '', (v) => { ph.label = v; }, { placeholder: name })),
      this.timingBlock(() => ph, () => ph),
      h('div', { class: 'hint' }, '이미지 — 페이즈 시작(0ms)에 재생할 애니메이션 Key 또는 업로드 이미지'),
      h('div', { class: 'dev-slots' },
        this.slot(t, '토리', 'tori', () => ph.animations, `${slotBase}_tori`),
        this.slot(t, '우케', 'uke', () => ph.animations, `${slotBase}_uke`),
      ),
    );
  }

  // ── Phase 2 (회차 N개, + 타이밍 추가) ──

  private secProgression(t: TechniqueData, prog: ProgressionPhase): HTMLElement {
    const steps = viewSteps(prog);
    const readStep = (k: number) => (): ProgressionStep => prog.steps?.[k] ?? viewSteps(prog)[k] ?? steps[0]!;
    const writeStep = (k: number) => (): ProgressionStep => materializeSteps(prog)[k]!;
    const list = h('div', {},
      ...steps.map((_, k) => h('div', { class: 'dev-step' },
        h('div', { class: 'h' },
          `타이밍 #${k + 1}`,
          h('span', { class: 'sp' }),
          h('button', { class: 'small danger', disabled: steps.length <= 1, title: '이 입력 구간 삭제', on: { click: () => this.removeStep(prog, k) } }, '× 삭제'),
        ),
        this.timingBlock(readStep(k), writeStep(k), () => syncProgression(prog)),
      )),
    );
    const n = h('b', {});
    this.refreshers.push(() => { n.textContent = String(prog.repeat.default); });
    return this.sec('Phase 2', 'p2', '진행부 — 입력 구간 N개',
      h('div', { class: 'hint' }, '회차마다 길이·퍼펙트 시각·판정 오차를 따로 설정합니다. [+ 타이밍 추가] 로 입력 구간을 늘리세요.'),
      list,
      h('div', { class: 'dev-row' },
        h('button', { class: 'primary', on: { click: () => this.addStep(prog) } }, '+ 타이밍 추가'),
        h('span', { class: 'hint' }, '기본 진행 횟수 N = ', n),
      ),
      h('div', { class: 'dev-row', style: 'margin-top:6px' },
        h('span', { class: 'hint' }, '게임/연습 모드 N 범위'),
        h('label', {}, 'min', this.num(() => prog.repeat.min, (v) => { prog.repeat.min = v; }, { min: 1, w: 56 })),
        h('label', {}, 'max', this.num(() => prog.repeat.max, (v) => { prog.repeat.max = v; }, { min: 1, w: 56 })),
        h('span', { class: 'hint' }, '(N > 회차 수면 회차를 처음부터 반복)'),
      ),
      h('div', { class: 'hint', style: 'margin-top:6px' }, '이미지 — 매 회차 시작(0ms)에 재생'),
      h('div', { class: 'dev-slots' },
        this.slot(t, '토리', 'tori', () => prog.animations, 'progression_tori'),
        this.slot(t, '우케', 'uke', () => prog.animations, 'progression_uke'),
      ),
    );
  }

  private addStep(prog: ProgressionPhase): void {
    const steps = materializeSteps(prog);
    steps.push(clone(steps[steps.length - 1]!));
    syncProgression(prog);
    this.renderForm();
    this.changed();
    this.formEl.querySelector('.dev-step:last-of-type')?.scrollIntoView({ block: 'nearest' });
  }

  private removeStep(prog: ProgressionPhase, k: number): void {
    const steps = materializeSteps(prog);
    if (steps.length <= 1) return;
    steps.splice(k, 1);
    syncProgression(prog);
    this.renderForm();
    this.changed();
  }

  // ── 우케미 결과 ──

  private secUkemi(t: TechniqueData): HTMLElement {
    const u = t.ukemi;
    const pct = (get: () => number, set: (v: number) => void) =>
      this.num(() => Math.round(get() * 100), (v) => set(v / 100), { min: 0, max: 100, w: 60 });
    return this.sec('Ukemi', 'uk', '낙법 결과 (Perfect / Good / Bad)',
      h('div', { class: 'dev-row' },
        h('span', { class: 'hint' }, '누적 점수 비율'),
        h('label', {}, 'Perfect ≥', pct(() => u.thresholds.perfect, (v) => { u.thresholds.perfect = v; }), '%'),
        h('label', {}, 'Good ≥', pct(() => u.thresholds.good, (v) => { u.thresholds.good = v; }), '%'),
      ),
      ...UKEMI_GRADES.map((g) => {
        const r = u.results[g];
        return h('div', { class: 'dev-step' },
          h('div', { class: 'h' }, `${UKEMI_LABEL[g]} 낙법`),
          h('div', { class: 'dev-row' },
            h('label', {}, '라벨', this.text(() => r.label ?? '', (v) => { r.label = v; })),
            h('label', {}, '연출 길이', this.num(() => r.durationMs, (v) => { r.durationMs = v; }, { min: 1 }), 'ms'),
          ),
          h('div', { class: 'dev-slots' },
            this.slot(t, '토리', 'tori', () => r.animations, `ukemi_${g}_tori`),
            this.slot(t, '우케', 'uke', () => r.animations, `ukemi_${g}_uke`),
          ),
        );
      }),
    );
  }

  // ── 검증 ──

  private secValidation(t: TechniqueData): HTMLElement {
    const box = h('div', {});
    this.refreshers.push(() => {
      const { errors, warnings } = this.issuesOf(t);
      box.replaceChildren(...[
        errors.length
          ? h('div', { class: 'err' }, `오류 ${errors.length}개 — 고치기 전에는 TEST / PLAY 에 쓸 수 없습니다`)
          : h('div', { class: 'ok' }, '규칙 통과 — TEST 와 PLAY MODE 에서 사용 가능'),
        errors.length || warnings.length
          ? h('ul', { class: 'dev-issues' }, ...errors.map((e) => h('li', {}, e)), ...warnings.map((w) => h('li', { class: 'w' }, w)))
          : null,
      ].filter((x): x is NonNullable<typeof x> => x !== null));
    });
    return h('section', { class: 'dev-sec', id: 'dev-validation' }, h('h3', {}, '검증'), h('div', { class: 'in' }, box));
  }

  // ───────────────────────────── 이미지 슬롯 ─────────────────────────────

  /**
   * 한 actor 의 0ms 큐 = 이 슬롯. 텍스트(애니메이션 Key) 입력 또는 PNG/SVG 업로드.
   * 업로드 → 텍스처 custom_<해시> + 시퀀스 custom.<기술ID>_<슬롯> 를 팩에 등록하고 큐 Key 를 그 시퀀스로.
   */
  private slot(t: TechniqueData, label: string, actor: Slot, cues: () => AnimationCue[], slotId: string): HTMLElement {
    const thumb = h('img', { class: `dev-thumb${actor === 'uke' ? ' flip' : ''}`, alt: '' });
    const status = h('div', { class: 'st' });
    const input = h('input', { type: 'text', list: `dev-keys-${actor}`, spellcheck: 'false', value: slotCue(cues(), actor)?.key ?? '', placeholder: `${actor}.xxx` });
    const file = h('input', { type: 'file', accept: 'image/png,image/svg+xml,.png,.svg', style: 'display:none' });
    const upBtn = h('button', { class: 'small', title: '로컬 PNG / SVG 업로드 (권장 64×64, 발바닥 = 이미지 아래쪽)', on: { click: () => file.click() } }, '업로드…');

    const show = () => {
      const key = slotCue(cues(), actor)?.key ?? '';
      const info = this.describeKey(key, actor);
      if (info.uri) {
        thumb.src = info.uri;
        thumb.style.visibility = 'visible';
      } else {
        thumb.removeAttribute('src');
        thumb.style.visibility = 'hidden';
      }
      const extra = extraCues(cues(), actor);
      status.replaceChildren(info.text);
      status.className = `st${info.warn ? ' warn' : ''}`;
      if (extra.length) {
        status.append(
          `  · 이후 큐 ${extra.map((c) => `${c.key}@${c.atMs}ms`).join(', ')} `,
          h('button', {
            class: 'link', title: '슬롯 이미지만 남기고 이 actor 의 다른 큐 삭제',
            on: { click: () => { const list = cues(); for (const c of extra) list.splice(list.indexOf(c), 1); show(); this.changed(); } },
          }, '지우기'),
        );
      }
    };
    input.addEventListener('input', () => {
      const v = input.value.trim();
      const ok = KEY_PATTERN.test(v);
      input.classList.toggle('bad', !ok);
      if (!ok) return;
      setSlotKey(cues(), actor, v);
      show();
      this.changed();
    });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) void this.upload(t, f, actor, cues, slotId, (key, note) => { input.value = key; input.classList.remove('bad'); show(); if (note) status.append(`  · ${note}`); });
    });
    show();
    return h('div', { class: 'dev-slot' }, h('span', { class: 'a' }, label), thumb, input, h('span', {}, upBtn, file), status);
  }

  /** Key → 미리보기 이미지와 설명 */
  private describeKey(key: string, actor: Slot): { uri?: string; text: string; warn?: boolean } {
    if (!key) return { text: '비어 있음 → 이전 이미지 유지', warn: true };
    const custom = this.pack.animations.sequences[key];
    if (custom?.image) {
      const uri = this.pack.assets[custom.image];
      return uri ? { uri, text: `업로드 이미지 (${custom.image})` } : { text: `! 업로드 이미지 데이터 없음 (${custom.image})`, warn: true };
    }
    const def = this.host.manifest.sequences[key];
    if (!def) return { text: '! 등록되지 않은 Key → 테스트 시 마젠타 체크무늬', warn: true };
    const sprite = def.image ? SPRITES[def.image as keyof typeof SPRITES] : undefined;
    if (sprite) return { uri: sprite.uri, text: `픽셀 아트 ${def.image}` };
    return { uri: this.placeholderThumb(key, def.pose ?? 'stand', actor), text: `플레이스홀더 (pose ${def.pose ?? 'stand'} · ${def.frames}프레임)` };
  }

  /** 플레이스홀더 포즈를 캔버스에 그려 썸네일로 (게임과 같은 placeholderArt) */
  private placeholderThumb(key: string, pose: PoseHint, actor: Slot): string {
    const hit = this.thumbCache.get(key);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = CHAR_FRAME.w;
    c.height = CHAR_FRAME.h;
    const ctx = c.getContext('2d');
    let uri = '';
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      drawFigure(ctx, pose, 1, actor === 'uke' ? UKE_PALETTE : TORI_PALETTE, 0, 0);
      uri = c.toDataURL('image/png');
    }
    this.thumbCache.set(key, uri);
    return uri;
  }

  private async upload(
    t: TechniqueData, f: File, actor: Slot, cues: () => AnimationCue[], slotId: string,
    done: (key: string, note: string) => void,
  ): Promise<void> {
    const isSvg = f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);
    const isPng = f.type === 'image/png' || /\.png$/i.test(f.name);
    if (!isSvg && !isPng) return void alert('PNG 또는 SVG 파일만 업로드할 수 있습니다.');
    if (f.size > MAX_UPLOAD_BYTES) return void alert(`파일이 너무 큽니다 (${(f.size / 1024).toFixed(0)}KB). 2MB 이하로 줄여 주세요.`);
    try {
      let uri = await readDataUri(f);
      // 확장자만 있고 MIME 이 비어 있는 경우 보정
      if (!/^data:image\//.test(uri)) uri = uri.replace(/^data:[^;,]*/, isSvg ? 'data:image/svg+xml' : 'data:image/png');
      let img = await loadImage(uri);
      let note = `${f.name} · ${img.naturalWidth}×${img.naturalHeight}px`;
      if (!img.naturalWidth || !img.naturalHeight) {
        // width/height 없는 SVG → 64x64 PNG 로 래스터화 (텍스처 크기가 정해지도록)
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 64;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('캔버스를 만들 수 없음');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, 64, 64);
        uri = c.toDataURL('image/png');
        img = await loadImage(uri);
        note = `${f.name} · 크기 없는 SVG → 64×64 PNG 로 변환`;
      }
      if (img.naturalWidth > 128 || img.naturalHeight > 128) note += ' · 주의: 큼 (64×64 권장, 확대 없이 1:1 표시)';
      const tex = assetKeyFor(uri);
      this.pack.assets[tex] = uri;
      const seq = `${CUSTOM_SEQ_PREFIX}${t.id}_${slotId}`.replace(/[^a-z0-9_.]/g, '_');
      this.pack.animations.sequences[seq] = { frames: 1, frameRate: 12, image: tex };
      setSlotKey(cues(), actor, seq);
      this.fillDatalists();
      this.changed();
      done(seq, note);
    } catch (e) {
      alert(`업로드 실패: ${(e as Error).message}`);
    }
  }

  private fillDatalists(): void {
    const keys = [...this.knownKeys()].sort();
    const opts = (prefix: string) => keys.filter((k) => k.startsWith(prefix) || k.startsWith(CUSTOM_SEQ_PREFIX)).map((k) => h('option', { value: k }));
    this.toriKeys.replaceChildren(...opts('tori.'));
    this.ukeKeys.replaceChildren(...opts('uke.'));
  }

  // ───────────────────────────── TEST ─────────────────────────────

  private updateNOptions(): void {
    const t = this.cur;
    const r = t?.phases?.[1]?.repeat;
    const prev = Number(this.nSelect.value);
    if (!r || !(r.min >= 1) || !(r.max >= r.min) || r.max > 50) {
      this.nSelect.replaceChildren();
      return;
    }
    // 사용자가 직접 고른 값만 유지 (회차를 추가하면 기본 N 을 따라감)
    const chosen = this.nSelect.dataset.tech === t.id && this.nSelect.dataset.user === '1';
    const keep = chosen && prev >= r.min && prev <= r.max ? prev : r.default;
    if (this.nSelect.dataset.tech !== t.id) this.nSelect.dataset.user = '';
    this.nSelect.replaceChildren(...Array.from({ length: r.max - r.min + 1 }, (_, i) => {
      const n = r.min + i;
      return h('option', { value: String(n) }, n === r.default ? `${n} (기본)` : String(n));
    }));
    this.nSelect.value = String(Math.min(r.max, Math.max(r.min, keep)));
    this.nSelect.dataset.tech = t.id;
  }

  private test(): void {
    const t = this.cur;
    if (!t) return;
    syncTotal(t);
    const { errors } = this.issuesOf(t);
    if (errors.length) {
      this.log(`TEST 불가 — 오류 ${errors.length}개 (폼 아래 '검증' 참고)`, 'fail');
      for (const e of errors.slice(0, 6)) this.log(`   ${e}`, 'fail');
      this.formEl.querySelector('#dev-validation')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    const r = t.phases[1].repeat;
    const n = Math.min(r.max, Math.max(r.min, Number(this.nSelect.value) || r.default));
    // 포커스를 빼서 Space 가 방금 누른 버튼이나 입력칸으로 가지 않게
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.logEl.replaceChildren();
    this.log(`▶ TEST  ${t.name} (${t.id})  진행 ×${n}  — Space / 화면 클릭으로 입력`, 'sys');
    this.setRunning(true);
    this.changedEl.textContent = '';
    this.host.onTest(clone(t), clone(this.pack), n);
  }

  private stop(): void {
    this.setRunning(false);
    this.host.onStop();
  }

  private exit(): void {
    this.flushSave();
    this.host.onExit();
  }

  private log(text: string, cls = ''): void {
    if (!this.isMounted) return;
    this.logEl.append(h('li', { class: cls }, text));
    while (this.logEl.childElementCount > LOG_LIMIT) this.logEl.firstElementChild?.remove();
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  // ───────────────────────────── 저장 ─────────────────────────────

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 350);
  }

  private flushSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const err = savePack(this.pack);
    if (!this.isMounted) return;
    const time = new Date().toLocaleTimeString();
    this.saveEl.textContent = err ?? `자동 저장됨 ${time}`;
    this.saveEl.className = `dev-save${err ? ' err' : ''}`;
  }

  // ───────────────────────────── Export / Import ─────────────────────────────

  private modal(title: string, body: Node[], actions: HTMLButtonElement[]): { close: () => void } {
    const wrap = h('div', { class: 'dev-modal-wrap' });
    const close = () => wrap.remove();
    wrap.append(h('div', { class: 'dev-modal', role: 'dialog' },
      h('h3', {}, title),
      h('div', { class: 'in' }, ...body),
      h('div', { class: 'act' }, ...actions, h('button', { on: { click: close } }, '닫기')),
    ));
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') { e.stopPropagation(); close(); } });
    this.root.append(wrap);
    return { close };
  }

  /** 모든 기술 → 하나의 스킬 팩 JSON → 클립보드 (+ 텍스트 상자 · 파일 저장) */
  private async openExport(): Promise<void> {
    this.flushSave();
    const json = exportPackJson(this.pack);
    const pruned = prunePack(this.pack);
    const bad = this.pack.techniques.filter((t) => this.issuesOf(t).errors.length);
    const ta = h('textarea', { readonly: true, spellcheck: 'false' });
    ta.value = json;
    const status = h('div', {});
    const copy = async () => {
      const ok = await copyText(json);
      status.className = ok ? 'ok' : 'warn';
      status.textContent = ok
        ? `클립보드에 복사됨 — 기술 ${pruned.techniques.length}개 · 업로드 이미지 ${Object.keys(pruned.assets).length}개 · ${(json.length / 1024).toFixed(1)}KB`
        : '자동 복사가 막혔습니다. 아래 텍스트를 전체 선택(Ctrl+A) 후 복사(Ctrl+C) 하세요.';
      if (!ok) {
        ta.focus();
        ta.select();
      }
    };
    this.modal('Export JSON — 스킬 팩 (schema/skillpack.schema.json)', [
      status,
      bad.length ? h('div', { class: 'warn' }, `! 규칙 위반 기술 ${bad.length}개 포함 (${bad.map((t) => t.name || t.id).join(', ')}) — 게임에서는 제외됩니다`) : null,
      h('div', { class: 'hint' }, 'techniques[] 의 각 항목은 technique.schema.json 그대로라 data/techniques/*.json 으로 떼어 써도 됩니다.'),
      ta,
    ].filter((x): x is NonNullable<typeof x> => x !== null), [
      h('button', { on: { click: () => void copy() } }, '다시 복사'),
      h('button', { on: { click: () => downloadText('aikido-skillpack.json', json) } }, '파일로 저장 (.json)'),
    ]);
    await copy();
  }

  private openImport(): void {
    const ta = h('textarea', { spellcheck: 'false', placeholder: 'Export 한 스킬 팩 JSON (또는 기술 JSON 1개 / 기술 배열) 을 붙여 넣거나 파일을 고르세요' });
    const file = h('input', { type: 'file', accept: '.json,application/json' });
    const msg = h('div', { class: 'hint' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f) ta.value = await f.text();
    });
    const apply = (mode: 'replace' | 'merge') => {
      const { pack, errors } = parsePack(ta.value);
      if (!pack) {
        msg.className = 'err';
        msg.textContent = errors.slice(0, 5).join(' / ');
        return;
      }
      if (mode === 'replace') {
        if (!confirm('현재 기술 목록을 불러온 팩으로 교체할까요?')) return;
        this.pack = pack;
        this.sel = 0;
      } else {
        this.mergePack(pack);
        this.sel = this.pack.techniques.length - pack.techniques.length;
      }
      if (this.running) this.stop();
      ui.close();
      this.afterStructure();
      this.log(`Import: 기술 ${pack.techniques.length}개 ${mode === 'replace' ? '로 교체' : '추가'}`, 'sys');
    };
    const ui = this.modal('Import JSON', [h('div', { class: 'dev-row' }, file), ta, msg], [
      h('button', { on: { click: () => apply('merge') } }, '추가 (목록 뒤에)'),
      h('button', { class: 'primary', on: { click: () => apply('replace') } }, '교체'),
    ]);
  }

  /** 추가 Import: ID 가 겹치면 새 ID, 시퀀스 Key 가 다른 이미지와 겹치면 새 Key 로 바꿔 큐까지 갱신 */
  private mergePack(inc: SkillPack): void {
    const rename = new Map<string, string>();
    for (const [k, d] of Object.entries(inc.animations.sequences)) {
      const mine = this.pack.animations.sequences[k];
      let key = k;
      if (mine && mine.image !== d.image) key = uniqueId(k.replace(/\./g, '_'), new Set(Object.keys(this.pack.animations.sequences).map((x) => x.replace(/\./g, '_')))).replace(/^custom_/, CUSTOM_SEQ_PREFIX);
      if (key !== k) rename.set(k, key);
      this.pack.animations.sequences[key] = d;
    }
    Object.assign(this.pack.assets, inc.assets);
    for (const t of inc.techniques) {
      const c = clone(t);
      c.id = uniqueId(c.id, this.takenIds());
      for (const cue of cuesOf(c)) cue.key = rename.get(cue.key) ?? cue.key;
      this.pack.techniques.push(c);
    }
  }
}
