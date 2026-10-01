import { SNAP_MS } from '../config/animation';
import type { TimingEngineOptions } from '../engine/TimingEngine';
import type { SpacingMotion } from '../render/Spacing';

export type ModeId = 'flow' | 'arcade' | 'practice';

/**
 * 게임 모드 룰. 엔진(판정)은 그대로 두고, 연출·실패 규칙·진행 흐름만 바꾼다.
 */
export interface ModeRules {
  id: ModeId;
  label: string;
  tagline: string;
  /** 엔진 실패 규칙 덮어쓰기. null = 기술 데이터의 failure 그대로 */
  failure: TimingEngineOptions['failure'] | null;
  /** Perfect 히트스톱 (실시간 ms). null = 없음 */
  hitstop: { perfectMs: number; throwPerfectMs: number } | null;
  /** 카메라 셰이크 강도 (Phaser intensity). null = 없음 */
  shake: { perfect: number; throwPerfect: number } | null;
  /** Phase 3(던지기) Perfect 피니시 셰이크 — cameras.main.shake(200, 0.02) */
  finishShake: boolean;
  /**
   * Phase 3 Perfect 때 하이폴 우케의 비행 (Tween).
   * offscreen = 화면 밖으로 날아감 (피니시 극대화) · arc = 포물선으로 떴다가 낙법 위치에 착지 · none = 제자리
   */
  finishFlight: 'offscreen' | 'arc' | 'none';
  /** 판정 파티클 */
  particles: 'none' | 'light' | 'burst';
  /** 거리 이동 보간 */
  motion: SpacingMotion;
  /** 다음 판정 타이밍 링 표시 */
  showTimingCue: boolean;
  /** 기술 선택 방식 */
  selection: 'cycle' | 'random' | 'fixed';
  /** 진행부 횟수 N */
  progression: 'default' | 'random' | 'selected';
  /** 라운드 종료 후 다음 라운드까지 (가상 ms) */
  autoNextMs: number;
  /** 목숨 (실패 시 -1). null = 무제한 */
  lives: number | null;
}

/** 상단 배속 버튼 순환값 (모든 모드 공통) */
export const SPEEDS = [0.5, 1, 1.5] as const;
export const DEFAULT_SPEED_INDEX = 1;

export const MODES: Record<ModeId, ModeRules> = {
  /** 수련: 역경직·흔들림 없이 물 흐르듯. 실패 없이 기술을 순서대로 이어서 반복 */
  flow: {
    id: 'flow',
    label: '수련',
    tagline: 'FLOW — 역경직 없이 물 흐르듯 이어지는 기술',
    failure: { abortOnMiss: [], maxConsecutiveMiss: null, failOnNoInput: false },
    hitstop: null,
    shake: null,
    finishShake: false, // 수련: 흔들림 없이 물 흐르듯
    finishFlight: 'arc',
    particles: 'none',
    motion: { interpolation: 'smooth', stepMs: SNAP_MS, moveScale: 1.8, missStillMoves: true },
    showTimingCue: true,
    selection: 'cycle',
    progression: 'default',
    autoNextMs: 500,
    lives: null,
  },
  /** 게임: SF3 블로킹 — Perfect 순간 화면 정지 + 셰이크 + 파티클. 실패 규칙·목숨 적용 */
  arcade: {
    id: 'arcade',
    label: '게임',
    tagline: 'ARCADE — Perfect 에 히트스톱 · 셰이크 · 스파크',
    failure: null,
    hitstop: { perfectMs: 110, throwPerfectMs: 150 },
    shake: { perfect: 0.006, throwPerfect: 0.012 },
    finishShake: true,
    finishFlight: 'offscreen',
    particles: 'burst',
    motion: { interpolation: 'stepped', stepMs: SNAP_MS, moveScale: 1, missStillMoves: false },
    showTimingCue: false,
    selection: 'random',
    progression: 'random',
    autoNextMs: 900,
    lives: 3,
  },
  /** 연습: 선택한 기술만 반복. 타이밍 링 + 배속 조절 */
  practice: {
    id: 'practice',
    label: '연습',
    tagline: 'PRACTICE — 한 기술 반복 · ←→ 기술 · ↑↓ 진행 횟수',
    failure: null,
    hitstop: null,
    shake: null,
    finishShake: true,
    finishFlight: 'arc', // 연습·TEST: 착지 후 낙법 연출까지 확인
    particles: 'light',
    motion: { interpolation: 'stepped', stepMs: SNAP_MS, moveScale: 1, missStillMoves: false },
    showTimingCue: true,
    selection: 'fixed',
    progression: 'selected',
    autoNextMs: 700,
    lives: null,
  },
};
