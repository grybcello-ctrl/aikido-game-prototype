import type Phaser from 'phaser';
import { FLOOR_Y, GAME_HEIGHT, GAME_WIDTH } from '../config/gameConfig';

/** 도장 배경 (픽셀 도트) — GameScene · EditorScene 공통 */
export const drawDojo = (scene: Phaser.Scene): Phaser.GameObjects.Graphics => {
  const g = scene.add.graphics().setDepth(0);
  g.fillStyle(0x16141c).fillRect(0, 0, GAME_WIDTH, FLOOR_Y);
  g.fillStyle(0x221e28).fillRect(0, 40, GAME_WIDTH, 6);
  for (let x = 16; x < GAME_WIDTH; x += 96) g.fillStyle(0x2b2530).fillRect(x, 46, 8, FLOOR_Y - 46);
  g.fillStyle(0x3a2f22).fillRect(GAME_WIDTH / 2 - 60, 70, 120, 44);
  g.fillStyle(0x4a3c2b).fillRect(GAME_WIDTH / 2 - 56, 74, 112, 36);
  g.fillStyle(0x6b5536).fillRect(GAME_WIDTH / 2 - 2, 80, 4, 24);
  g.fillStyle(0x4b5a2c).fillRect(0, FLOOR_Y, GAME_WIDTH, GAME_HEIGHT - FLOOR_Y);
  g.fillStyle(0x5d6d37);
  for (let x = 0; x < GAME_WIDTH; x += 64) g.fillRect(x, FLOOR_Y, 1, GAME_HEIGHT - FLOOR_Y);
  g.fillStyle(0x3c4823).fillRect(0, FLOOR_Y + 30, GAME_WIDTH, 1);
  g.fillStyle(0x1b2010).fillRect(0, FLOOR_Y, GAME_WIDTH, 1);
  return g;
};
