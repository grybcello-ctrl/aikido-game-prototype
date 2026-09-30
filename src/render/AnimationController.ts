import type Phaser from 'phaser';
import type { AnimRegistry, ResolvedSequence } from './AnimRegistry';
import { frameIndexAt, isFinishedAt } from './frameTiming';

/**
 * 시퀀스 시작 Key 를 받아 스프라이트를 재생 (Phaser anims 대신 가상시간 기준 수동 재생).
 * - 프레임 인덱스 = f(가상시간 - 시작 시각) → 히트스톱·슬로·일시정지와 완벽히 동기
 * - 10~12fps 이산 프레임 + holds(키포즈 정지) → 보간 없는 묵직한 스내피 질감
 * - 같은 Key 를 다시 받아도 처음부터 재생 (타격 반복 등)
 */
export class AnimationController {
  private seq: ResolvedSequence | null = null;
  private startAt = 0;
  private shown = -1;

  constructor(
    private readonly sprite: Phaser.GameObjects.Sprite,
    private readonly registry: AnimRegistry,
  ) {}

  /** @param atMs 이 시퀀스가 시작돼야 하는 가상시간 (이미 지난 시각이면 그만큼 진행된 프레임부터) */
  play(key: string, atMs: number): void {
    const s = this.registry.get(key);
    this.seq = s;
    this.startAt = atMs;
    this.shown = -1;
    this.sprite.setTexture(s.textureKey, s.frames[0]);
  }

  update(nowMs: number): void {
    const s = this.seq;
    if (!s) return;
    const i = frameIndexAt(s.durations, s.repeat, nowMs - this.startAt);
    if (i === this.shown) return;
    this.shown = i;
    this.sprite.setFrame(s.frames[i] as string | number);
  }

  finished(nowMs: number): boolean {
    return !this.seq || isFinishedAt(this.seq.durations, this.seq.repeat, nowMs - this.startAt);
  }

  get key(): string | null {
    return this.seq?.key ?? null;
  }

  get frame(): number {
    return this.shown;
  }
}
