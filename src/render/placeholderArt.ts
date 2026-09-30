import art from '../../art/tori_idle.json';
import { SPRITES } from '../art/sprites.generated';
import type { PoseHint } from '../types/animations';

/**
 * 플레이스홀더 픽셀 아트 생성기 (실제 스프라이트가 들어오기 전 임시 그림).
 * 포즈 힌트의 시작/끝 관절 파라미터를 프레임마다 보간해 1px 외곽선이 있는 도복 인물을 그린다.
 * 모든 좌표는 정수 픽셀 단위로 fillRect → 확대해도 번지지 않는다.
 */

/** 팔을 뻗거나 누운 포즈(낙법)가 잘리지 않도록 가로 여유. 높이는 SVG 픽셀 아트와 같은 64 */
export const CHAR_FRAME = { w: 96, h: 64 } as const;
export const FX_FRAME = { w: 32, h: 32 } as const;

interface Joint {
  /** 상체 기울기(도, + = 앞) */
  lean: number;
  /** 팔 각도(도, 0 = 앞으로 수평, - = 위, + = 아래) */
  arm: number;
  /** 팔 길이 px */
  reach: number;
  /** 무릎 굽힘 px */
  crouch: number;
  /** 눕기(0..1, 1 = 등을 대고 수평) */
  lie: number;
  /** 몸 전체 앞뒤 이동 px */
  dx: number;
  /** 보폭 px */
  step: number;
}

const J = (p: Partial<Joint>): Joint => ({ lean: 0, arm: 40, reach: 10, crouch: 0, lie: 0, dx: 0, step: 4, ...p });

/** 포즈 = [시작, 끝] */
const POSES: Record<Exclude<PoseHint, `fx_${string}`>, [Joint, Joint]> = {
  stand: [J({}), J({ crouch: 1 })],
  windup: [J({ lean: -5, arm: 20 }), J({ lean: -8, arm: -110, reach: 13 })],
  strike: [J({ lean: -5, arm: -110, reach: 13 }), J({ lean: 18, arm: 20, reach: 15, dx: 4, step: 8 })],
  step_in: [J({ lean: 5, arm: 30 }), J({ lean: 15, arm: -10, reach: 14, dx: 8, step: 9, crouch: 3 })],
  stagger: [J({}), J({ lean: -15, arm: 60, dx: -4, step: 6 })],
  hit: [J({ lean: -10, arm: 50 }), J({ lean: -25, arm: 70, dx: -6, crouch: 4 })],
  lead: [J({ lean: 5, arm: 0, reach: 14, step: 6 }), J({ lean: 10, arm: -20, reach: 15, step: 8, crouch: 4 })],
  drawn: [J({ lean: 10, arm: 10 }), J({ lean: 25, arm: 30, dx: 4, crouch: 3 })],
  off_balance: [J({ lean: 25, arm: 30, crouch: 3 }), J({ lean: -20, arm: -40, crouch: 6, dx: -2 })],
  resist: [J({ lean: 15 }), J({ lean: -5, arm: 20, step: 8 })],
  recover: [J({ lean: -10, crouch: 4 }), J({ lean: 0, arm: 40 })],
  lift_prep: [J({ arm: -20, reach: 14 }), J({ lean: -5, arm: -100, reach: 15, step: 7 })],
  lifted: [J({ lean: -15, arm: -40 }), J({ lean: -30, arm: -70, dx: -2 })],
  cut: [J({ lean: -5, arm: -100, reach: 15, step: 7 }), J({ lean: 30, arm: 40, reach: 16, dx: 6, step: 10, crouch: 6 })],
  thrown: [J({ lean: -30, lie: 0.1 }), J({ lean: -20, lie: 0.85, dx: -6 })],
  weak: [J({ lean: 10, arm: 10 }), J({ lean: 5, arm: 30, crouch: 2 })],
  whiff: [J({ lean: 20, arm: 20 }), J({ lean: 35, arm: 50, dx: 8, crouch: 6 })],
  zanshin: [J({ lean: 5, arm: 30, reach: 13, step: 7, crouch: 3 }), J({ lean: 5, arm: 28, reach: 13, step: 7, crouch: 4 })],
  roll: [J({ lie: 0.6, arm: -60 }), J({ lie: 1, dx: -10, arm: 60 })],
  sloppy: [J({ lie: 0.7, arm: 80 }), J({ lie: 1, dx: -4, crouch: 2, arm: -80 })],
  crash: [J({ lie: 0.9, arm: -90 }), J({ lie: 1, dx: -2, arm: 90, reach: 12 })],
  reach: [J({ arm: 30 }), J({ lean: 15, arm: 0, reach: 16, dx: 6, step: 8 })],
  hold: [J({ lean: 15, arm: 0, reach: 16, dx: 6, step: 8 }), J({ lean: 18, arm: 5, reach: 16, dx: 6, step: 8, crouch: 2 })],
  turn: [J({ arm: 20 }), J({ lean: 8, arm: -10, reach: 14, dx: 10, step: 9, crouch: 4 })],
  raise: [J({ arm: -20, reach: 14 }), J({ lean: 5, arm: -100, reach: 15, step: 8, crouch: 2 })],
  twisted: [J({ lean: 15, arm: -30 }), J({ lean: -25, arm: -80, dx: -3 })],
  stuck: [J({ lean: 5, arm: 10 }), J({ lean: -10, arm: 10, crouch: 4 })],
};

