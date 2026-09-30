import Phaser from 'phaser';

export const GAME_WIDTH = 640;
export const GAME_HEIGHT = 360;
/** 캐릭터 발 기준선 */
export const FLOOR_Y = 300;
export const STAGE_CENTER_X = GAME_WIDTH / 2;

/**
 * 640x360 Pixel-perfect 설정
 * - pixelArt: 최근접 필터링 / roundPixels: 정수 좌표 렌더 / antialias off
 * - Scale.NONE + 정수 배율 줌(installIntegerZoom) → 화면 픽셀이 고르게 확대됨 (FIT 의 비정수 배율 번짐 방지)
 * - 로직 60fps (smoothStep off: 프레임 시간 스무딩 없이 실제 시각으로 판정)
 */
export const createGameConfig = (scenes: Phaser.Types.Scenes.SceneType[], parent = 'game'): Phaser.Types.Core.GameConfig => ({
  type: Phaser.AUTO,
  parent,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#0d0d12',
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  render: { pixelArt: true, antialias: false, roundPixels: true, powerPreference: 'high-performance' },
  scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.CENTER_BOTH, zoom: 1 },
  fps: { target: 60, smoothStep: false },
  input: { keyboard: true, touch: true, mouse: true },
  scene: scenes,
});

/** 창 크기에 맞춰 정수 배율 줌. 640x360 보다 작은 화면만 비정수 축소 */
export const installIntegerZoom = (game: Phaser.Game): (() => void) => {
  const apply = () => {
    if (!game.canvas) return; // 부팅 전(캔버스 생성 전)에는 적용 불가
    const ratio = Math.min(window.innerWidth / GAME_WIDTH, window.innerHeight / GAME_HEIGHT);
    game.scale.setZoom(ratio >= 1 ? Math.floor(ratio) : ratio);
  };
  window.addEventListener('resize', apply);
  // Phaser 는 DOM 준비 후 비동기로 부팅 → READY 이후에 첫 적용 (이미 부팅됐으면 즉시)
  if (game.isBooted && game.canvas) apply();
  else game.events.once(Phaser.Core.Events.READY, apply);
  return () => window.removeEventListener('resize', apply);
};
