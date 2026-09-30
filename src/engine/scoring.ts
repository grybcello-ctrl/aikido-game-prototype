import type {
  Grade, JudgementRecord, ScheduledBeat, ScoreSummary, Scoring, UkemiGrade, UkemiMapping,
} from '../types/technique';
import type { ScoreSnapshot } from './types';

/** 부동소수 비교 여유 (weight 가 소수일 때 누적 오차 흡수) */
const EPS = 1e-9;

export const pointsFor = (scoring: Scoring, grade: Grade, weight: number): number =>
  scoring.points[grade] * weight;

/**
 * 최종 점수 비율 → 낙법 등급.
 * ratio ≥ thresholds.perfect → Perfect, ratio ≥ thresholds.good → Good, 그 외 → Bad.
 */
export const decideUkemi = (ratio: number, thresholds: UkemiMapping['thresholds']): UkemiGrade => {
  if (!Number.isFinite(ratio)) return 'bad';
  if (ratio + EPS >= thresholds.perfect) return 'perfect';
  if (ratio + EPS >= thresholds.good) return 'good';
  return 'bad';
};

/** 판정 누적기. 만점(max)은 이번 판에 예정된 모든 비트 기준으로 고정 */
export class ScoreBoard {
  private readonly records: JudgementRecord[] = [];
  private raw = 0;
  private readonly counts: Record<Grade, number> = { perfect: 0, good: 0, bad: 0, miss: 0 };
  readonly max: number;

  constructor(
    private readonly scoring: Scoring,
    private readonly beats: readonly ScheduledBeat[],
  ) {
    this.max = beats.reduce((s, b) => s + pointsFor(scoring, 'perfect', b.weight), 0);
  }

  add(beatIndex: number, grade: Grade, offsetMs: number | null): JudgementRecord {
    const beat = this.beats[beatIndex];
    if (!beat) throw new RangeError(`beatIndex ${beatIndex} 범위 밖`);
    if (this.records.some((r) => r.beatIndex === beatIndex)) throw new Error(`beat ${beatIndex} 중복 판정`);
    const rec: JudgementRecord = { beatIndex, grade, offsetMs, points: pointsFor(this.scoring, grade, beat.weight) };
    this.records.push(rec);
    this.raw += rec.points;
    this.counts[grade]++;
    return rec;
  }

  get total(): number {
    return this.raw;
  }

  get judgements(): JudgementRecord[] {
    return this.records.map((r) => ({ ...r }));
  }

  snapshot(): ScoreSnapshot {
    return {
      raw: this.raw,
      max: this.max,
      ratio: this.max > 0 ? this.raw / this.max : 0,
      counts: { ...this.counts },
      judged: this.records.length,
      total: this.beats.length,
    };
  }

  /** 모든 비트 판정 후 최종 요약 + 낙법 결정 */
  summarize(thresholds: UkemiMapping['thresholds']): ScoreSummary {
    const s = this.snapshot();
    return { raw: s.raw, max: s.max, ratio: s.ratio, counts: s.counts, ukemi: decideUkemi(s.ratio, thresholds) };
  }
}
