// 데이터 검증: (1) JSON Schema (2) 엔진 의미 규칙 (3) 애니메이션 매니페스트 교차 검사 (4) 펼친 타임라인 미리보기
// 사용: npm run validate
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTimeline } from '../src/engine/timeline';
import { validateTechnique } from '../src/engine/validate';
import { CHARACTER_TEXTURES } from '../src/art/characterSprites';
import type { AnimationManifest } from '../src/types/animations';
import type { TechniqueData } from '../src/types/technique';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(root, p), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(readJson('schema/technique.schema.json') as object);
const validateManifest = ajv.compile(readJson('schema/animations.schema.json') as object);

let errors = 0;
const fail = (msg: string) => {
  errors++;
  console.error(`  ✗ ${msg}`);
};

// ── 애니메이션 매니페스트 ──
console.log('\n▶ data/animations.json');
const manifest = readJson('data/animations.json') as AnimationManifest;
if (!validateManifest(manifest)) for (const e of validateManifest.errors ?? []) fail(`schema ${e.instancePath || '(root)'} ${e.message}`);
const seqKeys = new Set(Object.keys(manifest.sequences ?? {}));
// "image" 는 코드로 로드하는 픽셀 아트 텍스처 키여야 함 (src/art/characterSprites.ts)
const imageKeys = new Set<string>(Object.values(CHARACTER_TEXTURES));
for (const [k, def] of Object.entries(manifest.sequences ?? {})) {
  if (def.image && !imageKeys.has(def.image)) fail(`${k}.image '${def.image}' 는 로드되지 않는 텍스처 (가능: ${[...imageKeys].join(', ')})`);
  if (def.image && !k.startsWith('fx.') && def.image === CHARACTER_TEXTURES.enemy && !k.startsWith('uke.')) fail(`${k}: 적 텍스처는 uke.* 시퀀스에만`);
  if (def.image && def.image === CHARACTER_TEXTURES.player && !k.startsWith('tori.')) fail(`${k}: 플레이어 텍스처는 tori.* 시퀀스에만`);
}
const usedKeys = new Set<string>(['tori.kamae', 'uke.kamae']); // 씬 대기 포즈
console.log(`  시퀀스 ${seqKeys.size}개`);

// ── 기술 데이터 ──
const dir = join(root, 'data/techniques');
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  console.log(`\n▶ ${f}`);
  const data = readJson(`data/techniques/${f}`);
  if (!validateSchema(data)) for (const e of validateSchema.errors ?? []) fail(`schema ${e.instancePath || '(root)'} ${e.message}`);
  const issues = validateTechnique(data);
  issues.forEach(fail);
  if (issues.length) continue;

  const t = data as TechniqueData;
  if (`${t.id}.json` !== f) console.warn(`  ⚠ 파일명(${f}) 과 id(${t.id}) 불일치`);

  // 시퀀스 Key 가 매니페스트에 있는지, actor 접두사와 일치하는지
  const cues = [
    ...t.phases.flatMap((p) => [...p.animations, ...Object.values(p.onJudge ?? {}).flatMap((r) => r?.cues ?? [])]),
    ...Object.values(t.ukemi.results).flatMap((r) => r.animations),
  ];
  for (const c of cues) {
    usedKeys.add(c.key);
    if (!seqKeys.has(c.key)) fail(`시퀀스 Key '${c.key}' 가 animations.json 에 없음`);
    if (!c.key.startsWith(`${c.actor}.`)) fail(`'${c.key}' 는 actor '${c.actor}' 큐인데 접두사가 다름`);
  }

  const { min, max } = t.phases[1].repeat;
  for (const n of [...new Set([min, t.phases[1].repeat.default, max])]) {
    const tl = resolveTimeline(t, n);
    const perfectMax = tl.beats.reduce((s, b) => s + t.scoring.points.perfect * b.weight, 0);
    console.log(`  N=${n}: ${tl.totalDurationMs}ms, 판정 ${tl.beats.length}회, 만점 ${perfectMax}`
      + ` (낙법 Perfect ≥ ${Math.ceil(perfectMax * t.ukemi.thresholds.perfect)}, Good ≥ ${Math.ceil(perfectMax * t.ukemi.thresholds.good)})`);
    if (n === t.phases[1].repeat.default)
      console.table(tl.beats.map((b) => ({
        beat: `${b.phaseId}${b.phaseType === 'progression' ? `#${b.iteration + 1}` : ''}`,
        start: b.startMs, perfectAt: b.perfectAtMs,
        perfect: b.window.perfect.join('~'), good: b.window.good.join('~'), bad: b.window.bad.join('~'), weight: b.weight,
      })));
  }
}

const unused = [...seqKeys].filter((k) => !usedKeys.has(k));
if (unused.length) console.warn(`\n⚠ 사용되지 않는 시퀀스: ${unused.join(', ')}`);
console.log(errors ? `\n✗ ${errors}개 오류` : '\n✓ 모든 데이터 유효');
process.exit(errors ? 1 : 0);
