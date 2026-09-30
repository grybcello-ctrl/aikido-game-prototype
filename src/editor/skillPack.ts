import type Phaser from 'phaser';
import { validateTechnique } from '../engine/validate';
import type { AnimationManifest, SequenceDef } from '../types/animations';
import type { AnimationCue, TechniqueData } from '../types/technique';

/**
 * 스킬 팩 = 개발자 모드에서 만든 기술 목록 + 업로드 이미지로 만든 시퀀스 + 이미지 데이터.
 * schema/skillpack.schema.json 과 1:1 대응. Export JSON 도 이 형식 그대로.
 *
 * - techniques   : TechniqueData[] (technique.schema.json). 편집 중에는 일시적으로 규칙 위반일 수 있음
 * - animations   : 추가 시퀀스 (custom.* Key → { frames:1, image: 텍스처 키 })
 * - assets       : 텍스처 키(custom_xxxxxxxx) → PNG/SVG Data URI
 *
 * localStorage 에 자동 저장 → PLAY MODE 가 같은 팩으로 플레이 (유효한 기술이 하나도 없으면 기본 기술).
 */
export interface SkillPack {
  $schema?: string;
  schemaVersion: 1;
  techniques: TechniqueData[];
  animations: { sequences: Record<string, SequenceDef> };
  assets: Record<string, string>;
}

export const PACK_STORAGE_KEY = 'aikido.skillpack.v1';
export const PACK_SCHEMA = 'schema/skillpack.schema.json';
/** 업로드 이미지로 만든 시퀀스 Key 접두사 */
export const CUSTOM_SEQ_PREFIX = 'custom.';
const CUSTOM_TEX = /^custom_[0-9a-f]{8}$/;
const SEQ_KEY = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const DATA_URI = /^data:image\/(png|svg\+xml|jpeg|gif|webp)[;,]/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const emptyPack = (techniques: TechniqueData[] = []): SkillPack => ({
  $schema: PACK_SCHEMA,
  schemaVersion: 1,
  techniques: clone(techniques),
  animations: { sequences: {} },
  assets: {},
});

/** FNV-1a 32bit → 텍스처 키 (같은 이미지 = 같은 키, 다른 이미지 = 새 키 → 캐시된 옛 텍스처와 충돌 없음) */
export const assetKeyFor = (dataUri: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < dataUri.length; i++) {
    h ^= dataUri.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `custom_${h.toString(16).padStart(8, '0')}`;
};

/** 기술이 참조하는 모든 시퀀스 Key */
export const cuesOf = (t: TechniqueData): AnimationCue[] => {
  const out: AnimationCue[] = [];
  for (const p of t.phases ?? []) {
    out.push(...(p.animations ?? []));
    for (const r of Object.values(p.onJudge ?? {})) out.push(...(r?.cues ?? []));
    if (p.type === 'progression') for (const s of p.steps ?? []) out.push(...(s.animations ?? []));
  }
  for (const r of Object.values(t.ukemi?.results ?? {})) out.push(...(r?.animations ?? []));
  return out;
};

/**
 * 구조 검사 (신뢰할 수 없는 JSON). 기술 내용은 validateTechnique 가 담당하므로 여기서는 팩 틀만.
 * @returns 문제 목록 (빈 배열 = 사용 가능)
 */
export const checkPackShape = (v: unknown): string[] => {
  const errs: string[] = [];
  if (!isObj(v)) return ['(root): 객체가 아님'];
  if (v.schemaVersion !== 1) errs.push('schemaVersion: 1 이어야 함');
  if (!Array.isArray(v.techniques)) errs.push('techniques: 배열이어야 함');
  const seqs = isObj(v.animations) ? v.animations.sequences : undefined;
  if (!isObj(seqs)) errs.push('animations.sequences: 객체가 필요');
  else
    for (const [k, d] of Object.entries(seqs)) {
      if (!SEQ_KEY.test(k) || !k.startsWith(CUSTOM_SEQ_PREFIX)) errs.push(`animations.sequences.${k}: Key 는 custom.* 형식`);
      if (!isObj(d) || typeof d.image !== 'string' || !CUSTOM_TEX.test(d.image)) errs.push(`animations.sequences.${k}.image: custom_xxxxxxxx 텍스처 키 필요`);
    }
  if (!isObj(v.assets)) errs.push('assets: 객체가 필요');
  else
    for (const [k, uri] of Object.entries(v.assets)) {
      if (!CUSTOM_TEX.test(k)) errs.push(`assets.${k}: 키는 custom_xxxxxxxx`);
      if (typeof uri !== 'string' || !DATA_URI.test(uri)) errs.push(`assets.${k}: PNG/SVG Data URI 가 아님`);
    }
  return errs;
};

