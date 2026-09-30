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

const phaserJs = escapeScript(readFileSync(join(root, 'node_modules/phaser/dist/phaser.min.js'), 'utf8'));
const offline = page({ head: '', phaser: `<script>\n${phaserJs}\n</script>` });
writeFileSync(join(outDir, 'index.offline.html'), offline);

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} KB`;
console.log(`✓ play/index.html          ${kb(online)} (phaser@${phaserVersion} + 웹폰트 CDN)`);
console.log(`✓ play/index.offline.html  ${kb(offline)} (phaser@${phaserVersion} 인라인, 오프라인 실행)`);
