import Phaser from 'phaser';
import manifestJson from '../../data/animations.json';
import katatedoriShihonage from '../../data/techniques/katatedori_shihonage.json';
import shomenuchiIriminage from '../../data/techniques/shomenuchi_iriminage.json';
import { FLOOR_Y, GAME_HEIGHT, GAME_WIDTH, STAGE_CENTER_X } from '../config/gameConfig';
import { TimingEngine } from '../engine/TimingEngine';
import type { EngineEvent, EngineResult, FailReason } from '../engine/types';
import { validateTechnique } from '../engine/validate';
import { bindOneButton } from '../input/oneButton';
import { AnimRegistry } from '../render/AnimRegistry';
import { AnimationController } from '../render/AnimationController';
import { GameClock } from '../render/clock';
import { FxLayer } from '../render/FxLayer';
import { Spacing } from '../render/Spacing';
import type { AnimationManifest } from '../types/animations';
import type { Grade, Phase, PhaseType, TechniqueData, UkemiGrade } from '../types/technique';
import { FONT_FAMILY } from './fonts';
import { MODES, type ModeId, type ModeRules } from './modes';

type Ev<T extends EngineEvent['type']> = Extract<EngineEvent, { type: T }>;
type SceneState = 'title' | 'playing' | 'between' | 'gameover';

/** 로드 시 검증 통과한 기술만 사용 (잘못된 파일은 경고 후 제외) */
export const RAW_TECHNIQUES: unknown[] = [shomenuchiIriminage, katatedoriShihonage];
const MANIFEST = manifestJson as unknown as AnimationManifest;

const GRADE_TEXT: Record<Grade, string> = { perfect: 'PERFECT', good: 'GOOD', bad: 'BAD', miss: 'MISS' };
const GRADE_COLOR: Record<Grade, number> = { perfect: 0x7df9ff, good: 0x9be564, bad: 0xffb347, miss: 0xff5a5f };
const UKEMI_COLOR: Record<UkemiGrade, number> = { perfect: 0x7df9ff, good: 0xffd166, bad: 0xff5a5f };
const PHASE_INDEX: Record<PhaseType, 0 | 1 | 2> = { intro: 0, progression: 1, throw: 2 };
const FAIL_TEXT: Record<FailReason['type'], string> = {
  miss_abort: '타이밍을 놓쳤다',
  consecutive_miss: '흐름이 끊겼다',
  no_input: '입력 없음',
  aborted: '중단',
};
const CHEST_Y = FLOOR_Y - 38;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** HUD 에 쓰는 문자열 (웹폰트 글리프 사전 로드용) */
export const UI_STRINGS = [
  '수련', '게임', '연습', 'Space / 터치', '로 시작', '다음 기술', '목숨', '점수', '콤보', '진행', '배속', '기술',
  '타이밍을 놓쳤다', '흐름이 끊겼다', '입력 없음', '중단', '게임 오버', '다시 시작', '낙법',
  '1 수련 · 2 게임 · 3 연습', '←→ 기술 · ↑↓ 진행 횟수 · T 배속', '데이터 오류', '·', '—', '×', '♥', '♡', '─',
  ...Object.values(MODES).flatMap((m) => [m.label, m.tagline]),
];

/**
 * GameScene — TimingEngine 을 화면에 연결하고 3가지 모드 룰을 적용한다.
 *
 * 시간 흐름: 실시간 → GameClock(배속·히트스톱) → 가상시간 → TimingEngine / 애니메이션 / 거리
 *   (입력 타임스탬프도 같은 GameClock 으로 변환 → 히트스톱 중에도 판정 ms 정확)
 *
 * 엔진 이벤트 → 연출
 *   cue(tori|uke) → AnimationController.play(key, atMs)   (시작 Key → 10~12fps 묵직한 재생)
 *   cue(fx)       → FxLayer.spawn (접촉 지점)
 *   judge         → Spacing.onJudge (판정 순간 거리 좁히기) + 모드별 피드백
 *   ukemi         → Spacing.onUkemi (우케가 날아감) + 결과 표시
 *   fail/finish   → 모드별 다음 라운드 / 목숨 / 게임 오버
 */