export interface Palette {
  gi: string; giShade: string; hakama: string; belt: string; skin: string; hair: string; hairShade: string; outline: string;
  /** 적 하이라이트: 외곽선 바깥 2px 링 (오버워치 적군 표시) */
  highlight?: string;
}

/** 64x64 픽셀 아트(art/tori_idle.json)와 같은 팔레트 → 대기 포즈 ↔ 동작 포즈 전환 시 색이 튀지 않음 */
const P = art.palette;
/** 토리(플레이어): 은발 · 흰 도복 · 검은 하카마 · 짙은 회흑 외곽선 */
export const TORI_PALETTE: Palette = {
  gi: P.W.color, giShade: P.w.color, hakama: P.B.color, belt: P.n.color, skin: P.S.color,
  hair: P.H.color, hairShade: P.h.color, outline: P.K.color,
};
/** 우케(적): 같은 모습 + 바깥 붉은 외곽선 */
export const UKE_PALETTE: Palette = { ...TORI_PALETTE, highlight: SPRITES.enemy_idle.enemyOutline.color };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpJoint = (a: Joint, b: Joint, t: number): Joint => ({
  lean: lerp(a.lean, b.lean, t), arm: lerp(a.arm, b.arm, t), reach: lerp(a.reach, b.reach, t),
  crouch: lerp(a.crouch, b.crouch, t), lie: lerp(a.lie, b.lie, t), dx: lerp(a.dx, b.dx, t), step: lerp(a.step, b.step, t),
});
const rad = (d: number) => (d * Math.PI) / 180;

type Ctx = CanvasRenderingContext2D;
type Pt = { x: number; y: number };

/** 굵은 선: 선을 따라 w×w 사각형 도장 */
const stroke = (ctx: Ctx, a: Pt, b: Pt, w: number, color: string, map: (p: Pt) => Pt) => {
  ctx.fillStyle = color;
  const pa = map(a);
  const pb = map(b);
  const len = Math.max(1, Math.hypot(pb.x - pa.x, pb.y - pa.y));
  const steps = Math.ceil(len * 2);
  for (let i = 0; i <= steps; i++) {
    const x = pa.x + ((pb.x - pa.x) * i) / steps;
    const y = pa.y + ((pb.y - pa.y) * i) / steps;
    ctx.fillRect(Math.round(x - w / 2), Math.round(y - w / 2), w, w);
  }
};
const disc = (ctx: Ctx, c: Pt, r: number, color: string, map: (p: Pt) => Pt) => {
  ctx.fillStyle = color;
  const p = map(c);
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(r * r - dy * dy));
    ctx.fillRect(Math.round(p.x) - half, Math.round(p.y) + dy, half * 2 + 1, 1);
  }
};

