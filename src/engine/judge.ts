import type { Grade, JudgeWindow, Ms, WindowTier } from '../types/technique';

/** 대칭/비대칭 허용 오차를 { early, late } 로 정규화 */
export const tierOf = (t: WindowTier): { early: Ms; late: Ms } =>
  typeof t === 'number' ? { early: t, late: t } : t;

/**
 * 오차 d(= 입력시각 - 퍼펙트시각) → 등급.
 * 가장 좁은 구간부터 |d| ≤ perfect → Perfect, ≤ good → Good, ≤ bad → Bad (경계 포함).
 * d < 0 은 early, d ≥ 0 은 late 허용치를 쓴다. 모든 구간 밖이면 null.
 */
export const judgeOffset = (w: JudgeWindow, d: Ms): Exclude<Grade, 'miss'> | null => {
  const side = d < 0 ? 'early' : 'late';
  const a = Math.abs(d);
  if (a <= tierOf(w.perfect)[side]) return 'perfect';
  if (a <= tierOf(w.good)[side]) return 'good';
  if (a <= tierOf(w.bad)[side]) return 'bad';
  return null;
};