export class GameScene extends Phaser.Scene {
  private clock!: GameClock;
  private seqs!: AnimRegistry;
  private techniques: TechniqueData[] = [];
  private dataErrors: string[] = [];

  private mode: ModeRules = MODES.flow;
  private state: SceneState = 'title';
  private engine: TimingEngine | null = null;
  private tech!: TechniqueData;
  private techIndex = 0;
  private practiceN: number | null = null;
  private speedIdx = 0;
  /** 라운드 시작 가상시각. 로컬 시간 = 가상시각 - roundStart (= 엔진 atMs 축) */
  private roundStart = 0;
  private nextAt: number | null = null;
  private run = { score: 0, rounds: 0, lives: 0, combo: 0, maxCombo: 0 };
  private lastResult: EngineResult | null = null;

  private spacing!: Spacing;
  private tori!: Phaser.GameObjects.Sprite;
  private uke!: Phaser.GameObjects.Sprite;
  private toriAnim!: AnimationController;
  private ukeAnim!: AnimationController;
  private fx!: FxLayer;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private cueG!: Phaser.GameObjects.Graphics;
  private hudLeft!: Phaser.GameObjects.Text;
  private hudRight!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Text;
  private judgeText!: Phaser.GameObjects.Text;
  private subText!: Phaser.GameObjects.Text;
  private overlay!: Phaser.GameObjects.Text;
  private overlayBg!: Phaser.GameObjects.Graphics;
  private unbindInput: (() => void) | null = null;

  constructor() {
    super('game');
  }

  // ───────────────────────────── setup ─────────────────────────────

  create(): void {
    this.clock = new GameClock(this.game.loop.now);
    this.loadTechniques();
    this.seqs = new AnimRegistry(this, MANIFEST).build();
    this.makeParticleTexture();
    this.drawDojo();

    this.tori = this.add.sprite(0, FLOOR_Y, '__DEFAULT').setOrigin(0.5, 1).setDepth(10);
    this.uke = this.add.sprite(0, FLOOR_Y, '__DEFAULT').setOrigin(0.5, 1).setDepth(11).setFlipX(true);
    this.toriAnim = new AnimationController(this.tori, this.seqs);
    this.ukeAnim = new AnimationController(this.uke, this.seqs);
    this.fx = new FxLayer(this, this.seqs, 30);
    this.sparks = this.add.particles(0, 0, 'px', {
      speed: { min: 70, max: 190 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 160, max: 380 },
      gravityY: 320,
      scale: { start: 2, end: 0 },
      tint: [0xffffff, 0x9be7ff, 0x4fc3f7],
      emitting: false,
    }).setDepth(40);
    this.cueG = this.add.graphics().setDepth(35);

    const font = (size: number, color = '#e6e6e6') => ({ fontFamily: FONT_FAMILY, fontSize: `${size}px`, color, stroke: '#000000', strokeThickness: 3 });
    this.hudLeft = this.add.text(8, 6, '', font(10)).setDepth(50);
    this.hudRight = this.add.text(GAME_WIDTH - 8, 6, '', { ...font(10), align: 'right' }).setOrigin(1, 0).setDepth(50);
    this.help = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 12, '', font(9, '#9a9aa6')).setOrigin(0.5).setDepth(50);
    this.judgeText = this.add.text(GAME_WIDTH / 2, 92, '', { ...font(22), fontStyle: 'bold' }).setOrigin(0.5).setDepth(60).setAlpha(0);
    this.subText = this.add.text(GAME_WIDTH / 2, 114, '', font(10)).setOrigin(0.5).setDepth(60).setAlpha(0);
    this.overlayBg = this.add.graphics().setDepth(70);
    this.overlay = this.add.text(GAME_WIDTH / 2, 150, '', { ...font(12), align: 'center', lineSpacing: 6 }).setOrigin(0.5).setDepth(71);

