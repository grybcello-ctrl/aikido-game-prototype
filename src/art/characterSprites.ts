import type Phaser from 'phaser';
import { SPRITES, SPRITE_FOOT_Y, SPRITE_SIZE, type SpriteKey } from './sprites.generated';

/** 텍스처 키 (animations.json 의 "image" 와 동일) */
export const CHARACTER_TEXTURES = {
  player: 'player_idle',
  enemy: 'enemy_idle',
  /** 입신·전환 키포즈 — Phase 2 Perfect 에서 교체 (적 앞에 그림) */
  playerIrimi: 'player_irimi',
  /** 적 정면타 타격 키포즈 — Phase 1(적 공격) 에서 교체 */
  enemyShomenuchi: 'enemy_shomenuchi',
  /** 던지기 피니시 (카케·잔심) — Phase 3 Perfect 에서 교체 */
  playerThrow: 'player_throw',
  /** 완벽한 하이폴 낙법 체공 — Phase 3 Perfect 에서 교체 */
  enemyUkemiPerfect: 'enemy_ukemi_perfect',
  // ── Dynamic Aikido 키포즈 (현재 기본) ──
  /** Phase 1: 우케가 쇄도하며 손날 정면타 */
  ukeAttack: 'uke_attack',
  /** Phase 2 Perfect: 나게가 사각으로 깊게 입신 (적 앞에 그림) */
  nageIrimi: 'nage_irimi',
  /** Phase 3 Perfect: 나게 중심 낙하 던지기 · 잔심 */
  nageThrow: 'nage_throw',
  /** Phase 3 Perfect: 우케 거꾸로 뜬 다이내믹 하이폴 */
  ukeHighfall: 'uke_highfall',
} as const satisfies Record<string, SpriteKey>;

/** 입신 키포즈: 적의 사각에 파고든 상태라 토리를 우케 앞에 그린다 */
export const FRONT_OF_UKE_TEXTURES: ReadonlySet<string> = new Set([CHARACTER_TEXTURES.playerIrimi, CHARACTER_TEXTURES.nageIrimi]);
export type CharacterTexture = SpriteKey;

export const isCharacterTexture = (key: string): key is SpriteKey => key in SPRITES;

/** 대기 포즈 발바닥이 바닥선에 오도록 하는 originY */
export const CHARACTER_ORIGIN_Y = SPRITE_FOOT_Y / SPRITE_SIZE;

/** 텍스처별 originY (포즈마다 발 위치가 다를 수 있음). 모르는 키는 1 */
export const originYFor = (key: string): number =>
  isCharacterTexture(key) ? SPRITES[key].footY / SPRITE_SIZE : 1;

/**
 * preload() 에서 호출: SVG Data URI → 64x64 텍스처 (player_idle, enemy_idle, enemy_shomenuchi …).
 * load.image + data: URI 는 <img> 디코딩 경로를 타므로 file:// 로 연 단일 HTML 에서도 동작한다.
 * 이미 로드된 키는 건너뛴다 (씬 재진입 시 중복 로드 방지).
 */
export const preloadCharacterSprites = (scene: Phaser.Scene): void => {
  for (const s of Object.values(SPRITES)) if (!scene.textures.exists(s.key)) scene.load.image(s.key, s.uri);
};

/**
 * 캐릭터 스프라이트 배치: 정수 좌표 + 정수 배율만 허용 (비정수 배율은 도트가 불균일해짐).
 * @param scale 1, 2, 3 … (정수)
 */
export const addCharacterSprite = (
  scene: Phaser.Scene, x: number, floorY: number, texture: CharacterTexture, scale = 1,
): Phaser.GameObjects.Sprite => {
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError(`캐릭터 배율은 1 이상 정수여야 함 (받은 값: ${scale})`);
  return scene.add.sprite(Math.round(x), Math.round(floorY), texture).setOrigin(0.5, originYFor(texture)).setScale(scale);
};
