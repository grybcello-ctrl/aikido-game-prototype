// 픽셀 아트 원본(art/*.json, 64x64 문자 그리드) → 최적화된 SVG Data URI
//   각 원본 파일의 outputs 마다 텍스처 1개:
//   - enemyOutline 없음 → 원본 색 + 짙은 회흑 외곽선 (플레이어)
//   - enemyOutline 있음 → + 실루엣 바깥 N px 붉은(#FF0000) 하이라이트 (오버워치 적군 외곽선 스타일)
// 출력: src/art/sprites.generated.ts, art/preview/*.png (×8), play/sprite-demo.html
// 사용: npm run build:sprites
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const N = 64;
const TRANSPARENT = '.';
const RED_KEY = '@';

/** B: 실루엣을 반경 width 만큼 둥글게 팽창(dist² ≤ w² + 1) → 새로 생긴 칸을 붉은색으로 */
const withEnemyOutline = (rows, width) => {
  const g = rows.map((r) => [...r]);
  const filled = (x, y) => rows[y]?.[x] !== undefined && rows[y][x] !== TRANSPARENT;
  const r2 = width * width + 1;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (filled(x, y)) continue;
      let hit = false;
      for (let dy = -width; dy <= width && !hit; dy++)
        for (let dx = -width; dx <= width && !hit; dx++) if (dx * dx + dy * dy <= r2 && filled(x + dx, y + dy)) hit = true;
      if (hit) g[y][x] = RED_KEY;
    }
  for (let x = 0; x < N; x++) if (g[0][x] === RED_KEY || g[N - 1][x] === RED_KEY || g[x][0] === RED_KEY || g[x][N - 1] === RED_KEY) {
    // 캔버스 가장자리에 닿으면 외곽선이 잘림 → 원본 여백 부족
    if (g[0][x] === RED_KEY || g[x][0] === RED_KEY || g[x][N - 1] === RED_KEY) throw new Error('붉은 외곽선이 64x64 가장자리에 닿음 (여백 부족)');
  }
  return g.map((r) => r.join(''));
};

/**
 * 그리드 → SVG. 크기 최적화:
 * - 색마다 <path> 1개, 픽셀 가로 줄을 "stroke 1px 선분"으로 표현 (M x y.5 h len) → 사각형 대비 1/3 길이
 * - 화가 알고리즘: 먼저 칠한 색의 선분은 나중에 칠할 색 칸을 덮어도 됨 → 선분 수 감소
 *   칠 순서는 언덕 오르기(인접 교환)로 전체 문자열 길이가 최소가 되게 탐색
 * - 절대/상대 이동 중 짧은 쪽, shape-rendering=crispEdges (안티앨리어싱 없음)
 */
const toSvg = (rows, colors) => {
  const keys = [...new Set(rows.join(''))].filter((c) => c !== TRANSPARENT);
  const runsFor = (order) => {
    const rank = Object.fromEntries(order.map((k, i) => [k, i]));
    return order.map((k) => {
      const runs = [];
      for (let y = 0; y < N; y++) {
        const row = rows[y];
        let x = 0;
        while (x < N) {
          // 이 색이 칠할 수 있는 칸 = 자기 색 ∪ 나중에 칠할 색. 선분은 자기 색 칸에서 시작·끝
          if (row[x] !== k) { x++; continue; }
          let end = x;
          for (let j = x; j < N && row[j] !== TRANSPARENT && rank[row[j]] >= rank[k]; j++) if (row[j] === k) end = j;
          runs.push([x, y, end - x + 1]);
          x = end + 1;
        }
      }
      return runs;
    });
  };
  const num = (v) => (Number.isInteger(v) ? String(v) : String(v).replace(/^(-?)0\./, '$1.'));
  const pathFor = (runs) => {
    let d = '';
    let cx = null;
    let cy = null;
    for (const [x, y, len] of runs) {
      const abs = `M${num(x)} ${num(y + 0.5)}`;
      let move = abs;
      if (cx !== null) {
        const dx = x - cx;
        const dy = y + 0.5 - cy;
        const rel = `m${num(dx)}${dy < 0 ? '' : ' '}${num(dy)}`;
        if (rel.length < abs.length) move = rel;
      }
      d += `${move}h${len}`;
      cx = x + len;
      cy = y + 0.5;
    }
    return d.replace(/ -/g, '-');
  };
  const hex = (c) => (/^#(.)\1(.)\2(.)\3$/.test(c) ? `#${c[1]}${c[3]}${c[5]}` : c);
  const build = (order) => {
    const paths = runsFor(order).map((runs, i) => `<path stroke="${hex(colors[order[i]])}" d="${pathFor(runs)}"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}" shape-rendering="crispEdges">${paths}</svg>`;
  };

  // 칠 순서 탐색: 면적 큰 색 먼저 → 인접 교환 언덕 오르기
  const area = Object.fromEntries(keys.map((k) => [k, rows.join('').split(k).length - 1]));
  let order = [...keys].sort((a, b) => area[b] - area[a]);
  let best = build(order);
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 0; i < order.length; i++)
      for (let j = i + 1; j < order.length; j++) {
        const o = [...order];
        [o[i], o[j]] = [o[j], o[i]];
        const svg = build(o);
        if (svg.length < best.length) { best = svg; order = o; improved = true; }
      }
  }
  return { svg: best, order };
};

