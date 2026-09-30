import Phaser from 'phaser';
import { createGameConfig, installIntegerZoom } from './config/gameConfig';
import { glyphsIn, loadFonts } from './game/fonts';
import { GameScene, RAW_TECHNIQUES, UI_STRINGS } from './game/GameScene';

const boot = async () => {
  await loadFonts(glyphsIn(JSON.stringify(RAW_TECHNIQUES), ...UI_STRINGS));
  const game = new Phaser.Game(createGameConfig([GameScene], 'game'));
  installIntegerZoom(game);
};

void boot();
