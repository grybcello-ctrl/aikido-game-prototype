# aikido-game-prototype

JSON 에 시간(ms)과 애니메이션 시퀀스 Key 만 넣으면, 엔진 수정 없이 **도입부 → 진행부(1~N회) → 던지기 → 낙법** 으로 이어지는 아이키도 기술이 추가되는 원버튼 타이밍 게임 (Phaser 3).

현재 단계: **Task 1 — 데이터 스키마 확정** (엔진 코드 없음)

| 파일 | 내용 |
|---|---|
| `schema/technique.schema.json` | 기술 데이터 JSON Schema (draft 2020-12) |
| `src/types/technique.ts` | 데이터 인터페이스 + 런타임 계약 타입 |
| `data/techniques/shomenuchi_iriminage.json` | 샘플: 정면타 입신던지기 (N=3, 3500ms) |

## 데이터 규칙 요약

- 시간은 모두 ms 정수. 페이즈 안의 `perfectMs` / `atMs` 는 해당 페이즈(진행부는 해당 회차) 시작 기준
- `phases` = `[intro, progression, throw]` 고정. 진행부는 1회분만 정의하고 `repeat.{min,max,default}` 로 반복
- 판정: 오차 d = 입력 − 퍼펙트. |d| ≤ perfect → Perfect, ≤ good → Good, ≤ bad → Bad, 그 외/무입력 → Miss
- 애니메이션: `{ atMs, actor, key }` = 그 시각에 해당 시퀀스 시작. 판정별 추가 연출은 `onJudge`
- 낙법: 획득 점수 ÷ 만점 비율로 `ukemi.thresholds` 비교 → `results.{perfect,good,bad}`

스키마로 표현할 수 없는 제약(총 시간 합, perfect ≤ good ≤ bad, 구간이 페이즈 안에 들어갈 것 등)은 스키마 `$comment` 와 타입 JSDoc 에 명시되어 있으며, 엔진 단계에서 검증기로 구현한다.