/** SVG → Data URI (utf8, 필요한 글자만 이스케이프: base64 보다 약 25% 짧음) */
const toDataUri = (svg) => `data:image/svg+xml,${svg.replace(/"/g, "'").replace(/[%#<>]/g, encodeURIComponent)}`;

/** 원본 그리드를 SVG 와 같은 규칙으로 되돌려 검증 (선분 해석 → 픽셀) */
const rasterize = (svg) => {
  const px = Array.from({ length: N }, () => Array(N).fill(null));
  for (const [, color, d] of svg.matchAll(/stroke="([^"]+)" d="([^"]+)"/g)) {
    let x = 0;
    let y = 0;
    for (const [, cmd, a, b] of d.matchAll(/([Mmh])(-?[\d.]+)(?:[ ]?(-?[\d.]+))?/g)) {
      if (cmd === 'M') { x = +a; y = +b; }
      else if (cmd === 'm') { x += +a; y += +b; }
      else { for (let i = 0; i < +a; i++) px[Math.floor(y)][x + i] = color; x += +a; }
    }
  }
  return px;
};
const expand = (c) => (c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c);

// ── 원본 파일 × outputs → 텍스처 + 무손실 검증 ──
const sprites = [];
for (const file of readdirSync(join(root, 'art')).filter((f) => f.endsWith('.json')).sort()) {
  const art = JSON.parse(readFileSync(join(root, 'art', file), 'utf8'));
  if (art.size !== N || art.rows.length !== N || art.rows.some((r) => r.length !== N)) throw new Error(`${file}: grid must be ${N}x${N}`);
  const colorOf = Object.fromEntries(Object.entries(art.palette).map(([k, v]) => [k, v.color.toLowerCase()]));
  for (const ch of new Set(art.rows.join(''))) if (ch !== TRANSPARENT && !colorOf[ch]) throw new Error(`${file}: palette 에 없는 글자 '${ch}'`);
  if (!Array.isArray(art.outputs) || !art.outputs.length) throw new Error(`${file}: outputs 가 비어 있음`);
  for (const out of art.outputs) {
    if (!/^[a-z0-9_]+$/.test(out.key)) throw new Error(`${file}: 잘못된 텍스처 키 '${out.key}'`);
    if (sprites.some((sp) => sp.key === out.key)) throw new Error(`텍스처 키 중복 '${out.key}'`);
    const ol = out.enemyOutline ?? null;
    const rows = ol ? withEnemyOutline(art.rows, ol.width) : art.rows;
    const colors = ol ? { ...colorOf, [RED_KEY]: ol.color.toLowerCase() } : colorOf;
    const { svg, order } = toSvg(rows, colors);
    const px = rasterize(svg);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const want = rows[y][x] === TRANSPARENT ? null : colors[rows[y][x]];
        const got = px[y][x] && expand(px[y][x]);
        if (want !== got) throw new Error(`${out.key}: (${x},${y}) 기대 ${want} 실제 ${got}`);
      }
    sprites.push({ key: out.key, file, name: art.name, footY: art.footY, rows, colors, svg, order, px, uri: toDataUri(svg), outline: ol });
  }
}
const byKey = Object.fromEntries(sprites.map((sp) => [sp.key, sp]));
for (const k of ['player_idle', 'enemy_idle']) if (!byKey[k]) throw new Error(`필수 텍스처 '${k}' 없음`);

