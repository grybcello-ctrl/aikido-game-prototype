// 단일 파일 빌드: src/main.ts → play/index.html (엔진·데이터·씬 인라인, Phaser·폰트는 CDN)
// 사용: npm run build:single
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const phaser = pkg.dependencies.phaser;

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
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
<title>Aikido One-Button — ${pkg.name} ${pkg.version}</title>
<!-- 자동 생성 파일: npm run build:single (직접 수정하지 말 것) -->
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nanum+Gothic+Coding:wght@400;700&display=swap" />
<style>
  html, body { margin: 0; height: 100%; background: #050507; overflow: hidden; touch-action: none; }
  #game { width: 100vw; height: 100vh; }
  canvas { image-rendering: pixelated; image-rendering: crisp-edges; }
</style>
<script src="https://cdn.jsdelivr.net/npm/phaser@${phaser}/dist/phaser.min.js"></script>
</head>
<body>
<div id="game"></div>
<script>
${js}
</script>
</body>
</html>
`;
const out = join(root, 'play', 'index.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`✓ ${out} (${(html.length / 1024).toFixed(1)} KB, phaser@${phaser} via CDN)`);
