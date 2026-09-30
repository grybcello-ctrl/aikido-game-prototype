# aikido-game-prototype

JSON 에 시간(ms)과 애니메이션 시퀀스 Key 만 넣으면, 엔진 수정 없이 **도입부 → 진행부(1~N회) → 던지기 → 낙법** 으로 이어지는 아이키도 기술이 추가되는 원버튼 타이밍 게임 (Phaser 3).

현재 단계: **Task 2 — 타이밍 판정 코어** (렌더링 코드 없음, 프레임워크 비의존)

| 경로 | 내용 |
|---|---|
| `schema/technique.schema.json` | 기술 데이터 JSON Schema (draft 2020-12) |
| `src/types/technique.ts` | 데이터 인터페이스 + 펼친 타임라인 타입 |
| `data/techniques/shomenuchi_iriminage.json` | 샘플: 정면타 입신던지기 (N=3, 3500ms) |
| `src/engine/TimingEngine.ts` | 타이밍 판정 상태 머신 |
| `src/engine/{judge,timeline,scoring,validate}.ts` | 순수 함수: 판정 · 타임라인 펼치기 · 점수/낙법 결정 · 데이터 검증 |
| `src/input/oneButton.ts` | 스페이스바 + 터치/마우스 → `onPress(timeStamp)` (DOM 이벤트만 사용) |
| `scripts/validate.ts` | 스키마 + 의미 규칙 검증, N별 타임라인 미리보기 |

```bash
npm install
npm run validate    # 데이터 검증
npm run typecheck
```

## 데이터 규칙 요약

- 시간은 모두 ms 정수. 페이즈 안의 `perfectMs` / `atMs` 는 해당 페이즈(진행부는 해당 회차) 시작 기준
- `phases` = `[intro, progression, throw]` 고정. 진행부는 1회분만 정의하고 `repeat.{min,max,default}` 로 반복
- 판정: 오차 d = 입력 − 퍼펙트. |d| ≤ perfect → Perfect, ≤ good → Good, ≤ bad → Bad (경계 포함). bad 구간이 끝날 때까지 입력 없음 → Miss
- 애니메이션: `{ atMs, actor, key }` = 그 시각에 해당 시퀀스 시작. 판정별 추가 연출은 `onJudge`
- 점수: `points[등급] × weight` 누적. 낙법: 획득 ÷ 만점 비율로 `ukemi.thresholds` 비교 → `results.{perfect,good,bad}`
- 실패(`failure`, 선택): `abortOnMiss`(해당 페이즈 Miss 즉시 실패) · `maxConsecutiveMiss` · `failOnNoInput`(전부 Miss)

## TimingEngine 사용

```ts
import data from './data/techniques/shomenuchi_iriminage.json';
import { TimingEngine, bindOneButton, type TechniqueData } from './src';

const engine = new TimingEngine(data as TechniqueData);      // 데이터 오류 → TechniqueDataError(issues)
engine.on((e) => {
  // e.type: start | phaseEnter | windowOpen | judge | cue | cueCancelled | inputIgnored
  //         | paused | resumed | fail | ukemi | finish
});
const unbind = bindOneButton(window, (t) => engine.press(t));
engine.start(performance.now());                              // start(now, N?) — N 은 repeat.min~max
// 매 프레임: engine.update(performance.now());
// 결과:      engine.getResult() → { outcome: 'success', ukemi, score } | { outcome: 'failed', reason, score }
```

- 입력은 이벤트 타임스탬프로 큐에 쌓이고 `update()` 에서 시간순 처리 → 판정 정밀도가 프레임 간격과 무관
- 구간 밖 입력은 `input.lockoutMs` 동안 잠금 (연타 방지). 같은 비트 재입력은 `already_judged` 로 무시
- 던지기 페이즈가 끝나는 순간 최종 점수 비율로 낙법 결정 → `ukemi` 이벤트 + 낙법 큐 → `finish`
- 실패 시 이후 판정·기본 큐는 취소되고, 실패를 일으킨 판정의 `onJudge` 반응 큐만 재생 후 `finish`
- `pause()` / `resume()` 동안 엔진 시간 정지 · 입력 무시, `abort()` = 강제 실패
