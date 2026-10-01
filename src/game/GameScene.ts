import Phaser from 'phaser';
import manifestJson from '../../data/animations.json';
import katatedoriShihonage from '../../data/techniques/katatedori_shihonage.json';
import shomenuchiIriminage from '../../data/techniques/shomenuchi_iriminage.json';
import { FLOOR_Y, GAME_HEIGHT, GAME_WIDTH, STAGE_CENTER_X } from '../config/gameConfig';
import { CHARACTER_TEXTURES, FRONT_OF_UKE_TEXTURES, addCharacterSprite, preloadCharacterSprites } from '../art/characterSprites';
import { TimingEngine } from '../engine/TimingEngine';
import type { EngineEvent, EngineResult, FailReason } from '../engine/types';
import { validateTechnique } from '../engine/validate';
import { bindOneButton, isTypingTarget } from '../input/oneButton';
import { loadPack, manifestWith, playableTechniques, preloadPackAssets, type SkillPack } from '../editor/skillPack';
import { AnimRegistry } from '../render/AnimRegistry';
import { AnimationController } from '../render/AnimationController';
import { GameClock } from '../render/clock';
import { FxLayer } from '../render/FxLayer';
import { drawDojo } from '../render/dojo';
import { Spacing } from '../render/Spacing';
import type { AnimationManifest } from '../types/animations';
import type { Grade, Phase, PhaseType, ResolvedTimeline, TechniqueData, UkemiGrade } from '../types/technique';
import { PixelButton } from '../ui/PixelButton';
import { FONT_FAMILY } from './fonts';
import { DEFAULT_SPEED_INDEX, MODES, SPEEDS, type ModeId, type ModeRules } from './modes';
import { MODE_REGISTRY_KEY } from './TitleScene';

type Ev<T extends EngineEvent['type']> = Extract<EngineEvent, { type: T }>;
/** ready = 라운드 시작 전 준비 표시, between = 다음 라운드 대기 */
type SceneState = 'ready' | 'playing' | 'between' | 'gameover';

/**
 * 개발자 모드 TEST: 편집 중인 기술 1개를 연습 모드 규칙으로 반복 재생.
 * 폼 데이터(타이밍·판정·이미지)를 그대로 TimingEngine 에 주입하고, 엔진 이벤트를 에디터 로그로 돌려준다.
 */
export interface EmbeddedTest {
  technique: TechniqueData;
  /** 업로드 이미지 시퀀스·텍스처 */
  pack: SkillPack;
  /** 진행부 횟수 (생략 시 repeat.default) */
  progressionCount?: number;
  /** 엔진 이벤트 (판정·낙법·실패·종료) */
  onEvent?: (e: EngineEvent, timeline: ResolvedTimeline) => void;
  /** Stop 버튼 / Esc */
  onExit?: () => void;
}

const TEST_MODE: ModeRules = {
  ...MODES.practice,
  label: 'TEST',
  tagline: '개발자 모드 테스트 — Space / 화면 클릭 = 입력',
  autoNextMs: 900,
};

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
/** 하이폴 비행 (가상 ms · px). 오른쪽(+x) = 토리 반대쪽 */
const FLIGHT = {
  offscreen: { ms: 620, dx: 400, rise: 150, fall: 60 },
  arc: { minMs: 220, height: 34 },
} as const;
/** 라운드 시작 전 READY 표시 시간 (가상 ms) */
const READY_MS = 800;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const speedLabel = (s: number) => `Speed ${s}x`;

/** HUD 에 쓰는 문자열 (웹폰트 글리프 사전 로드용) */
export const UI_STRINGS = [
  '수련', '게임', '연습', '목숨', '점수', '콤보', '진행', '기술', '라운드', '마아이', '낙법',
  '타이밍을 놓쳤다', '흐름이 끊겼다', '입력 없음', '중단', '게임 오버', '다시 시작', '데이터 오류',
  '아이키도 원버튼 — 마아이와 무스비', 'Space · Enter · 터치 = 시작     1 2 3 = 모드',
  'Space / 터치 = 입력', 'R 리셋 · H 메인 · T 배속 · 1 2 3 모드', '←→ 기술 · ↑↓ 진행 횟수',
  '터치 / Space 로 다시 시작', '·', '—', '×', '♥', '♡', '─', '›',
  'PLAY MODE', 'DEVELOPER MODE', 'Space · Enter · 터치 = PLAY     D = DEVELOPER     1 2 3 = 모드',
  'Space / 화면 클릭 = 입력   |   R 리셋 · T 배속 · ↑↓ 진행 횟수 · Esc 정지', 'Stop', TEST_MODE.label, TEST_MODE.tagline,
  ...Object.values(MODES).flatMap((m) => [m.label, m.tagline]),
];

