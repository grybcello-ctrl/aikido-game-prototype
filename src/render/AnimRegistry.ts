import type Phaser from 'phaser';
import { clampAnimFps } from '../config/animation';
import type { AnimationManifest, PoseHint, SequenceDef } from '../types/animations';
import { buildDurations, totalOf } from './frameTiming';
import { CHAR_FRAME, FX_FRAME, TORI_PALETTE, UKE_PALETTE, drawFigure, drawFx } from './placeholderArt';

/** 재생 준비가 끝난 시퀀스 */
export interface ResolvedSequence {
  key: string;
  textureKey: string;
  frames: (string | number)[];
  frameRate: number;
  durations: number[];
  totalMs: number;
  repeat: number;
  source: 'atlas' | 'placeholder' | 'missing';
}

const MISSING_TEXTURE = '__seq_missing';

/**
 * 시퀀스 Key → 텍스처·프레임·타이밍.
 * - atlas 가 지정되고 로드돼 있으면 실제 스프라이트, 아니면 pose 힌트로 플레이스홀더 시트를 생성
 * - 매니페스트에 없는 Key 는 경고 1회 후 마젠타 "missing" 시퀀스로 대체 (게임은 계속)
 * - frameRate 는 10~12fps 로 강제 (범위 밖이면 경고)
 */
export class AnimRegistry {
  private readonly map = new Map<string, ResolvedSequence>();
  private readonly warned = new Set<string>();
  readonly warnings: string[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly manifest: AnimationManifest,
  ) {}

  build(): this {
    this.ensureMissingTexture();
    for (const [key, def] of Object.entries(this.manifest.sequences)) this.map.set(key, this.resolve(key, def));
    return this;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): ResolvedSequence {
    const s = this.map.get(key);
    if (s) return s;
    this.warn(key, `시퀀스 Key '${key}' 가 animations.json 에 없음 → missing 대체`);
    const missing: ResolvedSequence = {
      key, textureKey: MISSING_TEXTURE, frames: [0], frameRate: 10, durations: [100], totalMs: 100, repeat: 0, source: 'missing',
    };
    this.map.set(key, missing);
    return missing;
  }

  private warn(id: string, msg: string): void {
    if (this.warned.has(id)) return;
    this.warned.add(id);
    this.warnings.push(msg);
    console.warn(`[AnimRegistry] ${msg}`);
  }

  private resolve(key: string, def: SequenceDef): ResolvedSequence {
    const fps = clampAnimFps(def.frameRate);
    if (fps !== def.frameRate) this.warn(`${key}:fps`, `${key}: frameRate ${def.frameRate} → ${fps} (10~12fps 고정)`);
    const n = Math.max(1, Math.floor(def.frames));
    const durations = buildDurations(fps, n, def.holds);
    const base = { key, frameRate: fps, durations, totalMs: totalOf(durations), repeat: def.repeat ?? 0 };

    if (def.atlas) {
      const tex = this.scene.textures.exists(def.atlas.texture) ? this.scene.textures.get(def.atlas.texture) : null;
      const start = def.atlas.start ?? 0;
      const pad = def.atlas.zeroPad ?? 2;
      const names = Array.from({ length: n }, (_, i) => `${def.atlas!.prefix}${String(start + i).padStart(pad, '0')}`);
      if (tex && names.every((f) => tex.has(f))) return { ...base, textureKey: def.atlas.texture, frames: names, source: 'atlas' };
      this.warn(`${key}:atlas`, `${key}: 아틀라스 '${def.atlas.texture}' 프레임 없음 → 플레이스홀더`);
    }
    const textureKey = `ph:${key}`;
    this.generatePlaceholder(textureKey, key, def.pose ?? 'stand', n);
    return { ...base, textureKey, frames: Array.from({ length: n }, (_, i) => i), source: 'placeholder' };
  }

  /** 가로 스트립 시트를 캔버스 텍스처로 생성하고 프레임 0..n-1 등록 */
  private generatePlaceholder(textureKey: string, key: string, pose: PoseHint, n: number): void {
    const textures = this.scene.textures;
    if (textures.exists(textureKey)) return;
    const isFx = key.startsWith('fx.');
    const { w, h } = isFx ? FX_FRAME : CHAR_FRAME;
    const tex = textures.createCanvas(textureKey, w * n, h);
    if (!tex) throw new Error(`캔버스 텍스처 생성 실패: ${textureKey}`);
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    const pal = key.startsWith('uke.') ? UKE_PALETTE : TORI_PALETTE;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 1 : i / (n - 1);
      // 프레임 영역으로 클립 → 옆 프레임으로 픽셀이 번지지 않음
      ctx.save();
      ctx.beginPath();
      ctx.rect(i * w, 0, w, h);
      ctx.clip();
      if (isFx) drawFx(ctx, pose, t, i * w, 0);
      else drawFigure(ctx, pose, t, pal, i * w, 0);
      ctx.restore();
      tex.add(i, 0, i * w, 0, w, h);
    }
    tex.refresh();
  }

  private ensureMissingTexture(): void {
    if (this.scene.textures.exists(MISSING_TEXTURE)) return;
    const { w, h } = CHAR_FRAME;
    const tex = this.scene.textures.createCanvas(MISSING_TEXTURE, w, h);
    if (!tex) return;
    const ctx = tex.getContext();
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
      ctx.fillStyle = (x + y) % 8 === 0 ? '#ff00ff' : '#200020';
      ctx.fillRect(x, y, 4, 4);
    }
    tex.add(0, 0, 0, 0, w, h);
    tex.refresh();
  }
}
