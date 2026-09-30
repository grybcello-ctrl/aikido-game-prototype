import type Phaser from 'phaser';
import type { AnimRegistry } from './AnimRegistry';
import { AnimationController } from './AnimationController';

/** fx 액터 큐: 접촉 지점에 1회성 스프라이트를 띄우고 재생이 끝나면 제거 */
export class FxLayer {
  private items: { sprite: Phaser.GameObjects.Sprite; ctrl: AnimationController }[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly registry: AnimRegistry,
    private readonly depth = 30,
  ) {}

  spawn(key: string, x: number, y: number, atMs: number): void {
    const sprite = this.scene.add.sprite(Math.round(x), Math.round(y), '__DEFAULT').setOrigin(0.5).setDepth(this.depth);
    const ctrl = new AnimationController(sprite, this.registry);
    ctrl.play(key, atMs);
    this.items.push({ sprite, ctrl });
  }

  update(nowMs: number): void {
    this.items = this.items.filter(({ sprite, ctrl }) => {
      ctrl.update(nowMs);
      if (!ctrl.finished(nowMs)) return true;
      sprite.destroy();
      return false;
    });
  }

  clear(): void {
    this.items.forEach((i) => i.sprite.destroy());
    this.items = [];
  }
}
