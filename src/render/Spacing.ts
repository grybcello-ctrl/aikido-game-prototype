import type { Grade, SpacingMove, TechniqueData } from '../types/technique';

/**
 * 토리↔우케 거리(마아이) 컨트롤러 — Phaser 비의존.
 * 판정 순간(플레이어 입력 시각)에 데이터의 spacing 목표로 이동을 시작한다.
 * - Perfect = 목표 그대로, Good/Bad = slackPx 만큼 덜 좁힘, Miss = 이동 없음(모드에 따라 이동)
 * - smooth: 60fps 연속 보간(수련 모드) / stepped: 12fps 격자로 끊어 이동(게임·연습 모드)
 */
export interface SpacingMotion {
  interpolation: 'smooth' | 'stepped';
  /** stepped 격자 (ms) */
  stepMs: number;
  /** 이동 시간 배율 (수련 모드는 느긋하게) */
  moveScale: number;
  /** Miss 여도 이동할지 (흐름 유지) */
  missStillMoves: boolean;
}

export interface SpacingPositions { toriX: number; ukeX: number; distance: number }

interface Move { start: number; dur: number; fromT: number; fromU: number; toT: number; toU: number }

export const DEFAULT_START_PX = 80;
const DEFAULT_MOVE_MS = 120;
/** 겹침 방지 최소 거리 */
export const MIN_DISTANCE_PX = 8;

const sineInOut = (k: number) => -(Math.cos(Math.PI * k) - 1) / 2;
const cubicOut = (k: number) => 1 - (1 - k) ** 3;

export class Spacing {
  private move: Move | null = null;
  private baseT = 0;
  private baseU = 0;

  constructor(
    private readonly tech: TechniqueData,
    private readonly motion: SpacingMotion,
    private readonly centerX: number,
  ) {
    this.reset();
  }

  get startPx(): number {
    return this.tech.spacing?.startPx ?? DEFAULT_START_PX;
  }

  reset(): void {
    const d = this.startPx;
    this.baseT = this.centerX - d / 2;
    this.baseU = this.centerX + d / 2;
    this.move = null;
  }

  /** 판정 이벤트 → 해당 페이즈 spacing 적용 */
  onJudge(move: SpacingMove | undefined, grade: Grade, atMs: number): void {
    if (!move) return;
    if (grade === 'miss' && !this.motion.missStillMoves) return;
    const slack = this.tech.spacing?.slackPx;
    const extra = grade === 'good' ? slack?.good ?? 0 : grade === 'bad' || grade === 'miss' ? slack?.bad ?? 0 : 0;
    this.moveTo(move, atMs, extra);
  }

  /** 낙법 시작 → 우케가 날아가는 거리 */
  onUkemi(move: SpacingMove | undefined, atMs: number): void {
    if (move) this.moveTo(move, atMs, 0);
  }

  positions(nowMs: number): SpacingPositions {
    const p = this.sample(nowMs, true);
    const toriX = Math.round(p.t);
    const ukeX = Math.round(p.u);
    return { toriX, ukeX, distance: ukeX - toriX };
  }

  /** 정확한(격자 미적용) 거리 */
  distanceAt(nowMs: number): number {
    const p = this.sample(nowMs, false);
    return p.u - p.t;
  }

  private sample(now: number, quantize: boolean): { t: number; u: number } {
    const m = this.move;
    if (!m) return { t: this.baseT, u: this.baseU };
    let k = m.dur <= 0 ? 1 : Math.min(1, Math.max(0, (now - m.start) / m.dur));
    let e: number;
    if (this.motion.interpolation === 'stepped') {
      if (quantize && k > 0 && k < 1) {
        // 최소 2스텝: 짧은 이동도 "딛고-멈춤" 두 박자로 보이게
        const steps = Math.max(2, Math.round(m.dur / this.motion.stepMs));
        k = Math.min(1, Math.ceil(k * steps) / steps); // 첫 스텝을 즉시 → 입력 반응이 바로 보임
      }
      e = cubicOut(k);
    } else {
      e = sineInOut(k);
    }
    return { t: m.fromT + (m.toT - m.fromT) * e, u: m.fromU + (m.toU - m.fromU) * e };
  }

  private moveTo(move: SpacingMove, at: number, slack: number): void {
    const cur = this.sample(at, false);
    const d0 = cur.u - cur.t;
    let d1 = move.targetPx !== undefined ? move.targetPx : d0 + (move.deltaPx ?? 0);
    if (d1 < d0) d1 = Math.min(d0, d1 + slack); // 좁히는 이동만 여유 적용
    d1 = Math.max(MIN_DISTANCE_PX, d1);
    const delta = d1 - d0;
    const anchor = move.anchor ?? 'tori';
    const toT = anchor === 'tori' ? cur.t - delta : anchor === 'center' ? cur.t - delta / 2 : cur.t;
    const toU = anchor === 'uke' ? cur.u + delta : anchor === 'center' ? cur.u + delta / 2 : cur.u;
    const dur = (move.moveMs ?? this.tech.spacing?.moveMs ?? DEFAULT_MOVE_MS) * this.motion.moveScale;
    this.baseT = cur.t;
    this.baseU = cur.u;
    this.move = { start: at, dur, fromT: cur.t, fromU: cur.u, toT, toU };
  }
}
