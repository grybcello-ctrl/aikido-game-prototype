import type {
  Actor, Grade, JudgementRecord, Ms, PhaseType, ScoreSummary, SequenceKey, UkemiGrade,
} from '../types/technique';

/**
 * idle → running → ukemi → finished        (성공)
 * idle → running → failed → finished       (실패: 반응 큐 재생 후 종료)
 */
export type EngineStatus = 'idle' | 'running' | 'ukemi' | 'failed' | 'finished';

/** phase = 기본 타임라인, reaction = onJudge, ukemi = 낙법 결과 */
export type CueSource = 'phase' | 'reaction' | 'ukemi';

export type IgnoreReason =
  /** 진행 중이 아님 (시작 전 / 던지기 이후 / 실패 / 종료) */
  | 'not_running'
  /** 어떤 판정 구간에도 속하지 않음 → lockoutMs 동안 입력 잠금 */
  | 'outside_window'
  /** 구간 밖 입력 후 잠금 시간 */
  | 'lockout'
  /** 이미 판정된 비트의 구간 안에서 다시 누름 */
  | 'already_judged'
  /** 일시정지 중 */
  | 'paused';

export type FailReason =
  | { type: 'miss_abort'; phaseType: PhaseType; phaseId: string; beatIndex: number }
  | { type: 'consecutive_miss'; count: number; beatIndex: number }
  /** 모든 판정이 Miss. presses = 진행 중 실제로 누른 횟수(구간 밖 포함) */
  | { type: 'no_input'; presses: number }
  | { type: 'aborted' };

export interface ScoreSnapshot {
  raw: number;
  /** 이번 판 예정 비트 전체 기준 만점 */
  max: number;
  /** raw / max */
  ratio: number;
  counts: Record<Grade, number>;
  judged: number;
  total: number;
}

export interface SuccessResult {
  outcome: 'success';
  ukemi: UkemiGrade;
  score: ScoreSummary;
  judgements: JudgementRecord[];
  progressionCount: number;
  /** 낙법 결정 시각 (= 던지기 페이즈 종료) */
  decidedAtMs: Ms;
}

export interface FailureResult {
  outcome: 'failed';
  reason: FailReason;
  score: ScoreSnapshot;
  judgements: JudgementRecord[];
  progressionCount: number;
  failedAtMs: Ms;
}

export type EngineResult = SuccessResult | FailureResult;

/** 모든 atMs 는 엔진 로컬 시간 (start 기준, 일시정지 시간 제외) */
export type EngineEvent =
  | { type: 'start'; atMs: Ms; progressionCount: number; totalDurationMs: Ms }
  | { type: 'phaseEnter'; atMs: Ms; beatIndex: number; phaseType: PhaseType; phaseId: string; iteration: number }
  | { type: 'windowOpen'; atMs: Ms; beatIndex: number; perfectAtMs: Ms; closeAtMs: Ms }
  | {
      type: 'judge';
      atMs: Ms;
      beatIndex: number;
      phaseType: PhaseType;
      phaseId: string;
      iteration: number;
      grade: Grade;
      /** 입력시각 - 퍼펙트시각. Miss 는 null */
      offsetMs: Ms | null;
      points: number;
      totalScore: number;
      /** 입력이 처리 커서보다 늦게 도착해 앞당겨 처리된 경우 그 차이(ms) */
      clampedMs: Ms;
    }
  | { type: 'cue'; atMs: Ms; actor: Actor; key: SequenceKey; beatIndex: number | null; source: CueSource }
  | { type: 'cueCancelled'; atMs: Ms; actor: Actor; key: SequenceKey; beatIndex: number; scheduledAtMs: Ms }
  | { type: 'inputIgnored'; atMs: Ms | null; reason: IgnoreReason; lockedUntilMs?: Ms }
  | { type: 'paused'; atMs: Ms }
  | { type: 'resumed'; atMs: Ms }
  | { type: 'fail'; atMs: Ms; reason: FailReason; score: ScoreSnapshot }
  | { type: 'ukemi'; atMs: Ms; grade: UkemiGrade; score: ScoreSummary; durationMs: Ms }
  | { type: 'finish'; atMs: Ms; result: EngineResult };

export type EngineListener = (e: EngineEvent) => void;

export interface EngineSnapshot {
  status: EngineStatus;
  paused: boolean;
  /** 엔진 로컬 시간 */
  nowMs: Ms;
  progressionCount: number;
  totalDurationMs: Ms;
  /** now 가 속한 비트 (구간 [startMs, endMs)). 도입 전·던지기 이후 null */
  beatIndex: number | null;
  /** 다음에 판정될 비트. 모두 판정됐으면 null */
  nextJudgeBeat: number | null;
  /** 현재 판정 구간이 열려 있는 비트 */
  openWindowBeat: number | null;
  score: ScoreSnapshot;
  consecutiveMiss: number;
  presses: number;
  lockedUntilMs: Ms | null;
  result: EngineResult | null;
}