    // 원버튼: 스페이스바 + 터치/마우스. 이벤트 시각을 가상시간으로 변환해 엔진에 전달
    this.unbindInput = bindOneButton(window, (t) => this.onPress(t));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unbindInput?.());

    const kb = this.input.keyboard;
    kb?.on('keydown-ONE', () => this.setMode('flow'));
    kb?.on('keydown-TWO', () => this.setMode('arcade'));
    kb?.on('keydown-THREE', () => this.setMode('practice'));
    kb?.on('keydown-LEFT', () => this.practiceSelect(-1, 0));
    kb?.on('keydown-RIGHT', () => this.practiceSelect(1, 0));
    kb?.on('keydown-UP', () => this.practiceSelect(0, 1));
    kb?.on('keydown-DOWN', () => this.practiceSelect(0, -1));
    kb?.on('keydown-T', () => this.cycleSpeed());

    // 탭 비활성화 동안 게임 시계 정지 (복귀 시 판정 구간이 한꺼번에 Miss 로 지나가는 것 방지)
    this.game.events.on(Phaser.Core.Events.HIDDEN, () => this.clock.pause(performance.now()));
    this.game.events.on(Phaser.Core.Events.VISIBLE, () => this.clock.resume(performance.now()));

    (window as unknown as { __aikido?: GameScene }).__aikido = this;

    if (!this.techniques.length) {
      this.showOverlay(['데이터 오류', ...this.dataErrors.slice(0, 6)], 0xff5a5f);
      return;
    }
    this.tech = this.techniques[0] as TechniqueData;
    this.setMode('flow');
  }

  private loadTechniques(): void {
    for (const raw of RAW_TECHNIQUES) {
      const issues = validateTechnique(raw);
      if (issues.length) {
        const id = (raw as { id?: string })?.id ?? '(unknown)';
        this.dataErrors.push(`${id}: ${issues[0]}`);
        console.error(`[GameScene] 기술 데이터 제외 ${id}`, issues);
      } else {
        this.techniques.push(raw as TechniqueData);
      }
    }
  }

  private makeParticleTexture(): void {
    if (this.textures.exists('px')) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff).fillRect(0, 0, 2, 2);
    g.generateTexture('px', 2, 2);
    g.destroy();
  }

  /** 도장 배경 (픽셀 도트) */
  private drawDojo(): void {
    const g = this.add.graphics().setDepth(0);
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
  }

  // ───────────────────────────── time ─────────────────────────────

  private realNow(): number {
    return this.game.loop.now;
  }

  private local(): number {
    return this.clock.toVirtual(this.realNow()) - this.roundStart;
  }

  // ───────────────────────────── flow control ─────────────────────────────

  setMode(id: ModeId): void {
    if (!this.techniques.length) return;
    this.mode = MODES[id];
    this.engine = null;
    this.nextAt = null;
    this.speedIdx = 0;
    this.clock.setRate(1, this.realNow());
    this.tweens.timeScale = 1;
    this.state = 'title';
    this.techIndex = Math.min(this.techIndex, this.techniques.length - 1);
    this.tech = this.techniques[this.techIndex] as TechniqueData;
    this.resetStage();
    const n = this.pickN(this.tech);
    this.showOverlay([
      `${this.mode.label}`,
      this.mode.tagline,
      '',
      this.mode.selection === 'fixed' ? `${this.tech.name}  (진행 ×${n})` : this.techniques.map((t) => t.name).join(' · '),
      '',
      'Space / 터치 로 시작',
    ]);
  }

  private resetStage(): void {
    this.roundStart = this.clock.toVirtual(this.realNow());
    this.spacing = new Spacing(this.tech, this.mode.motion, STAGE_CENTER_X);
    this.fx.clear();
    this.cueG.clear();
    this.toriAnim.play('tori.kamae', 0);
    this.ukeAnim.play('uke.kamae', 0);
  }

  private onPress(realT: number): void {
    switch (this.state) {
      case 'title':
      case 'gameover':
        this.startRun();
        break;
      case 'playing':
        this.engine?.press(this.clock.toVirtual(realT));
        break;
      case 'between':
        break; // 다음 라운드 준비 중 입력은 무시 (오입력 방지)
    }
  }

  private startRun(): void {
    this.run = { score: 0, rounds: 0, lives: this.mode.lives ?? 0, combo: 0, maxCombo: 0 };
    this.hideOverlay();
    this.startRound(false);
  }

  private pickTechnique(advance: boolean): TechniqueData {
    const n = this.techniques.length;
    if (this.mode.selection === 'random') this.techIndex = Phaser.Math.Between(0, n - 1);
    else if (this.mode.selection === 'cycle' && advance) this.techIndex = (this.techIndex + 1) % n;
    return this.techniques[this.techIndex] as TechniqueData;
  }

  private pickN(t: TechniqueData): number {
    const { min, max, default: d } = t.phases[1].repeat;
    if (this.mode.progression === 'random') return Phaser.Math.Between(min, max);
    if (this.mode.progression === 'selected') return Phaser.Math.Clamp(this.practiceN ?? d, min, max);
    return d;
  }

  private startRound(advance: boolean): void {
    this.tech = this.pickTechnique(advance);
    const n = this.pickN(this.tech);
    this.engine = new TimingEngine(this.tech, {
      progressionCount: n,
      ...(this.mode.failure ? { failure: this.mode.failure } : {}),
      onListenerError: (e) => console.error(e),
    });
    this.resetStage();
    this.nextAt = null;
    this.state = 'playing';
    this.cameras.main.fadeIn(160, 0, 0, 0);
    this.handle(this.engine.start(this.roundStart));
  }

  private practiceSelect(dTech: number, dN: number): void {
    if (this.mode.id !== 'practice' || this.state === 'playing') return;
    const len = this.techniques.length;
    if (dTech) {
      this.techIndex = (this.techIndex + dTech + len) % len;
      this.practiceN = null;
    }
    const t = this.techniques[this.techIndex] as TechniqueData;
    if (dN) {
      const { min, max, default: d } = t.phases[1].repeat;
      this.practiceN = Phaser.Math.Clamp((this.practiceN ?? d) + dN, min, max);
    }
    this.setMode('practice');
  }

  private cycleSpeed(): void {
    const speeds = this.mode.speeds;
    if (speeds.length < 2) return;
    this.speedIdx = (this.speedIdx + 1) % speeds.length;
    const s = speeds[this.speedIdx] as number;
    this.clock.setRate(s, this.realNow());
    this.tweens.timeScale = s;
  }

  // ───────────────────────────── engine events ─────────────────────────────

  private handle(events: EngineEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'cue':
          if (e.actor === 'tori') this.toriAnim.play(e.key, e.atMs);
          else if (e.actor === 'uke') this.ukeAnim.play(e.key, e.atMs);
          else {
            const c = this.contactAt(e.atMs);
            this.fx.spawn(e.key, c.x, c.y, e.atMs);
          }
          break;
        case 'judge':
          this.onJudge(e);
          break;
        case 'ukemi':
          this.spacing.onUkemi(this.tech.ukemi.results[e.grade].spacing, e.atMs);
          this.flashText(`낙법 ${e.grade.toUpperCase()}`, UKEMI_COLOR[e.grade], `${Math.round(e.score.ratio * 100)}%  ·  ${e.score.raw} / ${e.score.max}`);
          break;
        case 'fail':
          this.flashText('FAIL', GRADE_COLOR.miss, FAIL_TEXT[e.reason.type]);
          break;
        case 'finish':
          this.onFinish(e.result);
          break;
        default:
          break;
      }
    }
  }

  private phaseOf(beatIndex: number): Phase {
    const beat = this.engine?.timeline.beats[beatIndex];
    return this.tech.phases[PHASE_INDEX[beat?.phaseType ?? 'intro']];
  }

  private contactAt(atMs: number): { x: number; y: number } {
    const p = this.spacing.positions(atMs);
    return { x: (p.toriX + p.ukeX) / 2, y: CHEST_Y };
  }

  private onJudge(e: Ev<'judge'>): void {
    // 판정 순간 거리 좁히기 (Perfect = 목표 그대로, Good/Bad = 덜 좁힘, Miss = 모드 규칙)
    this.spacing.onJudge(this.phaseOf(e.beatIndex).spacing, e.grade, e.atMs);

    const r = this.run;
    r.combo = e.grade === 'perfect' ? r.combo + 1 : 0;
    r.maxCombo = Math.max(r.maxCombo, r.combo);
    const sub = e.offsetMs === null ? '' : `${e.offsetMs >= 0 ? '+' : ''}${Math.round(e.offsetMs)}ms`;
    this.flashText(GRADE_TEXT[e.grade], GRADE_COLOR[e.grade], sub);

    const m = this.mode;
    const c = this.contactAt(e.atMs);
    if (e.grade === 'perfect') {
      const isThrow = e.phaseType === 'throw';
      // SF3 블로킹: 화면 정지(가상시간 freeze) → 엔진·애니·거리 모두 멈춤, 파티클·셰이크는 실시간
      if (m.hitstop) {
        const ms = isThrow ? m.hitstop.throwPerfectMs : m.hitstop.perfectMs;
        this.clock.freeze(this.realNow(), ms);
        this.tintFlash(Math.min(ms, 70));
        if (m.shake) this.cameras.main.shake(ms, isThrow ? m.shake.throwPerfect : m.shake.perfect);
      }
      if (m.particles === 'burst') this.sparks.explode(isThrow ? 30 : 18, c.x, c.y);
      else if (m.particles === 'light') this.sparks.explode(6, c.x, c.y);
    } else if (e.grade === 'good' && m.particles !== 'none') {
      this.sparks.explode(3, c.x, c.y);
    }
  }

  private onFinish(result: EngineResult): void {
    this.lastResult = result;
    const r = this.run;
    r.rounds++;
    if (result.outcome === 'success') r.score += result.score.raw;
    if (result.outcome === 'failed' && this.mode.lives !== null) r.lives--;

    if (this.mode.lives !== null && r.lives <= 0) {
      this.state = 'gameover';
      this.showOverlay([
        '게임 오버',
        '',
        `점수 ${r.score}   ·   ${r.rounds} 라운드   ·   최대 콤보 ${r.maxCombo}`,
        '',
        'Space / 터치 로 다시 시작',
      ], 0xff5a5f);
      return;
    }
    this.state = 'between';
    this.nextAt = this.local() + this.mode.autoNextMs;
  }

  // ───────────────────────────── feedback ─────────────────────────────

  private flashText(text: string, color: number, sub = ''): void {
    this.tweens.killTweensOf([this.judgeText, this.subText]);
    this.judgeText.setText(text).setColor(hex(color)).setAlpha(1).setScale(1.4);
    this.subText.setText(sub).setAlpha(sub ? 1 : 0);
    this.tweens.add({ targets: this.judgeText, scale: 1, duration: 110, ease: 'Back.easeOut' });
    this.tweens.add({ targets: [this.judgeText, this.subText], alpha: 0, delay: 700, duration: 250 });
  }

  /** Perfect 순간 두 캐릭터를 흰색으로 번쩍 (SF3 블로킹 플래시) */
  private tintFlash(ms: number): void {
    this.tori.setTintFill(0xffffff);
    this.uke.setTintFill(0xffffff);
    this.time.delayedCall(ms, () => {
      this.tori.clearTint();
      this.uke.clearTint();
    });
  }

  private showOverlay(lines: string[], color = 0xe6e6e6): void {
    this.overlay.setText(lines.join('\n')).setColor(hex(color)).setVisible(true);
    const b = this.overlay.getBounds();
    this.overlayBg.clear().fillStyle(0x000000, 0.72).fillRect(Math.round(b.x - 14), Math.round(b.y - 10), Math.round(b.width + 28), Math.round(b.height + 20));
    this.overlayBg.lineStyle(1, 0x4a4a5a).strokeRect(Math.round(b.x - 14) + 0.5, Math.round(b.y - 10) + 0.5, Math.round(b.width + 27), Math.round(b.height + 19));
    this.overlayBg.setVisible(true);
  }

  private hideOverlay(): void {
    this.overlay.setVisible(false);
    this.overlayBg.setVisible(false);
  }

  // ───────────────────────────── frame ─────────────────────────────

  override update(): void {
    if (!this.techniques.length) return;
    if (this.engine) this.handle(this.engine.update(this.clock.toVirtual(this.realNow())));
    const now = this.local();

    if (this.state === 'between' && this.nextAt !== null && now >= this.nextAt) this.startRound(true);

    const nowAfter = this.local();
    this.toriAnim.update(nowAfter);
    this.ukeAnim.update(nowAfter);
    this.fx.update(nowAfter);
    const pos = this.spacing.positions(nowAfter);
    this.tori.setX(pos.toriX);
    this.uke.setX(pos.ukeX);
    this.drawTimingCue(nowAfter, pos);
    this.drawHud(pos.distance);
  }

  /** 수련·연습: 다음 판정의 퍼펙트 시각을 향해 줄어드는 링 */
  private drawTimingCue(now: number, pos: { toriX: number; ukeX: number }): void {
    const g = this.cueG;
    g.clear();
    if (!this.mode.showTimingCue || this.state !== 'playing' || !this.engine) return;
    const next = this.engine.getState().nextJudgeBeat;
    if (next === null) return;
    const beat = this.engine.timeline.beats[next];
    if (!beat) return;
    const dt = beat.perfectAtMs - now;
    const LEAD = 700;
    if (dt > LEAD || dt < -80) return;
    const x = Math.round((pos.toriX + pos.ukeX) / 2);
    const k = Math.max(0, dt) / LEAD;
    const r = Math.round(6 + k * 34);
    g.lineStyle(1, 0xffffff, 0.35).strokeCircle(x, CHEST_Y, 6);
    g.lineStyle(2, dt <= 50 ? 0x7df9ff : 0xffffff, 1 - k * 0.6).strokeCircle(x, CHEST_Y, r);
  }

  private drawHud(distance: number): void {
    const r = this.run;
    const m = this.mode;
    const parts = [`[${m.label}]`];
    if (m.lives !== null) parts.push(`목숨 ${'♥'.repeat(Math.max(0, r.lives))}${'♡'.repeat(Math.max(0, (m.lives ?? 0) - r.lives))}`);
    if (m.id === 'arcade') parts.push(`점수 ${r.score}`, `콤보 ${r.combo}`);
    if (m.speeds.length > 1) parts.push(`배속 ×${m.speeds[this.speedIdx]}`);
    const live = this.engine?.getState();
    if (live && this.state === 'playing') parts.push(`${live.score.raw} / ${live.score.max}`);
    this.hudLeft.setText(parts.join('   '));

    const n = this.engine?.timeline.progressionCount ?? this.pickN(this.tech);
    this.hudRight.setText(`${this.tech.name}\n진행 ×${n}   마아이 ${distance}px`);
    this.help.setText(m.id === 'practice' ? '1 수련 · 2 게임 · 3 연습   |   ←→ 기술 · ↑↓ 진행 횟수 · T 배속' : '1 수련 · 2 게임 · 3 연습   |   Space / 터치');
  }

  /** 자동화 테스트·콘솔 디버그용 스냅샷 */
  debugSnapshot() {
    const pos = this.spacing?.positions(this.local());
    return {
      mode: this.mode.id,
      state: this.state,
      technique: this.tech?.id,
      speed: this.clock.speed,
      frozen: this.clock.isFrozen(this.realNow()),
      local: this.local(),
      engine: this.engine?.getState() ?? null,
      result: this.lastResult,
      run: { ...this.run },
      positions: pos,
      anims: {
        tori: { key: this.toriAnim.key, frame: this.toriAnim.frame },
        uke: { key: this.ukeAnim.key, frame: this.ukeAnim.frame },
      },
      warnings: [...this.seqs.warnings],
      dataErrors: [...this.dataErrors],
    };
  }
}