/** 인물 1프레임 (오른쪽을 봄). ox,oy = 프레임 좌상단 */
export const drawFigure = (ctx: Ctx, pose: PoseHint, t: number, pal: Palette, ox: number, oy: number): void => {
  const pair = POSES[pose as keyof typeof POSES] ?? POSES.stand;
  const j = lerpJoint(pair[0], pair[1], t);
  const { w, h } = CHAR_FRAME;

  // 로컬 좌표(x 앞, y 위, 원점 = 발 중심) — 눕기는 발 기준 회전 후 바닥 위로 올림
  const hipY = 26 - j.crouch;
  const hip = { x: j.dx, y: hipY };
  const L = rad(j.lean);
  const shoulder = { x: hip.x + Math.sin(L) * 16, y: hip.y + Math.cos(L) * 16 };
  const head = { x: hip.x + Math.sin(L) * 23, y: hip.y + Math.cos(L) * 23 };
  const A = rad(j.arm);
  const hand = { x: shoulder.x + Math.cos(A) * j.reach, y: shoulder.y - Math.sin(A) * j.reach };
  const elbow = { x: (shoulder.x + hand.x) / 2, y: (shoulder.y + hand.y) / 2 - 1 };
  const backHand = { x: shoulder.x - 2 + Math.cos(A + 0.5) * j.reach * 0.7, y: shoulder.y - 2 - Math.sin(A + 0.5) * j.reach * 0.7 };
  const front = { x: j.dx + j.step, y: 0 };
  const back = { x: j.dx - j.step, y: 0 };

  const phi = rad(j.lie * 90);
  const rot = (p: Pt): Pt => ({ x: p.x * Math.cos(phi) - p.y * Math.sin(phi), y: p.x * Math.sin(phi) + p.y * Math.cos(phi) });
  const pts = [hip, shoulder, head, hand, elbow, backHand, front, back].map(rot);
  const lift = Math.max(0, -Math.min(...pts.map((p) => p.y - 4)));
  const map = (p: Pt): Pt => {
    const r = rot(p);
    // 누울수록 몸 중심을 조금 앞으로 → 발 기준 회전해도 머리가 프레임 밖으로 나가지 않음
    return { x: ox + w / 2 + r.x + j.lie * 10, y: oy + h - 2 - (r.y + lift) };
  };

  // 패스: (적) 붉은 하이라이트 +6 → 외곽선 +2 → 채움. 각 패스는 같은 뼈대를 굵기만 달리 그림
  const passes: { o: number; color: string | null }[] = [
    ...(pal.highlight ? [{ o: 6, color: pal.highlight }] : []),
    { o: 2, color: pal.outline },
    { o: 0, color: null },
  ];
  for (const { o, color } of passes) {
    const c = (col: string) => color ?? col;
    // 굵기는 64x64 대기 스프라이트의 실루엣(넓은 소매·퍼진 하카마)에 맞춤
    stroke(ctx, shoulder, backHand, 5 + o, c(pal.giShade), map);
    stroke(ctx, hip, back, 9 + o, c(pal.hakama), map);
    stroke(ctx, hip, front, 9 + o, c(pal.hakama), map);
    stroke(ctx, { x: hip.x, y: hip.y - 6 }, { x: (back.x + front.x) / 2, y: 2 }, 12 + o, c(pal.hakama), map);
    stroke(ctx, hip, shoulder, 12 + o, c(pal.gi), map);
    disc(ctx, head, 5 + Math.ceil(o / 2), c(pal.skin), map);
    stroke(ctx, shoulder, elbow, 6 + o, c(pal.gi), map);
    stroke(ctx, elbow, hand, 5 + o, c(pal.gi), map);
  }
  // 디테일: 은발(뒤통수·정수리), 띠, 손, 소매 음영
  // 은발은 뒤통수·정수리 쪽만 → 앞쪽 얼굴(피부)이 보이게. 눈 1px
  const back1 = { x: head.x - Math.cos(L) * 2.5 - Math.sin(L) * 0.5, y: head.y + 1.5 - Math.sin(L) * 1 };
  disc(ctx, back1, 4, pal.hairShade, map);
  disc(ctx, { x: back1.x + 0.5, y: back1.y + 1.5 }, 3, pal.hair, map);
  const eye = map({ x: head.x + Math.cos(L) * 2.5, y: head.y + 0.5 - Math.sin(L) * 2 });
  ctx.fillStyle = art.palette.E.color;
  ctx.fillRect(Math.round(eye.x), Math.round(eye.y), 1, 1);
  stroke(ctx, { x: hip.x - 5, y: hip.y + 1 }, { x: hip.x + 5, y: hip.y + 1 }, 2, pal.belt, map);
  disc(ctx, hand, 1, pal.skin, map);
  stroke(ctx, { x: shoulder.x - 1, y: shoulder.y - 3 }, { x: hip.x - 2, y: hip.y + 3 }, 2, pal.giShade, map);
};

