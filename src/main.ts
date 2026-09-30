import Phaser from 'phaser';
import { createGameConfig, installIntegerZoom } from './config/gameConfig';
import { glyphsIn, loadFonts } from './game/fonts';
import { GameScene, RAW_TECHNIQUES, UI_STRINGS } from './game/GameScene';
import { TitleScene } from './game/TitleScene';

/** 부팅: 한글 폰트 글리프 로드 → Title → Game (첫 씬 = Title) */
const boot = async () => {
  await loadFonts(glyphsIn(JSON.stringify(RAW_TECHNIQUES), ...UI_STRINGS));
  const game = new Phaser.Game(createGameConfig([TitleScene, GameScene], 'game'));
  installIntegerZoom(game);
};

void boot();