/**
 * GameScene — TimingEngine 을 화면에 연결하고 3가지 모드 룰을 적용한다.
 *
 * 씬 흐름: TitleScene ─(터치)→ GameScene[ready → playing → between → … | gameover] ─(Home)→ TitleScene
 *
 * 시간 흐름: 실시간 → GameClock(배속·히트스톱) → 가상시간 → TimingEngine / 애니메이션 / 거리
 *   (입력 타임스탬프도 같은 GameClock 으로 변환 → 히트스톱·배속 중에도 판정 ms 정확)
 *
 * 엔진 이벤트 → 연출
 *   cue(tori|uke) → AnimationController.play(key, atMs)   (시작 Key → 10~12fps 묵직한 재생)
 *   cue(fx)       → FxLayer.spawn (접촉 지점)
 *   judge         → Spacing.onJudge (판정 순간 거리 좁히기) + 모드별 피드백
 *   ukemi         → Spacing.onUkemi (우케가 날아감) + 결과 표시
 *   fail/finish   → 모드별 다음 라운드 / 목숨 / 게임 오버
 *
 * 입력: 키보드 Space (bindOneButton) + 화면 터치 (UI 버튼 위를 누른 경우는 제외)
 */
export class GameScene extends Phaser.Scene {
  private clock!: GameClock;
  private seqs!: AnimRegistry;
  private techniques: TechniqueData[] = [];
  private dataErrors: string[] = [];

  private mode: ModeRules = MODES.flow;
  private state: SceneState = 'ready';
  private engine: TimingEngine | null = null;
  private tech!: TechniqueData;
  private techIndex = 0;
  private practiceN: number | null = null;
  /** 이번 라운드 진행부 횟수 — 라운드마다 한 번만 뽑는다 (READY 표시·HUD·엔진이 같은 값) */
  private roundN = 1;
  private speedIdx: number = DEFAULT_SPEED_INDEX;
  /** 라운드 시작 가상시각. 로컬 시간 = 가상시각 - roundStart (= 엔진 atMs 축) */
  private roundStart = 0;
  private nextAt: number | null = null;
  private run = { score: 0, rounds: 0, lives: 0, combo: 0, maxCombo: 0 };
  private lastResult: EngineResult | null = null;
  private leaving = false;

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
  private speedBtn!: PixelButton;
  private cleanups: (() => void)[] = [];
  private embedded: EmbeddedTest | null = null;
  /** 하이폴 비행 오프셋 (Spacing 위치에 더함). Tween 이 값을 바꾸고 update() 가 적용 */
  private flight = { x: 0, y: 0 };
  private flightTween: Phaser.Tweens.Tween | null = null;
  private pack: SkillPack | null = null;

  constructor() {
    super('game');
  }

  init(data: { mode?: ModeId; embedded?: EmbeddedTest }): void {
    this.embedded = data?.embedded ?? null;
    // PLAY MODE 도 개발자 모드에서 저장한 스킬 팩으로 플레이 (없거나 유효한 기술이 없으면 기본 기술)
    this.pack = this.embedded ? this.embedded.pack : loadPack();
    const id = data?.mode ?? (this.registry.get(MODE_REGISTRY_KEY) as ModeId | undefined) ?? 'flow';
    this.mode = this.embedded ? TEST_MODE : MODES[id] ?? MODES.flow;
    this.techIndex = this.embedded ? 0 : this.techIndex;
    this.practiceN = this.embedded ? this.embedded.progressionCount ?? null : this.practiceN;
    this.leaving = false;
    this.techniques = [];
    this.dataErrors = [];
    this.cleanups = [];
    this.engine = null;
    this.nextAt = null;
    this.lastResult = null;
    this.speedIdx = DEFAULT_SPEED_INDEX;
  }

  // ───────────────────────────── setup ─────────────────────────────

  /** 64x64 SVG 픽셀 아트 (player_idle / enemy_idle). 타이틀에서 이미 로드됐으면 건너뜀 */
  preload(): void {
    preloadCharacterSprites(this);
    preloadPackAssets(this, this.pack); // 개발자 모드에서 업로드한 PNG/SVG
  }

