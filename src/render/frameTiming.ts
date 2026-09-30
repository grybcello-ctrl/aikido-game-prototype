import { clampAnimFps } from '../config/animation';

/** 프레임별 표시 시간(ms). holds = { 인덱스: 틱 수 } */
export const buildDurations = (frameRate: number, frames: number, holds: Record<string, number> = {}): number[] => {
  const tick = 1000 / clampAnimFps(frameRate);
  return Array.from({ length: Math.max(1, Math.floor(frames)) }, (_, i) => tick * Math.max(1, holds[String(i)] ?? 1));
};

export const totalOf = (durations: readonly number[]): number => durations.reduce((s, d) => s + d, 0);

/**
 * 시퀀스 시작 후 경과 ms → 프레임 인덱스.
 * repeat -1 = 무한 반복, 0 이상 = (repeat+1)회 재생 후 마지막 프레임 유지.
 */
export const frameIndexAt = (durations: readonly number[], repeat: number, elapsedMs: number): number => {
  const n = durations.length;
  const total = totalOf(durations);
  let t = Math.max(0, elapsedMs);
  if (repeat === -1) t %= total;
  else if (t >= total * (repeat + 1)) return n - 1;
  else t %= total;
  for (let i = 0; i < n; i++) {
    const d = durations[i] as number;
    if (t < d) return i;
    t -= d;
  }
  return n - 1;
};

export const isFinishedAt = (durations: readonly number[], repeat: number, elapsedMs: number): boolean =>
  repeat !== -1 && elapsedMs >= totalOf(durations) * (repeat + 1);