// ── src/art/sprites.generated.ts ──
const expected = (v) => {
  // 테스트용 기대 픽셀: 행마다 "색 인덱스" 문자열 (0 = 투명)
  const list = [...new Set(Object.values(v.colors))];
  return { colors: list, rows: v.rows.map((r) => [...r].map((c) => (c === TRANSPARENT ? '0' : (list.indexOf(v.colors[c]) + 1).toString(36))).join('')) };
};
const CONST = (k) => k.toUpperCase();
const describe = (sp) => (sp.outline ? `적: 바깥 ${sp.outline.width}px ${sp.outline.color.toUpperCase()} 하이라이트` : '플레이어: 원본 색 + 짙은 회흑 외곽선');
const ts = `// 자동 생성 파일: npm run build:sprites (원본: art/*.json). 직접 수정하지 말 것
/* eslint-disable */

/** 스프라이트 한 변 (px) */
export const SPRITE_SIZE = ${N};
/** 대기 포즈 발바닥 기준선 (px, 위에서부터). originY = footY / SPRITE_SIZE */
export const SPRITE_FOOT_Y = ${byKey.player_idle.footY};

${sprites.map((sp) => `/** ${sp.key} — ${sp.name} · ${describe(sp)} (SVG ${sp.svg.length} bytes, 원본 art/${sp.file}) */
export const ${CONST(sp.key)}_SVG = ${JSON.stringify(sp.svg)};
export const ${CONST(sp.key)}_URI = ${JSON.stringify(sp.uri)};`).join('\n\n')}

export interface SpriteAsset {
  key: string;
  svg: string;
  uri: string;
  /** 발바닥 기준선 (px) */
  footY: number;
  enemyOutline: { color: string; width: number } | null;
}

/** 텍스처 키 → 에셋 */
export const SPRITES = {
${sprites.map((sp) => `  ${sp.key}: { key: '${sp.key}', svg: ${CONST(sp.key)}_SVG, uri: ${CONST(sp.key)}_URI, footY: ${sp.footY}, enemyOutline: ${JSON.stringify(sp.outline)} },`).join('\n')}
} as const satisfies Record<string, SpriteAsset>;

export type SpriteKey = keyof typeof SPRITES;

/** 검증용 기대 픽셀 (행 문자열: 0 = 투명, 1.. = colors[i-1]) */
export const SPRITE_EXPECTED: Record<SpriteKey, { colors: string[]; rows: string[] }> = ${JSON.stringify(Object.fromEntries(sprites.map((sp) => [sp.key, expected(sp)])))};
`;
mkdirSync(join(root, 'src/art'), { recursive: true });
writeFileSync(join(root, 'src/art/sprites.generated.ts'), ts);

