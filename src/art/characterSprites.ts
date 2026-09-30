import type Phaser from 'phaser';
import { ENEMY_IDLE_URI, PLAYER_IDLE_URI, SPRITE_FOOT_Y, SPRITE_SIZE } from './sprites.generated';

/** 텍스처 키 (animations.json 의 "image" 와 동일) */
export const CHARACTER_TEXTURES = { player: 'player_idle', enemy: 'enemy_idle' } as const;
export type CharacterTexture = (typeof CHARACTER_TEXTURES)[keyof typeof CHARACTER_TEXTURES];

/** 발바닥이 바닥선에 오도록 하는 originY */
export const CHARACTER_ORIGIN_Y = SPRITE_FOOT_Y / SPRITE_SIZE;

/**
 * preload() 에서 호출: SVG Data URI → 64x64 텍스처.
 * load.image + data: URI 는 <img> 디코딩 경로를 타므로 file:// 로 연 단일 HTML 에서도 동작한다.
 * 이미 로드된 키는 건너뛴다 (씬 재진입 시 중복 로드 방지).
 */
export const preloadCharacterSprites = (scene: Phaser.Scene): void => {
  const load = (key: string, uri: string) => {
    if (!scene.textures.exists(key)) scene.load.image(key, uri);
  };
  load(CHARACTER_TEXTURES.player, PLAYER_IDLE_URI);
  load(CHARACTER_TEXTURES.enemy, ENEMY_IDLE_URI);
};

/**
 * 캐릭터 스프라이트 배치: 정수 좌표 + 정수 배율만 허용 (비정수 배율은 도트가 불균일해짐).
 * @param scale 1, 2, 3 … (정수)
 */
export const addCharacterSprite = (
  scene: Phaser.Scene, x: number, floorY: number, texture: CharacterTexture, scale = 1,
): Phaser.GameObjects.Sprite => {
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError(`캐릭터 배율은 1 이상 정수여야 함 (받은 값: ${scale})`);
  return scene.add.sprite(Math.round(x), Math.round(floorY), texture).setOrigin(0.5, CHARACTER_ORIGIN_Y).setScale(scale);
};
