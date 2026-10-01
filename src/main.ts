import Phaser from 'phaser';
import { createGameConfig, installIntegerZoom } from './config/gameConfig';
import { EDITOR_STRINGS, EditorScene } from './editor/EditorScene';
import { loadPack } from './editor/skillPack';
import { glyphsIn, loadFonts } from './game/fonts';
import { GameScene, RAW_TECHNIQUES, UI_STRINGS } from './game/GameScene';
import { TitleScene } from './game/TitleScene';

/** 부팅: 한글 폰트 글리프 로드 → Title → (PLAY) Game / (DEVELOPER) Editor */
const boot = async () => {
  const saved = loadPack()?.techniques ?? [];
  await loadFonts(glyphsIn(JSON.stringify(RAW_TECHNIQUES), JSON.stringify(saved), ...UI_STRINGS, ...EDITOR_STRINGS));
  const game = new Phaser.Game(createGameConfig([TitleScene, GameScene, EditorScene], 'game'));
  installIntegerZoom(game);
};

void boot();