/** 이펙트 1프레임 (32x32, 중심 기준) */
export const drawFx = (ctx: Ctx, pose: PoseHint, t: number, ox: number, oy: number): void => {
  const cx = ox + FX_FRAME.w / 2;
  const cy = oy + FX_FRAME.h / 2;
  const px = (x: number, y: number, s = 1) => ctx.fillRect(Math.round(x), Math.round(y), s, s);
  const ring = (r: number, color: string, s = 1) => {
    ctx.fillStyle = color;
    const n = Math.max(8, Math.round(r * 6));
    for (let i = 0; i < n; i++) px(cx + Math.cos((i / n) * 2 * Math.PI) * r - s / 2, cy + Math.sin((i / n) * 2 * Math.PI) * r - s / 2, s);
  };
  switch (pose) {
    case 'fx_flash': {
      const r = Math.round(2 + t * 12);
      ctx.fillStyle = t < 0.5 ? '#ffffff' : '#9be7ff';
      for (let d = -r; d <= r; d++) {
        const span = r - Math.abs(d);
        ctx.fillRect(cx - Math.round(span * 0.35), cy + d, Math.round(span * 0.7) + 1, 1);
        ctx.fillRect(cx + d, cy - Math.round(span * 0.35), 1, Math.round(span * 0.7) + 1);
      }
      break;
    }
    case 'fx_soft':
      ring(3 + t * 8, t < 0.6 ? '#fff4c2' : '#c9b87a');
      break;
    case 'fx_spark': {
      ctx.fillStyle = t < 0.5 ? '#ffffff' : '#ffd166';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 2 * Math.PI + 0.3;
        for (let r = 2 + t * 6; r < 5 + t * 11; r += 1) px(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      break;
    }
    case 'fx_ring':
      ring(4 + t * 11, '#4fc3f7', 2);
      if (t < 0.5) ring(2 + t * 6, '#ffffff');
      break;
    case 'fx_dust': {
      ctx.fillStyle = t < 0.5 ? '#9a8f7a' : '#6b6354';
      for (let i = 0; i < 14; i++) {
        const a = Math.PI + (i / 13) * Math.PI;
        const r = 3 + t * 12 + ((i * 7) % 5);
        px(cx + Math.cos(a) * r, cy + 8 + Math.sin(a) * r * 0.4, 2);
      }
      break;
    }
    default:
      ring(6, '#ff00ff');
  }
};
