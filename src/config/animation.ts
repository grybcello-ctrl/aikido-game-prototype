/**
 * 리미티드 애니메이션 정책: 게임 루프 60fps, 스프라이트 재생 10~12fps 고정.
 * 보간 없이 프레임을 딱딱 끊고, 키포즈는 holds(틱 유지)로 묵직하게 멈춘다.
 */
export const ANIM_FPS = { MIN: 10, MAX: 12, DEFAULT: 12 } as const;

export const clampAnimFps = (fps: number): number =>
  Number.isFinite(fps) ? Math.min(ANIM_FPS.MAX, Math.max(ANIM_FPS.MIN, Math.round(fps))) : ANIM_FPS.DEFAULT;

/** 12fps 1틱 (스텝 이동 격자) */
export const SNAP_MS = 1000 / ANIM_FPS.DEFAULT;
