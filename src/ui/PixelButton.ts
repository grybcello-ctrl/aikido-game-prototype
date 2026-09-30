import Phaser from 'phaser';
import { FONT_FAMILY } from '../game/fonts';

export interface PixelButtonOptions {
  width: number;
  height?: number;
  fontSize?: number;
  onClick: () => void;
}

const COLORS = {
  base: 0x1a1a24, hover: 0x2a2a3a, down: 0x3c3c56, selected: 0x24406e,
  border: 0x5c5c78, borderSel: 0x7da8ff, highlight: 0x3a3a50, text: '#e6e6f0',
};

/**
 * 픽셀 스타일 버튼 (Graphics 배경 + Text). 컨테이너 중심 = 버튼 중심.
 * pointerdown 에서 즉시 실행 (터치 반응성). 씬의 원버튼 입력은 버튼 위를 누르면 무시되도록
 * GameScene 에서 currentlyOver 로 걸러낸다.
 */
export class PixelButton extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly bw: number;
  private readonly bh: number;
  private hover = false;
  private down = false;
  private selected = false;

  constructor(scene: Phaser.Scene, x: number, y: number, text: string, opts: PixelButtonOptions) {
    super(scene, Math.round(x), Math.round(y));
    this.bw = opts.width;
    this.bh = opts.height ?? 18;
    this.bg = scene.add.graphics();
    this.label = scene.add.text(0, 0, text, {
      fontFamily: FONT_FAMILY, fontSize: `${opts.fontSize ?? 10}px`, color: COLORS.text,
    }).setOrigin(0.5);
    this.add([this.bg, this.label]);
    this.setSize(this.bw, this.bh);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', () => { this.hover = true; this.redraw(); });
    this.on('pointerout', () => { this.hover = false; this.down = false; this.redraw(); });
    this.on('pointerdown', () => { this.down = true; this.redraw(); opts.onClick(); });
    this.on('pointerup', () => { this.down = false; this.redraw(); });
    scene.add.existing(this);
    this.redraw();
  }

  setLabel(text: string): this {
    this.label.setText(text);
    return this;
  }

  setSelected(on: boolean): this {
    this.selected = on;
    this.redraw();
    return this;
  }

  private redraw(): void {
    const w = this.bw;
    const h = this.bh;
    const x = -Math.floor(w / 2);
    const y = -Math.floor(h / 2);
    const fill = this.down ? COLORS.down : this.hover ? COLORS.hover : this.selected ? COLORS.selected : COLORS.base;
    this.bg.clear();
    this.bg.fillStyle(0x000000, 0.6).fillRect(x + 1, y + 2, w, h); // 그림자
    this.bg.fillStyle(fill).fillRect(x, y, w, h);
    this.bg.fillStyle(COLORS.highlight).fillRect(x + 1, y + 1, w - 2, 1);
    this.bg.lineStyle(1, this.selected ? COLORS.borderSel : COLORS.border).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    this.label.setY(this.down ? 1 : 0);
  }
}