  create(): void {
    this.clock = new GameClock(this.game.loop.now);
    this.loadTechniques();
    this.seqs = new AnimRegistry(this, manifestWith(MANIFEST, this.pack)).build();
    this.makeParticleTexture();
    drawDojo(this);

    // 캐릭터 = 픽셀 아트 스프라이트 (정수 배율 1, 내부 640x360 → 창에 맞춘 정수 줌). 우케는 좌우 반전
    this.tori = addCharacterSprite(this, STAGE_CENTER_X - 28, FLOOR_Y, CHARACTER_TEXTURES.player).setDepth(10);
    this.uke = addCharacterSprite(this, STAGE_CENTER_X + 28, FLOOR_Y, CHARACTER_TEXTURES.enemy).setDepth(11).setFlipX(true);
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
    this.hudLeft = this.add.text(8, 26, '', font(10)).setDepth(50);
    this.hudRight = this.add.text(GAME_WIDTH - 8, 6, '', { ...font(10), align: 'right' }).setOrigin(1, 0).setDepth(50);
    this.help = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 12, '', font(9, '#9a9aa6')).setOrigin(0.5).setDepth(50);
    this.judgeText = this.add.text(GAME_WIDTH / 2, 92, '', { ...font(22), fontStyle: 'bold' }).setOrigin(0.5).setDepth(60).setAlpha(0);
    this.subText = this.add.text(GAME_WIDTH / 2, 114, '', font(10)).setOrigin(0.5).setDepth(60).setAlpha(0);
    this.overlayBg = this.add.graphics().setDepth(70);
    this.overlay = this.add.text(GAME_WIDTH / 2, 150, '', { ...font(12), align: 'center', lineSpacing: 6 }).setOrigin(0.5).setDepth(71);

    // 상단 UI 버튼: Reset / Home / Speed
    const btnY = 13;
    new PixelButton(this, 8 + 26, btnY, 'Reset', { width: 52, onClick: () => this.reset() }).setDepth(80);
    new PixelButton(this, 8 + 52 + 6 + 26, btnY, this.embedded ? 'Stop' : 'Home', { width: 52, onClick: () => this.goHome() }).setDepth(80);
    this.speedBtn = new PixelButton(this, 8 + 52 + 6 + 52 + 6 + 38, btnY, speedLabel(SPEEDS[this.speedIdx] ?? 1), {
      width: 76, onClick: () => this.cycleSpeed(),
    }).setDepth(80);

