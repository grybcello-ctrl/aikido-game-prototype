// 픽셀 아트 원본(art/*.json, 64x64 문자 그리드) → 최적화된 SVG Data URI
//   A (player): 원본 색 + 짙은 회흑 외곽선
//   B (enemy) : A + 실루엣 바깥 2px 붉은(#FF0000) 하이라이트 (오버워치 적군 외곽선 스타일)
// 출력: src/art/sprites.generated.ts, art/preview/*.png (×8), play/sprite-demo.html
// 사용: npm run build:sprites
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const art = JSON.parse(readFileSync(join(root, 'art/tori_idle.json'), 'utf8'));
const N = art.size;
const TRANSPARENT = '.';
const RED_KEY = '@';

if (art.rows.length !== N || art.rows.some((r) => r.length !== N)) throw new Error(`grid must be ${N}x${N}`);
const colorOf = Object.fromEntries(Object.entries(art.palette).map(([k, v]) => [k, v.color.toLowerCase()]));
for (const ch of new Set(art.rows.join(''))) if (ch !== TRANSPARENT && !colorOf[ch]) throw new Error(`palette 에 없는 글자 '${ch}'`);

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

// ── 두 버전 생성 + 무손실 검증 ──
const enemyRows = withEnemyOutline(art.rows, art.enemyOutline.width);
const colorsB = { ...colorOf, [RED_KEY]: art.enemyOutline.color.toLowerCase() };
const versions = {
  player: { rows: art.rows, colors: colorOf, ...toSvg(art.rows, colorOf) },
  enemy: { rows: enemyRows, colors: colorsB, ...toSvg(enemyRows, colorsB) },
};
for (const [name, v] of Object.entries(versions)) {
  const px = rasterize(v.svg);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const want = v.rows[y][x] === TRANSPARENT ? null : v.colors[v.rows[y][x]];
      const got = px[y][x] && expand(px[y][x]);
      if (want !== got) throw new Error(`${name}: (${x},${y}) 기대 ${want} 실제 ${got}`);
    }
  v.uri = toDataUri(v.svg);
}

// ── src/art/sprites.generated.ts ──
const expected = (v) => {
  // 테스트용 기대 픽셀: 행마다 "색 인덱스" 문자열 (0 = 투명)
  const list = [...new Set(Object.values(v.colors))];
  return { colors: list, rows: v.rows.map((r) => [...r].map((c) => (c === TRANSPARENT ? '0' : (list.indexOf(v.colors[c]) + 1).toString(36))).join('')) };
};
const ts = `// 자동 생성 파일: npm run build:sprites (원본: art/${art.id}.json). 직접 수정하지 말 것
/* eslint-disable */

/** 스프라이트 한 변 (px) */
export const SPRITE_SIZE = ${N};
/** 발바닥 기준선 (px, 위에서부터). originY = SPRITE_FOOT_Y / SPRITE_SIZE */
export const SPRITE_FOOT_Y = ${art.footY};

/** 버전 A — 플레이어: 원본 색 + 짙은 회흑 외곽선 (${versions.player.svg.length} bytes) */
export const PLAYER_IDLE_SVG = ${JSON.stringify(versions.player.svg)};
/** 버전 B — 적: A + 바깥 ${art.enemyOutline.width}px ${art.enemyOutline.color.toUpperCase()} 하이라이트 (${versions.enemy.svg.length} bytes) */
export const ENEMY_IDLE_SVG = ${JSON.stringify(versions.enemy.svg)};

export const PLAYER_IDLE_URI = ${JSON.stringify(versions.player.uri)};
export const ENEMY_IDLE_URI = ${JSON.stringify(versions.enemy.uri)};

/** 검증용 기대 픽셀 (행 문자열: 0 = 투명, 1.. = colors[i-1]) */
export const SPRITE_EXPECTED = ${JSON.stringify({ player: expected(versions.player), enemy: expected(versions.enemy) })};
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
const pxA = rasterize(versions.player.svg);
const pxB = rasterize(versions.enemy.svg);
writeFileSync(join(root, 'art/preview/player_idle.png'), png([pxA], 8, 0));
writeFileSync(join(root, 'art/preview/enemy_idle.png'), png([pxB], 8, 0));
writeFileSync(join(root, 'art/preview/side_by_side.png'), png([pxA, pxB], 6, 12));

// ── play/sprite-demo.html: 요청 스펙 그대로의 최소 실행 예제 ──
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const demo = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aikido Pixel Sprite Demo</title>
<!-- 자동 생성: npm run build:sprites (원본 art/${art.id}.json) -->
<style>html,body{margin:0;height:100%;background:#050507;overflow:hidden}canvas{image-rendering:pixelated}</style>
<script src="https://cdn.jsdelivr.net/npm/phaser@${pkg.dependencies.phaser}/dist/phaser.min.js"></script>
</head>
<body>
<script>
// 64x64 픽셀 아트 (SVG Data URI). A = 플레이어, B = 적 (바깥 2px #FF0000 외곽선)
const PLAYER_IDLE = "${versions.player.uri}";
const ENEMY_IDLE = "${versions.enemy.uri}";

const W = 640, H = 360, FLOOR = 300, SCALE = 2; // SCALE 은 반드시 정수
const FOOT = ${art.footY} / ${N};                 // 발바닥 기준선 → originY

class DemoScene extends Phaser.Scene {
  preload() {
    // Data URI 는 <img> 로 디코딩 → file:// 로 열어도 동작. SVG 가 64x64 로 래스터화됨
    this.load.image('player_idle', PLAYER_IDLE);
    this.load.image('enemy_idle', ENEMY_IDLE);
  }
  create() {
    const g = this.add.graphics(); // 배경(도장 바닥)만 Graphics
    g.fillStyle(0x16141c).fillRect(0, 0, W, FLOOR);
    g.fillStyle(0x4b5a2c).fillRect(0, FLOOR, W, H - FLOOR);
    g.fillStyle(0x1b2010).fillRect(0, FLOOR, W, 1);
    // 캐릭터: Sprite, 정수 배율, 정수 좌표
    this.add.sprite(W / 2 - 56, FLOOR, 'player_idle').setOrigin(0.5, FOOT).setScale(SCALE);
    this.add.sprite(W / 2 + 56, FLOOR, 'enemy_idle').setOrigin(0.5, FOOT).setScale(SCALE).setFlipX(true);
    this.add.text(W / 2, 24, 'player_idle  vs  enemy_idle', { fontFamily: 'monospace', fontSize: '12px', color: '#e6e6f0' }).setOrigin(0.5);
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

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(2)} KB`;
for (const [name, v] of Object.entries(versions))
  console.log(`✓ ${name.padEnd(6)} SVG ${kb(v.svg)} · Data URI ${kb(v.uri)} · 색 ${v.order.length} · 칠 순서 ${v.order.join('')}`);
console.log(`✓ src/art/sprites.generated.ts · art/preview/*.png · play/sprite-demo.html (${kb(demo)})`);
