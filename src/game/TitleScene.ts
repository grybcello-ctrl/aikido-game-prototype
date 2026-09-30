import Phaser from 'phaser';
import manifestJson from '../../data/animations.json';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/gameConfig';
import { CHARACTER_TEXTURES, addCharacterSprite, preloadCharacterSprites } from '../art/characterSprites';
import { AnimRegistry } from '../render/AnimRegistry';
import type { AnimationManifest } from '../types/animations';
import { PixelButton } from '../ui/PixelButton';
import { FONT_FAMILY } from './fonts';
import { MODES, type ModeId } from './modes';

const MANIFEST = manifestJson as unknown as AnimationManifest;
export const MODE_REGISTRY_KEY = 'aikido.mode';
const MODE_ORDER: ModeId[] = ['flow', 'arcade', 'practice'];

/**
 * 타이틀 씬
 * - 중앙 일러스트 (더미 사각형 패널 + 파랑 토리 / 빨강 우케 플레이스홀더 스프라이트 ×2 정수 확대)
 * - "Touch to Start" 스텝 깜빡임 (보간 없는 12fps 감성)
 * - 모드 선택 버튼 (수련 / 게임 / 연습), 화면 아무 곳이나 터치 · Space · Enter → 게임 진입
 */
export class TitleScene extends Phaser.Scene {
  private starting = false;
  private mode: ModeId = 'flow';
  private modeButtons: Partial<Record<ModeId, PixelButton>> = {};
  private tagline!: Phaser.GameObjects.Text;

  constructor() {
    super('title');
  }

  /** SVG Data URI → player_idle / enemy_idle 텍스처 */
  preload(): void {
    preloadCharacterSprites(this);
  }

  create(): void {
    this.starting = false;
    this.mode = (this.registry.get(MODE_REGISTRY_KEY) as ModeId | undefined) ?? 'flow';
    new AnimRegistry(this, MANIFEST).build(); // 플레이스홀더 텍스처 준비 (전역 텍스처 캐시 공유)
    this.cameras.main.setBackgroundColor(0x0d0d12).fadeIn(200, 0, 0, 0);

    this.drawBackdrop();
    this.drawIllustration();

    const font = (size: number, color = '#e6e6f0') => ({ fontFamily: FONT_FAMILY, fontSize: `${size}px`, color, stroke: '#000000', strokeThickness: 3 });
    this.add.text(GAME_WIDTH / 2, 24, 'AIKIDO ONE-BUTTON', { ...font(20), fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, 44, '아이키도 원버튼 — 마아이와 무스비', font(10, '#9aa0b8')).setOrigin(0.5);

    // "Touch to Start" 스텝 깜빡임: 보임 600ms / 숨김 300ms
    const start = this.add.text(GAME_WIDTH / 2, 258, 'Touch to Start', { ...font(16, '#fff4c2'), fontStyle: 'bold' }).setOrigin(0.5);
    let visible = true;
    this.time.addEvent({
      loop: true,
      delay: 300,
      callback: (() => {
        let tick = 0;
        return () => {
          tick = (tick + 1) % 3;
          visible = tick !== 0;
          start.setVisible(visible);
        };
      })(),
    });

    // 모드 선택
    MODE_ORDER.forEach((id, i) => {
      this.modeButtons[id] = new PixelButton(this, GAME_WIDTH / 2 + (i - 1) * 76, 292, MODES[id].label, {
        width: 68, height: 20, fontSize: 11, onClick: () => this.selectMode(id),
      });
    });
    this.tagline = this.add.text(GAME_WIDTH / 2, 314, '', font(9, '#9aa0b8')).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 12, 'Space · Enter · 터치 = 시작     1 2 3 = 모드', font(9, '#6c6c80')).setOrigin(0.5);
    this.selectMode(this.mode);

    // 버튼 밖 터치 → 시작
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (!over.length) this.startGame();
    });
    const kb = this.input.keyboard;
    kb?.on('keydown-SPACE', () => this.startGame());
    kb?.on('keydown-ENTER', () => this.startGame());
    kb?.on('keydown-ONE', () => this.selectMode('flow'));
    kb?.on('keydown-TWO', () => this.selectMode('arcade'));
    kb?.on('keydown-THREE', () => this.selectMode('practice'));
  }

  private selectMode(id: ModeId): void {
    this.mode = id;
    this.registry.set(MODE_REGISTRY_KEY, id);
    for (const m of MODE_ORDER) this.modeButtons[m]?.setSelected(m === id);
    this.tagline.setText(MODES[id].tagline);
  }

  private startGame(): void {
    if (this.starting) return;
    this.starting = true;
    this.cameras.main.flash(80, 255, 255, 255);
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('game', { mode: this.mode }));
  }

  private drawBackdrop(): void {
    const g = this.add.graphics();
    const bands = [0x0d0d12, 0x11111a, 0x151520, 0x1a1a27];
    bands.forEach((c, i) => g.fillStyle(c).fillRect(0, 60 + i * 40, GAME_WIDTH, 40));
    g.fillStyle(0x1a1a27).fillRect(0, 220, GAME_WIDTH, GAME_HEIGHT - 220);
  }

  /** 중앙 일러스트: 더미 사각형 패널 + 두 캐릭터가 붙어 선 던지기 장면 */
  private drawIllustration(): void {
    const px = GAME_WIDTH / 2 - 130;
    const py = 60;
    const pw = 260;
    const ph = 176;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.6).fillRect(px + 3, py + 4, pw, ph);
    g.fillStyle(0x2a2233).fillRect(px, py, pw, ph);
    // 하늘 띠 + 원(해) + 바닥 — 전부 사각형 도트
    [0x3a2d45, 0x4a3450, 0x5c3c55, 0x6e4554].forEach((c, i) => g.fillStyle(c).fillRect(px + 4, py + 4 + i * 37, pw - 8, 37));
    g.fillStyle(0xf2c46d);
    for (let dy = -18; dy <= 18; dy += 2) {
      const half = Math.round(Math.sqrt(18 * 18 - dy * dy));
      g.fillRect(px + 44 - half, py + 40 + dy, half * 2, 2); // 해는 캐릭터 머리와 겹치지 않게 왼쪽 위
    }
    g.fillStyle(0x4b5a2c).fillRect(px + 4, py + 150, pw - 8, ph - 154);
    g.fillStyle(0x5d6d37);
    for (let x = px + 4; x < px + pw - 4; x += 32) g.fillRect(x, py + 150, 1, ph - 154);
    g.fillStyle(0x1b2010).fillRect(px + 4, py + 150, pw - 8, 1);
    g.lineStyle(2, 0x8a7a5a).strokeRect(px + 1, py + 1, pw - 2, ph - 2);

    // 두 캐릭터 (근접, 자연체로 마주 봄) — 64x64 픽셀 아트를 ×2 정수 확대
    const floor = py + 162;
    addCharacterSprite(this, GAME_WIDTH / 2 - 40, floor, CHARACTER_TEXTURES.player, 2);
    addCharacterSprite(this, GAME_WIDTH / 2 + 40, floor, CHARACTER_TEXTURES.enemy, 2).setFlipX(true);
  }
}