// ── 미리보기 PNG (×8, 체커보드 배경) ──
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const png = (grids, scale, gap) => {
  const W = grids.length * N * scale + (grids.length - 1) * gap;
  const H = N * scale;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gi = Math.floor(x / (N * scale + gap));
      const lx = x - gi * (N * scale + gap);
      const px = Math.floor(lx / scale);
      const py = Math.floor(y / scale);
      let rgb = (px + py) % 2 ? [40, 40, 48] : [50, 50, 58];
      if (lx >= N * scale) rgb = [20, 20, 24];
      else { const c = grids[gi][py][px]; if (c) rgb = [1, 3, 5].map((i) => parseInt(expand(c).slice(i, i + 2), 16)); }
      raw.set([...rgb, 255], y * (W * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
mkdirSync(join(root, 'art/preview'), { recursive: true });
for (const sp of sprites) writeFileSync(join(root, `art/preview/${sp.key}.png`), png([sp.px], 8, 0));
writeFileSync(join(root, 'art/preview/side_by_side.png'), png([byKey.player_idle.px, byKey.enemy_idle.px], 6, 12));
if (byKey.enemy_shomenuchi)
  writeFileSync(join(root, 'art/preview/enemy_idle_to_shomenuchi.png'), png([byKey.enemy_idle.px, byKey.enemy_shomenuchi.px], 6, 12));

// ── play/sprite-demo.html: preload / create / setTexture 최소 실행 예제 ──
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const strike = byKey.enemy_shomenuchi;
const demo = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aikido Pixel Sprite Demo</title>
<!-- 자동 생성: npm run build:sprites (원본 art/*.json) -->
<style>html,body{margin:0;height:100%;background:#050507;overflow:hidden}canvas{image-rendering:pixelated}</style>
<script src="https://cdn.jsdelivr.net/npm/phaser@${pkg.dependencies.phaser}/dist/phaser.min.js"></script>
</head>
<body>
<script>
// 64x64 픽셀 아트 (SVG Data URI). 적 텍스처는 바깥 2px #FF0000 외곽선
${sprites.map((sp) => `const ${CONST(sp.key)} = "${sp.uri}";`).join('\n')}

const W = 640, H = 360, FLOOR = 300, SCALE = 2; // SCALE 은 반드시 정수
const FOOT = ${byKey.player_idle.footY} / ${N};                 // 발바닥 기준선 → originY (모든 포즈 동일)

class DemoScene extends Phaser.Scene {
  preload() {
    // Data URI 는 <img> 로 디코딩 → file:// 로 열어도 동작. SVG 가 64x64 로 래스터화됨
${sprites.map((sp) => `    this.load.image('${sp.key}', ${CONST(sp.key)});`).join('\n')}
  }
  create() {
    const g = this.add.graphics(); // 배경(도장 바닥)만 Graphics
    g.fillStyle(0x16141c).fillRect(0, 0, W, FLOOR);
    g.fillStyle(0x4b5a2c).fillRect(0, FLOOR, W, H - FLOOR);
    g.fillStyle(0x1b2010).fillRect(0, FLOOR, W, 1);
    // 캐릭터: Sprite, 정수 배율, 정수 좌표. 적은 좌우 반전해 플레이어를 마주 봄
    this.player = this.add.sprite(W / 2 - 48, FLOOR, 'player_idle').setOrigin(0.5, FOOT).setScale(SCALE);
    this.enemy = this.add.sprite(W / 2 + 48, FLOOR, 'enemy_idle').setOrigin(0.5, FOOT).setScale(SCALE).setFlipX(true);
    this.label = this.add.text(W / 2, 24, '', { fontFamily: 'monospace', fontSize: '12px', color: '#e6e6f0' }).setOrigin(0.5);
${strike ? `    // Phase 1(적 공격 시작) ↔ 대기 를 번갈아 보여줌 (클릭/Space 로도 전환)
    const toggle = () => {
      const striking = this.enemy.texture.key !== 'enemy_shomenuchi';
      this.enemy.setTexture(striking ? 'enemy_shomenuchi' : 'enemy_idle'); // ← Phase 1 발동 시 교체
      this.label.setText(striking ? 'Phase 1: enemy_shomenuchi' : 'enemy_idle');
    };
    this.time.addEvent({ delay: 900, loop: true, callback: toggle });
    this.input.on('pointerdown', toggle);
    this.input.keyboard.on('keydown-SPACE', toggle);
    this.label.setText('enemy_idle');` : `    this.label.setText('player_idle  vs  enemy_idle');`}
  }
}

// 창 크기에 맞춘 정수 배율 줌 (비정수 확대로 도트가 번지지 않게)
const fitZoom = () => Math.max(1, Math.floor(Math.min(innerWidth / W, innerHeight / H)));
const game = new Phaser.Game({
  type: Phaser.AUTO, width: W, height: H, backgroundColor: '#0d0d12',
  pixelArt: true, roundPixels: true, antialias: false,
  scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.CENTER_BOTH, zoom: fitZoom() },
  scene: DemoScene,
});
addEventListener('resize', () => game.isBooted && game.scale.setZoom(fitZoom()));
</script>
</body>
</html>
`;
mkdirSync(join(root, 'play'), { recursive: true });
writeFileSync(join(root, 'play/sprite-demo.html'), demo);

const kb = (x) => `${(Buffer.byteLength(x) / 1024).toFixed(2)} KB`;
for (const sp of sprites)
  console.log(`✓ ${sp.key.padEnd(17)} SVG ${kb(sp.svg)} · Data URI ${kb(sp.uri)} · 색 ${sp.order.length} · ${sp.file}`);
console.log(`✓ src/art/sprites.generated.ts · art/preview/*.png · play/sprite-demo.html (${kb(demo)})`);