/** 문자열 → 팩 (Import / localStorage 공통) */
export const parsePack = (text: string): { pack: SkillPack | null; errors: string[] } => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { pack: null, errors: [`JSON 파싱 실패: ${(e as Error).message}`] };
  }
  // 기술 1개(TechniqueData) 또는 기술 배열만 붙여 넣은 경우도 받아 준다
  if (isObj(raw) && raw.phases && !raw.techniques) raw = { ...emptyPack(), techniques: [raw] };
  else if (Array.isArray(raw)) raw = { ...emptyPack(), techniques: raw };
  const errors = checkPackShape(raw);
  if (errors.length) return { pack: null, errors };
  const p = raw as SkillPack;
  return { pack: { $schema: PACK_SCHEMA, schemaVersion: 1, techniques: p.techniques, animations: { sequences: { ...p.animations.sequences } }, assets: { ...p.assets } }, errors: [] };
};

// ───────────────────────────── 저장소 ─────────────────────────────

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // file:// + 차단 설정 등
  }
};

export const loadPack = (): SkillPack | null => {
  const text = storage()?.getItem(PACK_STORAGE_KEY);
  if (!text) return null;
  const { pack, errors } = parsePack(text);
  if (!pack) console.warn('[skillPack] 저장된 팩 무시', errors);
  return pack;
};

/** @returns 실패 사유 (용량 초과 등) 또는 null */
export const savePack = (pack: SkillPack): string | null => {
  const s = storage();
  if (!s) return '이 브라우저에서는 localStorage 를 쓸 수 없음 (Export 로 백업하세요)';
  try {
    s.setItem(PACK_STORAGE_KEY, JSON.stringify(prunePack(pack)));
    return null;
  } catch (e) {
    return `저장 실패: ${(e as Error).name === 'QuotaExceededError' ? '용량 초과 (이미지가 너무 큼)' : (e as Error).message}`;
  }
};

export const clearPack = (): void => {
  storage()?.removeItem(PACK_STORAGE_KEY);
};

/** 어떤 기술에서도 쓰지 않는 custom 시퀀스·이미지를 뺀 사본 */
export const prunePack = (pack: SkillPack): SkillPack => {
  const used = new Set(pack.techniques.flatMap((t) => cuesOf(t).map((c) => c.key)));
  const sequences: Record<string, SequenceDef> = {};
  const assets: Record<string, string> = {};
  for (const [k, d] of Object.entries(pack.animations.sequences)) {
    if (!used.has(k)) continue;
    sequences[k] = d;
    if (d.image && pack.assets[d.image]) assets[d.image] = pack.assets[d.image] as string;
  }
  return { $schema: PACK_SCHEMA, schemaVersion: 1, techniques: pack.techniques, animations: { sequences }, assets };
};

/** Export JSON 텍스트 (정리된 팩, 들여쓰기 2) */
export const exportPackJson = (pack: SkillPack): string => `${JSON.stringify(prunePack(pack), null, 2)}\n`;

// ───────────────────────────── 게임 연결 ─────────────────────────────

/** 기본 매니페스트 + 팩 시퀀스 (기본 Key 는 덮어쓰지 않음) */
export const manifestWith = (base: AnimationManifest, pack: SkillPack | null): AnimationManifest => {
  if (!pack) return base;
  const sequences = { ...base.sequences };
  for (const [k, d] of Object.entries(pack.animations.sequences)) if (!(k in sequences)) sequences[k] = d;
  return { ...base, sequences };
};

/** preload() 에서 호출: 팩 이미지 → 텍스처 (이미 있으면 건너뜀) */
export const preloadPackAssets = (scene: Phaser.Scene, pack: SkillPack | null): void => {
  if (!pack) return;
  for (const [key, uri] of Object.entries(pack.assets)) if (!scene.textures.exists(key)) scene.load.image(key, uri);
};

/**
 * PLAY MODE 기술 목록: 저장된 팩의 유효한 기술 → 없으면 기본 기술.
 * 규칙 위반 기술은 제외하고 사유를 errors 로 돌려준다.
 */
export const playableTechniques = (builtins: unknown[], pack: SkillPack | null): { techniques: TechniqueData[]; errors: string[]; fromPack: boolean } => {
  const pick = (list: unknown[]) => {
    const ok: TechniqueData[] = [];
    const errors: string[] = [];
    for (const raw of list) {
      const issues = validateTechnique(raw);
      if (issues.length) errors.push(`${(raw as { id?: string })?.id ?? '(unknown)'}: ${issues[0]}`);
      else ok.push(raw as TechniqueData);
    }
    return { ok, errors };
  };
  if (pack?.techniques.length) {
    const r = pick(pack.techniques);
    if (r.ok.length) return { techniques: r.ok, errors: r.errors, fromPack: true };
  }
  const r = pick(builtins);
  return { techniques: r.ok, errors: r.errors, fromPack: false };
};
