/** 한글 표시용 웹폰트 (실패 시 시스템 폰트 폴백) */
export const FONT_FAMILY = '"Nanum Gothic Coding", D2Coding, "Malgun Gothic", "Apple SD Gothic Neo", monospace';
export const WEBFONT_CSS = 'https://fonts.googleapis.com/css2?family=Nanum+Gothic+Coding:wght@400;700&display=swap';

const NON_ASCII = /[^\x00-\x7F]/g;

/** 문자열들에 쓰인 비 ASCII 글자 집합 */
export const glyphsIn = (...texts: string[]): string => [...new Set(texts.join('').match(NON_ASCII) ?? [])].join('');

/**
 * Google Fonts 한글 폰트는 unicode-range 조각으로 나뉘어, 실제 쓰는 글자를 넘겨야 해당 조각이 로드된다.
 * Phaser Text 는 생성 시점 폰트로 래스터화되므로 게임 시작 전에 기다린다 (최대 timeoutMs, 실패해도 진행).
 */
export const loadFonts = async (glyphs: string, timeoutMs = 4000): Promise<void> => {
  if (typeof document === 'undefined' || !document.fonts) return;
  const sample = `${glyphs}ABC012`;
  const load = Promise.all(['400', '700'].map((w) => document.fonts.load(`${w} 10px "Nanum Gothic Coding"`, sample)));
  await Promise.race([load, new Promise((r) => setTimeout(r, timeoutMs))]).catch(() => undefined);
};
