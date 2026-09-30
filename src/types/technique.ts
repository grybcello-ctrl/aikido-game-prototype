/**
 * 기술 데이터 인터페이스 — schema/technique.schema.json 과 1:1 대응.
 *
 * 흐름: 도입부(1회) → 진행부(1~N회) → 던지기(1회) → 낙법(점수 분기)
 * 시간 규칙: 모든 값은 ms 정수. 페이즈 안의 시간(perfectMs, atMs)은
 *            해당 페이즈(진행부는 해당 회차) 시작 기준 상대값.
 */

/** 밀리초 (정수, ≥ 0) */
export type Ms = number;

/** 애니메이션 시퀀스 시작 Key. 패턴 `^[a-z0-9_]+(\.[a-z0-9_]+)*$` (예: `tori.irimi_enter`) */
export type SequenceKey = string;

/** tori = 플레이어, uke = 상대, fx = 이펙트 레이어 */
export type Actor = 'tori' | 'uke' | 'fx';

/** 입력 1회 판정 등급 */
export type Grade = 'perfect' | 'good' | 'bad' | 'miss';

/** 낙법 3단계 */
export type UkemiGrade = 'perfect' | 'good' | 'bad';

export type PhaseType = 'intro' | 'progression' | 'throw';

// ─────────────────────────── 판정 윈도우 ───────────────────────────

/** 허용 오차. 숫자 = 앞뒤 대칭, 객체 = 비대칭 */
export type WindowTier = Ms | { early: Ms; late: Ms };

/**
 * 오차 d = 입력시각 - 퍼펙트시각.
 * 가장 좁은 구간부터 |d| ≤ perfect → Perfect, ≤ good → Good, ≤ bad → Bad (경계 포함).
 * d < 0 이면 early 값, d ≥ 0 이면 late 값을 쓴다.
 * bad 구간이 닫힐 때까지 입력이 없으면 Miss.
 * 제약: perfect ≤ good ≤ bad (early/late 각각)
 */
export interface JudgeWindow {
  perfect: WindowTier;
  good: WindowTier;
  bad: WindowTier;
}

// ─────────────────────────── 이미지(시퀀스) 매핑 ───────────────────────────

/**
 * atMs 시점에 actor 의 애니메이션을 key 시퀀스로 시작.
 * 같은 actor 는 나중에 시작한 시퀀스가 이전 것을 대체한다.
 */
export interface AnimationCue {
  atMs: Ms;
  actor: Actor;
  key: SequenceKey;
}

/**
 * 판정 직후 추가로 시작할 시퀀스.
 * cues[].atMs 는 판정 시각 기준 (Miss 는 bad 구간 종료 시각 기준).
 */
export interface JudgeReaction {
  /** true: 이 반응에 등장하는 actor 의 남은 기본 큐를 취소. 기본 false */
  replaceRemaining?: boolean;
  /** 1개 이상 */
  cues: AnimationCue[];
}

export type JudgeReactions = Partial<Record<Grade, JudgeReaction>>;

// ─────────────────────────── 페이즈 ───────────────────────────

interface PhaseCommon {
  /** `^[a-z0-9_]+$` */
  id: string;
  label?: string;
  /** 페이즈 길이 (진행부는 1회분). ≥ 1 */
  durationMs: Ms;
  /**
   * 퍼펙트 타이밍 (페이즈 시작 기준).
   * 제약: perfectMs - bad.early ≥ 0, perfectMs + bad.late ≤ durationMs
   */
  perfectMs: Ms;
  window: JudgeWindow;
  /** 점수 배율 (> 0, 기본 1). 진행부는 회차마다 적용 */
  weight?: number;
  /** 기본 타임라인 (퍼펙트 수행 기준 연출). 1개 이상, atMs < durationMs */
  animations: AnimationCue[];
  onJudge?: JudgeReactions;
  /** 판정 순간 토리↔우케 거리 변경 (Miss 는 기본적으로 이동 없음) */
  spacing?: SpacingMove;
}

// ─────────────────────────── 거리(마아이) ───────────────────────────

/** 누가 움직이는가. center = 둘 다 절반씩 */
export type SpacingAnchor = 'tori' | 'uke' | 'center';

/** 거리 이동 1회. targetPx(절대 거리) 또는 deltaPx(현재 거리 기준 증감) 중 정확히 하나 */
export interface SpacingMove {
  targetPx?: number;
  deltaPx?: number;
  /** 기본 'tori' */
  anchor?: SpacingAnchor;
  /** 이동 시간. 생략 시 SpacingRules.moveMs */
  moveMs?: Ms;
}

/** 캐릭터 간 거리 규칙 (px, 내부 해상도 640 기준) */
export interface SpacingRules {
  /** 기술 시작 시 토리↔우케 거리 */
  startPx: number;
  /** 기본 이동 시간. 기본 120 */
  moveMs?: Ms;
  /** 좁히는 이동에서 등급별로 덜 좁혀지는 거리 (Perfect = 0) */
  slackPx?: { good?: number; bad?: number };
}

export interface IntroPhase extends PhaseCommon {
  type: 'intro';
}

/** 반복 횟수. 제약: 1 ≤ min ≤ default ≤ max */
export interface RepeatRange {
  min: number;
  max: number;
  default: number;
}

