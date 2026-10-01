import Phaser from 'phaser';
import manifestJson from '../../data/animations.json';
import { CHARACTER_TEXTURES, addCharacterSprite, preloadCharacterSprites } from '../art/characterSprites';
import { FLOOR_Y, GAME_WIDTH, STAGE_CENTER_X } from '../config/gameConfig';
import { validateTechnique } from '../engine/validate';
import { FONT_FAMILY, glyphsIn, loadFonts } from '../game/fonts';
import { RAW_TECHNIQUES, type EmbeddedTest } from '../game/GameScene';
import { drawDojo } from '../render/dojo';
import type { AnimationManifest } from '../types/animations';
import type { TechniqueData } from '../types/technique';
import { DevEditor } from './DevEditor';

const MANIFEST = manifestJson as unknown as AnimationManifest;
const SCENES = ['title', 'editor', 'game'] as const;

/** 에디터 대기 화면 문구 (웹폰트 글리프 사전 로드용) */
export const EDITOR_STRINGS = [
  'DEVELOPER MODE', '▶ TEST 를 누르면 이 화면에서 바로 재생됩니다',
  '오른쪽 폼에서 타이밍 · 판정 · 이미지를 세팅하세요',
];

/**
 * 씬 전환 (DOM 버튼에서 호출 — 씬 밖이라 this.scene.start 를 못 씀).
 * 대상 외 씬을 멈추고 대상 씬을 (이미 실행 중이면 다시) 시작한다.
 */
const switchScene = (game: Phaser.Game, key: (typeof SCENES)[number], data?: object): void => {
  for (const k of SCENES) if (k !== key && (game.scene.isActive(k) || game.scene.isPaused(k) || game.scene.isSleeping(k))) game.scene.stop(k);
  game.scene.start(key, data);
};

/** DOM 에디터는 씬보다 오래 산다 (TEST 로 GameScene 에 갔다 와도 폼 상태 유지) → 게임당 1개 */
let editor: DevEditor | null = null;

const editorFor = (game: Phaser.Game): DevEditor => {
  if (editor) return editor;
  const builtins = RAW_TECHNIQUES.filter((t) => validateTechnique(t).length === 0) as TechniqueData[];
  const ed: DevEditor = new DevEditor({
    builtins,
    manifest: MANIFEST,
    onTest: (technique, pack, progressionCount) => {
      const embedded: EmbeddedTest = {
        technique,
        pack,
        progressionCount,
        onEvent: ed.onEngineEvent,
        onExit: () => {
          ed.setRunning(false);
          switchScene(game, 'editor');
        },
      };
      // 새 기술명 글자를 웹폰트로 받아 둔 뒤 시작 (최대 1.2초, 실패해도 진행)
      void loadFonts(glyphsIn(technique.name, technique.phases.map((p) => p.label ?? '').join('')), 1200)
        .then(() => switchScene(game, 'game', { embedded }));
    },
    onStop: () => switchScene(game, 'editor'),
    onExit: () => {
      ed.unmount();
      switchScene(game, 'title');
    },
  });
  editor = ed;
  return ed;
};

/**
 * DEVELOPER MODE 씬: DOM 에디터를 붙이고, 가운데 캔버스에는 대기 화면(도장 + 두 캐릭터)을 그린다.
 * ▶ TEST → GameScene(embedded) 로 전환해 같은 캔버스에서 재생, ■ STOP / Esc → 다시 이 씬.
 */
export class EditorScene extends Phaser.Scene {
  constructor() {
    super('editor');
  }

  preload(): void {
    preloadCharacterSprites(this);
  }

  create(): void {
    const ed = editorFor(this.game);
    ed.mount();
    ed.setRunning(false);
    (window as unknown as { __aikidoEditor?: DevEditor }).__aikidoEditor = ed;

    drawDojo(this);
    addCharacterSprite(this, STAGE_CENTER_X - 28, FLOOR_Y, CHARACTER_TEXTURES.player).setDepth(10);
    addCharacterSprite(this, STAGE_CENTER_X + 28, FLOOR_Y, CHARACTER_TEXTURES.enemy).setDepth(11).setFlipX(true);
    const font = (size: number, color: string) => ({ fontFamily: FONT_FAMILY, fontSize: `${size}px`, color, stroke: '#000000', strokeThickness: 3 });
    this.add.text(GAME_WIDTH / 2, 24, EDITOR_STRINGS[0]!, { ...font(16, '#7da8ff'), fontStyle: 'bold' }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, 150, EDITOR_STRINGS[1]!, font(12, '#fff4c2')).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, 170, EDITOR_STRINGS[2]!, font(10, '#9aa0b8')).setOrigin(0.5);
    this.cameras.main.fadeIn(150, 0, 0, 0);
  }
}
