import type { TechniqueData } from '../types/technique';

/**
 * 런타임 데이터 검증 (의존성 없음).
 * JSON Schema 가 잡는 구조 오류 중 엔진을 깨뜨릴 수 있는 것 + 스키마로 표현할 수 없는 의미 규칙을 검사한다.
 * 신뢰할 수 없는 JSON 이 들어와도 예외 없이 문제 목록만 반환한다. 빈 배열 = 유효.
 */

const PHASE_TYPES = ['intro', 'progression', 'throw'] as const;
const ACTORS = new Set(['tori', 'uke', 'fx']);
const GRADES = new Set(['perfect', 'good', 'bad', 'miss']);
const UKEMI = ['perfect', 'good', 'bad'] as const;
const ID = /^[a-z0-9_]+$/;
const KEY = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMs = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isPosInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1;

type Tier = { early: number; late: number };
const readTier = (v: unknown): Tier | null => {
  if (isMs(v)) return { early: v, late: v };
  if (isObj(v) && isMs(v.early) && isMs(v.late)) return { early: v.early, late: v.late };
  return null;
};

export const validateTechnique = (input: unknown): string[] => {
  const issues: string[] = [];
  const err = (path: string, msg: string) => issues.push(`${path}: ${msg}`);

  if (!isObj(input)) return ['(root): 객체가 아님'];
  const t = input;

  if (t.schemaVersion !== 1) err('schemaVersion', `1 이어야 함 (받은 값: ${String(t.schemaVersion)})`);
  if (typeof t.id !== 'string' || !ID.test(t.id)) err('id', '`^[a-z0-9_]+$` 형식 문자열이어야 함');
  if (typeof t.name !== 'string' || !t.name) err('name', '비어 있지 않은 문자열이어야 함');
  if (!isPosInt(t.totalDurationMs)) err('totalDurationMs', '1 이상 정수여야 함');

  const cueList = (v: unknown, path: string, durationMs: number | null, minItems: number): Obj[] => {
    if (!Array.isArray(v)) {
      err(path, '배열이어야 함');
      return [];
    }
    if (v.length < minItems) err(path, `큐 ${minItems}개 이상 필요`);
    const ok: Obj[] = [];
    v.forEach((c, i) => {
      const p = `${path}[${i}]`;
      if (!isObj(c)) return err(p, '객체가 아님');
      if (!isMs(c.atMs)) err(`${p}.atMs`, '0 이상 정수여야 함');
      else if (durationMs !== null && c.atMs >= durationMs) err(`${p}.atMs`, `${c.atMs} ≥ durationMs(${durationMs})`);
      if (typeof c.actor !== 'string' || !ACTORS.has(c.actor)) err(`${p}.actor`, 'tori | uke | fx 중 하나');
      if (typeof c.key !== 'string' || !KEY.test(c.key)) err(`${p}.key`, `시퀀스 Key 형식 오류 (${String(c.key)})`);
      ok.push(c);
    });
    return ok;
  };

  // ── phases ──
  const phaseDurations: number[] = [];
  let repeatDefault: number | null = null;
  if (!Array.isArray(t.phases) || t.phases.length !== 3) {
    err('phases', '[intro, progression, throw] 3개 배열이어야 함');
  } else {
    t.phases.forEach((ph, i) => {
      const path = `phases[${i}]`;
      const expected = PHASE_TYPES[i];
      if (!isObj(ph)) return err(path, '객체가 아님');
      if (ph.type !== expected) err(`${path}.type`, `'${expected}' 이어야 함 (순서 고정)`);
      if (typeof ph.id !== 'string' || !ID.test(ph.id)) err(`${path}.id`, '`^[a-z0-9_]+$` 형식이어야 함');
      const label = `${path}(${String(ph.id)})`;

      const dur = isPosInt(ph.durationMs) ? ph.durationMs : null;
      if (dur === null) err(`${label}.durationMs`, '1 이상 정수여야 함');
      else phaseDurations.push(dur);
      const perfectMs = isMs(ph.perfectMs) ? ph.perfectMs : null;
      if (perfectMs === null) err(`${label}.perfectMs`, '0 이상 정수여야 함');

      if (ph.weight !== undefined && !(typeof ph.weight === 'number' && Number.isFinite(ph.weight) && ph.weight > 0))
        err(`${label}.weight`, '0 보다 큰 수여야 함');

      // 판정 윈도우
      const w = ph.window;
      if (!isObj(w)) {
        err(`${label}.window`, 'perfect/good/bad 객체가 필요');
      } else {
        const P = readTier(w.perfect);
        const G = readTier(w.good);
        const B = readTier(w.bad);
        if (!P) err(`${label}.window.perfect`, '0 이상 정수 또는 {early, late}');
        if (!G) err(`${label}.window.good`, '0 이상 정수 또는 {early, late}');
        if (!B) err(`${label}.window.bad`, '0 이상 정수 또는 {early, late}');
        if (P && G && B) {
          for (const side of ['early', 'late'] as const)
            if (!(P[side] <= G[side] && G[side] <= B[side]))
              err(`${label}.window`, `perfect ≤ good ≤ bad 위반 (${side}: ${P[side]} / ${G[side]} / ${B[side]})`);
          if (perfectMs !== null && dur !== null) {
            if (perfectMs - B.early < 0) err(`${label}.window.bad`, `구간 시작 ${perfectMs - B.early}ms 가 페이즈 시작(0) 이전`);
            if (perfectMs + B.late > dur) err(`${label}.window.bad`, `구간 끝 ${perfectMs + B.late}ms 가 페이즈 끝(${dur}) 이후`);
          }
        }
      }

      cueList(ph.animations, `${label}.animations`, dur, 1);

      if (ph.onJudge !== undefined) {
        if (!isObj(ph.onJudge)) err(`${label}.onJudge`, '객체가 아님');
        else
          for (const [g, r] of Object.entries(ph.onJudge)) {
            const p = `${label}.onJudge.${g}`;
            if (!GRADES.has(g)) err(p, '알 수 없는 등급 (perfect | good | bad | miss)');
            if (!isObj(r)) {
              err(p, '객체가 아님');
              continue;
            }
            if (r.replaceRemaining !== undefined && typeof r.replaceRemaining !== 'boolean') err(`${p}.replaceRemaining`, 'boolean');
            cueList(r.cues, `${p}.cues`, null, 1);
          }
      }

      if (expected === 'progression') {
        const r = ph.repeat;
        if (!isObj(r) || !isPosInt(r.min) || !isPosInt(r.max) || !isPosInt(r.default)) {
          err(`${label}.repeat`, '{min, max, default} 모두 1 이상 정수');
        } else if (!(r.min <= r.default && r.default <= r.max)) {
          err(`${label}.repeat`, `min ≤ default ≤ max 위반 (${r.min} / ${r.default} / ${r.max})`);
        } else {
          repeatDefault = r.default;
        }
      } else if (ph.repeat !== undefined) {
        err(`${label}.repeat`, '진행부에만 허용');
      }
    });

    // 총 시간 = 도입 + 진행 × default + 던지기
    if (phaseDurations.length === 3 && repeatDefault !== null && isPosInt(t.totalDurationMs)) {
      const [a, b, c] = phaseDurations as [number, number, number];
      const sum = a + b * repeatDefault + c;
      if (sum !== t.totalDurationMs)
        err('totalDurationMs', `${t.totalDurationMs} ≠ ${a} + ${b}×${repeatDefault} + ${c} = ${sum}`);
    }
  }

  // ── input ──
  if (t.input !== undefined) {
    if (!isObj(t.input)) err('input', '객체가 아님');
    else if (t.input.lockoutMs !== undefined && !isMs(t.input.lockoutMs)) err('input.lockoutMs', '0 이상 정수');
  }

  // ── scoring ──
  const pts = isObj(t.scoring) && isObj(t.scoring.points) ? t.scoring.points : null;
  if (!pts) {
    err('scoring.points', '{perfect, good, bad, miss} 필요');
  } else {
    const vals = (['perfect', 'good', 'bad', 'miss'] as const).map((g) => pts[g]);
    if (!vals.every(isMs)) err('scoring.points', '모든 값이 0 이상 정수여야 함');
    else {
      const [p, g, b, m] = vals as [number, number, number, number];
      if (p <= 0) err('scoring.points.perfect', '0 보다 커야 함');
      if (!(p >= g && g >= b && b >= m)) err('scoring.points', `perfect ≥ good ≥ bad ≥ miss 위반 (${p} / ${g} / ${b} / ${m})`);
    }
  }

  // ── ukemi ──
  if (!isObj(t.ukemi)) {
    err('ukemi', '객체가 필요');
  } else {
    const th = t.ukemi.thresholds;
    const inUnit = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;
    if (!isObj(th) || !inUnit(th.perfect) || !inUnit(th.good)) err('ukemi.thresholds', 'perfect/good 는 0~1 사이 수');
    else if (!((th.perfect as number) > (th.good as number))) err('ukemi.thresholds', `perfect(${th.perfect}) > good(${th.good}) 이어야 함`);

    const res = t.ukemi.results;
    if (!isObj(res)) err('ukemi.results', '객체가 필요');
    else
      for (const g of UKEMI) {
        const r = res[g];
        const p = `ukemi.results.${g}`;
        if (!isObj(r)) {
          err(p, '누락');
          continue;
        }
        const dur = isPosInt(r.durationMs) ? r.durationMs : null;
        if (dur === null) err(`${p}.durationMs`, '1 이상 정수');
        const cues = cueList(r.animations, `${p}.animations`, dur, 1);
        if (!cues.some((c) => c.actor === 'uke')) err(`${p}.animations`, 'uke 큐가 1개 이상 필요');
      }
  }

  // ── failure ──
  if (t.failure !== undefined) {
    const f = t.failure;
    if (!isObj(f)) err('failure', '객체가 아님');
    else {
      if (f.abortOnMiss !== undefined) {
        const ok = Array.isArray(f.abortOnMiss)
          && f.abortOnMiss.every((x) => (PHASE_TYPES as readonly unknown[]).includes(x))
          && new Set(f.abortOnMiss).size === f.abortOnMiss.length;
        if (!ok) err('failure.abortOnMiss', 'intro | progression | throw 의 중복 없는 배열');
      }
      if (f.maxConsecutiveMiss !== undefined && !isPosInt(f.maxConsecutiveMiss)) err('failure.maxConsecutiveMiss', '1 이상 정수');
      if (f.failOnNoInput !== undefined && typeof f.failOnNoInput !== 'boolean') err('failure.failOnNoInput', 'boolean');
    }
  }

  return issues;
};

/** 검증 통과 시 타입 좁히기 */
export const isValidTechnique = (input: unknown): input is TechniqueData => validateTechnique(input).length === 0;