export interface ProgressionPhase extends PhaseCommon {
  type: 'progression';
  /** 회차마다 같은 perfectMs / window / animations 를 재사용 */
  repeat: RepeatRange;
}

export interface ThrowPhase extends PhaseCommon {
  type: 'throw';
}

export type Phase = IntroPhase | ProgressionPhase | ThrowPhase;

/** 고정 순서 3개 */
export type PhaseTuple = [IntroPhase, ProgressionPhase, ThrowPhase];

// ─────────────────────────── 입력 · 점수 · 낙법 ───────────────────────────

/**
 * 기술 실패(낙법 없이 종료) 조건. 생략 시 기본값.
 * 실패 시 이후 판정·기본 큐는 취소되고, 실패를 일으킨 판정의 onJudge 반응 큐만 끝까지 재생된다.
 */
export interface FailureRules {
  /** 이 페이즈 타입에서 Miss 가 나면 즉시 실패. 기본 [] */
  abortOnMiss?: PhaseType[];
  /** 연속 Miss 가 이 횟수(≥1)에 도달하면 실패. 생략 = 제한 없음 */
  maxConsecutiveMiss?: number;
  /** 모든 판정이 Miss(유효 입력 0회)로 끝나면 실패. 기본 true */
  failOnNoInput?: boolean;
}

export interface InputRules {
  /** 판정 구간 밖에서 누르면 이 시간 동안 입력 무시 (연타 방지). 기본 0 */
  lockoutMs?: Ms;
}

/** 판정 1회당 기본 점수. 획득 = points[등급] × weight. 제약: perfect ≥ good ≥ bad ≥ miss, perfect > 0 */
export interface Scoring {
  points: Record<Grade, number>;
}

export interface UkemiResult {
  label?: string;
  durationMs: Ms;
  /** atMs 는 낙법 시작(던지기 종료) 기준. uke 큐 1개 이상 필수 */
  animations: AnimationCue[];
  /** 낙법 시작 시 거리 변경 (우케가 날아감) */
  spacing?: SpacingMove;
}

/**
 * 누적 점수 비율 r = 획득 점수 / 만점 (실제 플레이한 N 기준).
 * r ≥ thresholds.perfect → Perfect, r ≥ thresholds.good → Good, 그 외 → Bad.
 * 제약: 0 ≤ good < perfect ≤ 1
 */
export interface UkemiMapping {
  thresholds: { perfect: number; good: number };
  results: Record<UkemiGrade, UkemiResult>;
}

// ─────────────────────────── 루트 ───────────────────────────

export interface TechniqueData {
  $schema?: string;
  schemaVersion: 1;
  /** `^[a-z0-9_]+$` */
  id: string;
  name: string;
  description?: string;
  /**
   * 기술 전체 시간 = intro.durationMs + progression.durationMs × repeat.default + throw.durationMs.
   * 낙법 연출 제외. 런타임에 N 이 바뀌면 엔진이 다시 계산한다.
   */
  totalDurationMs: Ms;
  input?: InputRules;
  phases: PhaseTuple;
  scoring: Scoring;
  ukemi: UkemiMapping;
  failure?: FailureRules;
  spacing?: SpacingRules;
}

// ─────────────────────────── 런타임 계약 (엔진 ↔ 렌더러/디버거) ───────────────────────────
// 구현은 Task 2 이후. 여기서는 JSON 을 펼친 결과물의 형태만 확정한다.

/** 절대 시각 구간 [from, to] (기술 시작 기준, 경계 포함) */
export type AbsRange = [Ms, Ms];

/** 판정 1회(= 비트)의 절대 스케줄. 진행부는 회차마다 1개 */
export interface ScheduledBeat {
  /** 0부터. 도입부 = 0, 진행부 = 1..N, 던지기 = N+1 */
  index: number;
  phaseType: PhaseType;
  phaseId: string;
  /** 진행부 회차 (0부터). 그 외 0 */
  iteration: number;
  startMs: Ms;
  endMs: Ms;
  perfectAtMs: Ms;
  window: { perfect: AbsRange; good: AbsRange; bad: AbsRange };
  weight: number;
}

/** 기본 타임라인 큐를 절대 시각으로 펼친 것 */
export interface ScheduledCue extends AnimationCue {
  absMs: Ms;
  beatIndex: number;
}

/** TechniqueData + 실제 N → 펼친 타임라인 */
export interface ResolvedTimeline {
  techniqueId: string;
  progressionCount: number;
  /** 이번 N 기준 도입~던지기 합계 */
  totalDurationMs: Ms;
  beats: ScheduledBeat[];
  cues: ScheduledCue[];
  /** = totalDurationMs */
  ukemiStartMs: Ms;
}

export interface JudgementRecord {
  beatIndex: number;
  grade: Grade;
  /** 입력시각 - 퍼펙트시각. Miss 는 null */
  offsetMs: Ms | null;
  /** points[grade] × weight */
  points: number;
}

export interface ScoreSummary {
  raw: number;
  /** Σ points.perfect × weight (실제 플레이한 비트 기준) */
  max: number;
  /** raw / max (0..1) */
  ratio: number;
  ukemi: UkemiGrade;
  counts: Record<Grade, number>;
}