    // 원버튼 입력 ① 키보드 Space — 이벤트 시각을 가상시간으로 변환해 엔진에 전달
    this.cleanups.push(bindOneButton(window, (t) => this.onPress(t), { pointer: false }));
    // ② 화면 터치/클릭 — UI 버튼 위를 누른 경우는 버튼 동작만
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length) return;
      this.onPress(p.event?.timeStamp ?? performance.now());
    });

    // 단축키: DOM keydown (개발자 모드 폼에 글자를 입력하는 중이면 무시 — Phaser 키 이벤트는 대상 요소를 가리지 않음)
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const test = !!this.embedded;
      switch (e.code) {
        case 'Digit1': case 'Numpad1': if (!test) this.switchMode('flow'); break;
        case 'Digit2': case 'Numpad2': if (!test) this.switchMode('arcade'); break;
        case 'Digit3': case 'Numpad3': if (!test) this.switchMode('practice'); break;
        case 'ArrowLeft': if (!test) this.practiceSelect(-1, 0); break;
        case 'ArrowRight': if (!test) this.practiceSelect(1, 0); break;
        case 'ArrowUp': this.practiceSelect(0, 1); break;
        case 'ArrowDown': this.practiceSelect(0, -1); break;
        case 'KeyT': this.cycleSpeed(); break;
        case 'KeyR': this.reset(); break;
        case 'KeyH': if (!test) this.goHome(); break;
        case 'Escape': this.goHome(); break;
        default: return;
      }
      if (e.code.startsWith('Arrow')) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    this.cleanups.push(() => window.removeEventListener('keydown', onKey));

    // 탭 비활성화 동안 게임 시계 정지. 씬 종료 시 전역 리스너 해제 (재진입 시 중복 방지)
    const onHidden = () => this.clock.pause(performance.now());
    const onVisible = () => this.clock.resume(performance.now());
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);
    this.game.events.on(Phaser.Core.Events.VISIBLE, onVisible);
    this.cleanups.push(() => {
      this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden);
      this.game.events.off(Phaser.Core.Events.VISIBLE, onVisible);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.cleanups.forEach((f) => f());
      this.cleanups = [];
      this.fx.clear();
    });

    (window as unknown as { __aikido?: GameScene }).__aikido = this;
    this.cameras.main.fadeIn(200, 0, 0, 0);

    if (!this.techniques.length) {
      this.state = 'gameover';
      this.showOverlay(['데이터 오류', ...this.dataErrors.slice(0, 6)], 0xff5a5f);
      return;
    }
    this.techIndex = Math.min(this.techIndex, this.techniques.length - 1);
    this.tech = this.techniques[this.techIndex] as TechniqueData;
    this.beginRun();
  }

  private loadTechniques(): void {
    if (this.embedded) {
      const raw = this.embedded.technique;
      const issues = validateTechnique(raw);
      if (issues.length) this.dataErrors.push(...issues.map((m) => `${raw?.id ?? '(unknown)'}: ${m}`));
      else this.techniques.push(raw);
      return;
    }
    const { techniques, errors } = playableTechniques(RAW_TECHNIQUES, this.pack);
    this.techniques = techniques;
    this.dataErrors = errors;
    for (const e of errors) console.error(`[GameScene] 기술 데이터 제외 ${e}`);
  }

  private makeParticleTexture(): void {
    if (this.textures.exists('px')) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff).fillRect(0, 0, 2, 2);
    g.generateTexture('px', 2, 2);
    g.destroy();
  }

  // ───────────────────────────── time ─────────────────────────────

  private realNow(): number {
    return this.game.loop.now;
  }

  private local(): number {
    return this.clock.toVirtual(this.realNow()) - this.roundStart;
  }

  // ───────────────────────────── flow control ─────────────────────────────

  /** 새 판 시작: 점수·목숨 초기화 → READY 표시 → 첫 라운드 */
  private beginRun(): void {
    this.engine = null;
    this.run = { score: 0, rounds: 0, lives: this.mode.lives ?? 0, combo: 0, maxCombo: 0 };
    this.lastResult = null;
    this.tech = this.pickTechnique(false);
    this.roundN = this.pickN(this.tech);
    this.resetStage();
    this.state = 'ready';
    this.nextAt = this.local() + READY_MS;
    const n = this.roundN;
    this.showOverlay([
      `[${this.mode.label}]  ${this.mode.tagline}`,
      '',
      `${this.tech.name}   진행 ×${n}`,
      '',
      'READY',
    ]);
  }

  /** Reset 버튼: 현재 모드를 처음부터 */
  private reset(): void {
    if (this.leaving || !this.techniques.length) return;
    this.cameras.main.flash(60, 255, 255, 255);
    this.beginRun();
  }

  /** Home 버튼: 타이틀로 (개발자 모드 TEST 에서는 Stop → 에디터 대기 화면) */
  private goHome(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.engine = null;
    if (this.embedded) {
      const exit = this.embedded.onExit;
      if (exit) exit();
      else this.scene.start('editor');
      return;
    }
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('title'));
  }

  private switchMode(id: ModeId): void {
    if (this.leaving || !this.techniques.length) return;
    this.mode = MODES[id];
    this.registry.set(MODE_REGISTRY_KEY, id);
    this.beginRun();
  }

  private resetStage(): void {
    this.stopFlight();
    this.roundStart = this.clock.toVirtual(this.realNow());
    this.spacing = new Spacing(this.tech, this.mode.motion, STAGE_CENTER_X);
    this.fx.clear();
    this.cueG.clear();
    this.toriAnim.play('tori.kamae', 0);
    this.ukeAnim.play('uke.kamae', 0);
  }

  private onPress(realT: number): void {
    if (this.leaving) return;
    switch (this.state) {
      case 'playing':
        this.engine?.press(this.clock.toVirtual(realT));
        break;
      case 'gameover':
        if (this.techniques.length) this.beginRun();
        break;
      case 'ready':
      case 'between':
        break; // 라운드 준비 중 입력은 무시 (오입력 방지)
    }
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

  /** @param advance true = 모드 규칙에 따라 다음 기술로 (첫 라운드는 beginRun 에서 고른 기술 유지) */
  private startRound(advance: boolean): void {
    if (advance) {
      this.tech = this.pickTechnique(true);
      this.roundN = this.pickN(this.tech);
    }
    const n = this.roundN;
    this.engine = new TimingEngine(this.tech, {
      progressionCount: n,
      ...(this.mode.failure ? { failure: this.mode.failure } : {}),
      onListenerError: (e) => console.error(e),
    });
    this.hideOverlay();
    this.resetStage();
    this.nextAt = null;
    this.state = 'playing';
    this.handle(this.engine.start(this.roundStart));
  }

  private practiceSelect(dTech: number, dN: number): void {
    if (this.mode.id !== 'practice' || this.leaving || !this.techniques.length) return;
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
    this.beginRun();
  }

  /** Speed 버튼: 0.5x → 1x → 1.5x. 판정·애니메이션·거리 이동 모두 같은 가상시계를 따른다 */
  private cycleSpeed(): void {
    this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
    const s = SPEEDS[this.speedIdx] as number;
    this.clock.setRate(s, this.realNow());
    this.tweens.timeScale = s;
    this.speedBtn.setLabel(speedLabel(s));
  }

  // ───────────────────────────── engine events ─────────────────────────────

  private handle(events: EngineEvent[]): void {
    const tl = this.engine?.timeline;
    for (const e of events) {
      if (this.embedded?.onEvent && tl) {
        try {
          this.embedded.onEvent(e, tl);
        } catch (err) {
          console.error('[GameScene] onEvent', err);
        }
      }
      switch (e.type) {
        case 'cue':
          if (e.actor === 'tori') {
            this.toriAnim.play(e.key, e.atMs);
            // 입신으로 적의 사각에 파고든 순간엔 토리를 적 앞에 그림 (평소엔 우케가 앞)
            this.tori.setDepth(FRONT_OF_UKE_TEXTURES.has(this.tori.texture.key) ? 12 : 10);
          }
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
    // 등급별 반응에 spacing 이 있으면 우선 (Phase 2 Perfect: 적의 사각으로 순간 파고듦)
    const phase = this.phaseOf(e.beatIndex);
    this.spacing.onJudge(phase.onJudge?.[e.grade]?.spacing ?? phase.spacing, e.grade, e.atMs);

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
        if (m.shake && !(isThrow && m.finishShake)) this.cameras.main.shake(ms, isThrow ? m.shake.throwPerfect : m.shake.perfect);
      }
      if (isThrow) this.onThrowPerfect(e, m.hitstop?.throwPerfectMs ?? 0);
      if (m.particles === 'burst') this.sparks.explode(isThrow ? 30 : 18, c.x, c.y);
      else if (m.particles === 'light') this.sparks.explode(6, c.x, c.y);
    } else if (e.grade === 'good' && m.particles !== 'none') {
      this.sparks.explode(3, c.x, c.y);
    }
  }

  /**
   * Phase 3(던지기) Perfect 피니시.
   * 스프라이트 교체는 데이터가 담당: throw.onJudge.perfect.cues 의
   *   tori.throw_perfect    → nage_throw   (중심 낙하 던지기 · 잔심)
   *   uke.ukemi_perfect_air → uke_highfall (거꾸로 뜬 다이내믹 하이폴)
   * 여기서는 교체를 보장하고(데이터에 큐가 없거나 다른 Key 여도), 우케를 날리고, 화면을 묵직하게 흔든다.
   * @param hitstopMs 화면 정지(실시간 ms) — 비행은 정지가 끝난 뒤 출발
   */
  private onThrowPerfect(e: Ev<'judge'>, hitstopMs: number): void {
    if (this.tori.texture.key !== CHARACTER_TEXTURES.nageThrow && this.textures.exists(CHARACTER_TEXTURES.nageThrow)) {
      this.tori.setTexture(CHARACTER_TEXTURES.nageThrow);
    }
    if (this.uke.texture.key !== CHARACTER_TEXTURES.ukeHighfall && this.textures.exists(CHARACTER_TEXTURES.ukeHighfall)) {
      this.uke.setTexture(CHARACTER_TEXTURES.ukeHighfall);
    }
    if (this.mode.finishShake) this.cameras.main.shake(200, 0.02);
    this.launchHighfall(e, hitstopMs);
  }

  /**
   * 하이폴 비행 Tween. tweens.timeScale = 배속이므로 duration 은 가상 ms 그대로,
   * 히트스톱(실시간)만큼은 delay 로 기다린다 (delay 도 timeScale 을 받으므로 × 배속).
   */
  private launchHighfall(e: Ev<'judge'>, hitstopMs: number): void {
    this.stopFlight();
    const kind = this.mode.finishFlight;
    if (kind === 'none') return;
    const delay = hitstopMs * (SPEEDS[this.speedIdx] ?? 1);
    const f = this.flight;
    if (kind === 'offscreen') {
      // 회전력 그대로 높이 솟구쳐 토리 반대쪽 화면 밖으로 — 가속하며 빠져나감
      const o = FLIGHT.offscreen;
      this.flightTween = this.tweens.addCounter({
        from: 0, to: 1, duration: o.ms, delay, ease: 'Quad.easeIn',
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 0;
          f.x = Math.round(o.dx * t);
          f.y = Math.round(-o.rise * t + o.fall * t * t);
        },
        onComplete: () => { this.uke.setVisible(false); this.cameras.main.flash(80, 255, 255, 255); },
      });
      return;
    }
    // arc: 낙법 시작(던지기 페이즈 끝)에 맞춰 포물선으로 떴다가 착지 → 데이터의 낙법 연출로 이어짐
    const beat = this.engine?.timeline.beats[e.beatIndex];
    const ms = Math.max(FLIGHT.arc.minMs, (beat?.endMs ?? e.atMs) - e.atMs);
    this.flightTween = this.tweens.addCounter({
      from: 0, to: 1, duration: ms, delay,
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        f.x = 0;
        f.y = Math.round(-FLIGHT.arc.height * 4 * t * (1 - t));
      },
      onComplete: () => { f.y = 0; },
    });
  }

  private stopFlight(): void {
    this.flightTween?.remove();
    this.flightTween = null;
    this.flight.x = 0;
    this.flight.y = 0;
    this.uke?.setVisible(true);
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
        '터치 / Space 로 다시 시작',
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
    // 판정 팝업이 오버레이 뒤로 비치지 않게
    this.tweens.killTweensOf([this.judgeText, this.subText]);
    this.judgeText.setAlpha(0);
    this.subText.setAlpha(0);
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
    if (!this.techniques.length || this.leaving) return;
    if (this.engine) this.handle(this.engine.update(this.clock.toVirtual(this.realNow())));
    const now = this.local();

    if (this.nextAt !== null && now >= this.nextAt) {
      if (this.state === 'ready') this.startRound(false);
      else if (this.state === 'between') this.startRound(true);
    }

    const t = this.local();
    this.toriAnim.update(t);
    this.ukeAnim.update(t);
    this.fx.update(t);
    const pos = this.spacing.positions(t);
    this.tori.setX(pos.toriX);
    this.uke.setPosition(pos.ukeX + this.flight.x, FLOOR_Y + this.flight.y);
    this.drawTimingCue(t, pos);
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
    const live = this.engine?.getState();
    const playing = !!live && this.state === 'playing';
    // 누적 점수 = 끝난 라운드 합 + 진행 중 라운드 점수 (라운드 도중에도 실시간 반영)
    if (m.id === 'arcade') parts.push(`점수 ${r.score + (playing ? live.score.raw : 0)}`, `콤보 ${r.combo}`);
    if (playing) parts.push(`라운드 ${live.score.raw} / ${live.score.max}`);
    this.hudLeft.setText(parts.join('   '));

    const n = this.engine?.timeline.progressionCount ?? this.roundN;
    this.hudRight.setText(`${this.tech.name}\n진행 ×${n}   마아이 ${distance}px`);
    if (this.embedded) {
      this.help.setText('Space / 화면 클릭 = 입력   |   R 리셋 · T 배속 · ↑↓ 진행 횟수 · Esc 정지');
      return;
    }
    const extra = m.id === 'practice' ? '   |   ←→ 기술 · ↑↓ 진행 횟수' : '';
    this.help.setText(`Space / 터치 = 입력   |   R 리셋 · H 메인 · T 배속 · 1 2 3 모드${extra}`);
  }

  /** 자동화 테스트·콘솔 디버그용 스냅샷 */
  debugSnapshot() {
    const pos = this.spacing?.positions(this.local());
    return {
      scene: 'game' as const,
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
      flight: { ...this.flight, visible: this.uke?.visible ?? true, texture: this.uke?.texture.key, mode: this.mode.finishFlight },
      embedded: !!this.embedded,
      fromPack: !this.embedded && !!this.pack?.techniques.length && this.techniques.some((t) => this.pack!.techniques.includes(t)),
    };
  }
}
