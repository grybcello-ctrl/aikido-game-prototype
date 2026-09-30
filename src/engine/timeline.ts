import type {
  AbsRange, Phase, ProgressionPhase, ResolvedTimeline, ScheduledBeat, ScheduledCue, TechniqueData,
} from '../types/technique';
import { EngineArgumentError } from './errors';
import { tierOf } from './judge';

/**
 * 진행부 i 번째 회차의 실제 페이즈 (steps 가 있으면 steps[i % length] 로 타이밍 덮어쓰기).
 * 반환 객체는 type / id / onJudge / spacing / weight 를 공통값으로 유지 → 엔진·렌더러가 그대로 사용.
 */
export const progressionIteration = (prog: ProgressionPhase, i: number): ProgressionPhase => {
  const steps = prog.steps;
  if (!steps?.length) return prog;
  const s = steps[i % steps.length]!;
  return {
    ...prog,
    ...(s.label !== undefined ? { label: s.label } : {}),
    durationMs: s.durationMs,
    perfectMs: s.perfectMs,
    window: s.window,
    animations: s.animations?.length ? s.animations : prog.animations,
  };
};

/** 판정 1회(비트) 순서: 도입부 1 → 진행부 N → 던지기 1 */
export const beatPhases = (data: TechniqueData, n: number): { phase: Phase; iteration: number }[] => {
  const [intro, prog, thr] = data.phases;
  return [
    { phase: intro, iteration: 0 },
    ...Array.from({ length: n }, (_, i) => ({ phase: progressionIteration(prog, i) as Phase, iteration: i })),
    { phase: thr, iteration: 0 },
  ];
};

/** 도입~던지기 합계 (낙법 제외) */
export const computeTotalDuration = (data: TechniqueData, progressionCount: number): number =>
  beatPhases(data, progressionCount).reduce((sum, b) => sum + b.phase.durationMs, 0);

/** 진행부 횟수 검증. 정수이고 repeat.min ~ repeat.max 안이어야 함 */
export const assertProgressionCount = (data: TechniqueData, n: number): void => {
  const { min, max } = data.phases[1].repeat;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new EngineArgumentError(`progressionCount 는 ${min}~${max} 사이 정수여야 함 (받은 값: ${n})`);
  }
};

/**
 * TechniqueData + 실제 진행부 횟수 N → 절대 시각(기술 시작 기준) 타임라인.
 * 비트마다 판정 구간과 기본 애니메이션 큐를 펼친다.
 */
export const resolveTimeline = (data: TechniqueData, progressionCount: number): ResolvedTimeline => {
  assertProgressionCount(data, progressionCount);
  const beats: ScheduledBeat[] = [];
  const cues: ScheduledCue[] = [];
  let clock = 0;

  beatPhases(data, progressionCount).forEach(({ phase, iteration }, index) => {
    const at = clock + phase.perfectMs;
    const range = (t: Parameters<typeof tierOf>[0]): AbsRange => {
      const { early, late } = tierOf(t);
      return [at - early, at + late];
    };
    beats.push({
      index,
      phaseType: phase.type,
      phaseId: phase.id,
      iteration,
      startMs: clock,
      endMs: clock + phase.durationMs,
      perfectAtMs: at,
      window: { perfect: range(phase.window.perfect), good: range(phase.window.good), bad: range(phase.window.bad) },
      weight: phase.weight ?? 1,
    });
    for (const c of phase.animations) cues.push({ ...c, absMs: clock + c.atMs, beatIndex: index });
    clock += phase.durationMs;
  });

  return {
    techniqueId: data.id,
    progressionCount,
    totalDurationMs: clock,
    beats,
    cues,
    ukemiStartMs: clock,
  };
};
