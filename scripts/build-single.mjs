// 단일 파일 빌드: src/main.ts → play/index.html (+ 오프라인판 play/index.offline.html)
//   index.html          : 엔진·데이터·씬·UI 인라인, Phaser·웹폰트는 CDN (≈90KB)
//   index.offline.html  : Phaser 까지 인라인 → 인터넷 없이 더블클릭 실행 (폰트는 시스템 한글 폰트)
// 사용: npm run build:single
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const phaserVersion = pkg.dependencies.phaser;

const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  charset: 'utf8',
  legalComments: 'none',
  write: false,
  alias: { phaser: './scripts/phaser-global.js' },
});
const escapeScript = (s) => s.replace(/<\/script/gi, '<\\/script');
const appJs = escapeScript(result.outputFiles[0].text);

const STYLE = `<style>
  html, body { margin: 0; height: 100%; background: #050507; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; }
  #game { width: 100vw; height: 100vh; }
  canvas { image-rendering: pixelated; image-rendering: crisp-edges; }
</style>`;
const FONT_LINKS = `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nanum+Gothic+Coding:wght@400;700&display=swap" />`;

const page = ({ head, phaser }) => `<!doctype html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
<title>Aikido One-Button — ${pkg.name} ${pkg.version}</title>
<!-- 자동 생성 파일: npm run build:single (직접 수정하지 말 것). 소스: src/ -->
${head}
${STYLE}
${phaser}
</head>
<body>
<div id="game"></div>
<script>
${appJs}
</script>
</body>
</html>
`;

const outDir = join(root, 'play');
mkdirSync(outDir, { recursive: true });

const online = page({
  head: FONT_LINKS,
  phaser: `<script src="https://cdn.jsdelivr.net/npm/phaser@${phaserVersion}/dist/phaser.min.js"></script>`,
});
writeFileSync(join(outDir, 'index.html'), online);

/**
 * 오프라인판 폰트: 번들에 쓰인 글자만 담은 Nanum Gothic Coding 서브셋(woff2)을 base64 로 인라인.
 * (한글 시스템 폰트가 없는 환경에서도 글자가 깨지지 않게) 빌드 시 네트워크가 없으면 시스템 폰트로 폴백.
 */
const embedFontSubset = async () => {
  const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
  const glyphs = [...new Set((ascii + appJs).match(/[^\x00-\x1f]/gu) ?? [])]
    .filter((c) => c.codePointAt(0) < 0x10000 && (c.codePointAt(0) < 0x80 || /\p{L}|\p{N}|\p{P}|\p{S}/u.test(c)))
    .join('');
  const ua = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
  const cssUrl = `https://fonts.googleapis.com/css2?family=Nanum+Gothic+Coding:wght@400;700&text=${encodeURIComponent(glyphs)}`;
  try {
    let css = await (await fetch(cssUrl, { headers: ua })).text();
    const urls = [...new Set(css.match(/https:\/\/[^)]+/g) ?? [])];
    if (!urls.length) throw new Error('폰트 URL 없음');
    for (const u of urls) {
      const buf = Buffer.from(await (await fetch(u, { headers: ua })).arrayBuffer());
      css = css.replaceAll(u, `data:font/woff2;base64,${buf.toString('base64')}`);
    }
    return { css: `<style>\n${css}\n</style>`, glyphs: glyphs.length };
  } catch (e) {
    console.warn(`⚠ 폰트 서브셋 임베드 실패 (${e.message}) → 오프라인판은 시스템 한글 폰트 사용`);
    return { css: '', glyphs: 0 };
  }
};

const font = await embedFontSubset();
const phaserJs = escapeScript(readFileSync(join(root, 'node_modules/phaser/dist/phaser.min.js'), 'utf8'));
const offline = page({ head: font.css, phaser: `<script>\n${phaserJs}\n</script>` });
writeFileSync(join(outDir, 'index.offline.html'), offline);

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} KB`;
console.log(`✓ play/index.html          ${kb(online)} (phaser@${phaserVersion} + 웹폰트 CDN)`);
console.log(`✓ play/index.offline.html  ${kb(offline)} (phaser@${phaserVersion} 인라인${font.glyphs ? ` + 폰트 서브셋 ${font.glyphs}자` : ''}, 오프라인 실행)`);
