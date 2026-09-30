// 기술 데이터 검증: (1) JSON Schema (2) 엔진 의미 규칙 (3) 펼친 타임라인 미리보기
// 사용: npm run validate
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTimeline } from '../src/engine/timeline';
import { validateTechnique } from '../src/engine/validate';
import type { TechniqueData } from '../src/types/technique';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'schema/technique.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

let errors = 0;
const dir = join(root, 'data/techniques');
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  console.log(`\n▶ ${f}`);
  const data: unknown = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  if (!validateSchema(data)) {
    for (const e of validateSchema.errors ?? []) console.error(`  ✗ schema ${e.instancePath || '(root)'} ${e.message}`);
    errors += validateSchema.errors?.length ?? 1;
  }
  const issues = validateTechnique(data);
  for (const i of issues) console.error(`  ✗ ${i}`);
  errors += issues.length;
  if (issues.length) continue;

  const t = data as TechniqueData;
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
console.log(errors ? `\n✗ ${errors}개 오류` : '\n✓ 모든 기술 데이터 유효');
process.exit(errors ? 1 : 0);
