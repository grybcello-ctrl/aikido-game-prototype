# aikido-game-prototype

JSON 에 시간(ms)과 애니메이션 시퀀스 Key 만 넣으면, 엔진 수정 없이 **도입부 → 진행부(1~N회) → 던지기 → 낙법** 으로 이어지는 아이키도 기술이 추가되는 원버튼 타이밍 게임 (Phaser 3).

현재 단계: **Task 3 — GameScene · 3가지 모드 · 애니메이션 컨트롤러**

## 실행

- 바로 플레이: `play/index.html` 을 받아 브라우저로 열기 (인터넷 필요: Phaser·폰트 CDN)
- 개발 서버: `npm install && npm run dev` → http://localhost:5173

| 키 | 동작 |
|---|---|
| `Space` / 터치 / 클릭 | 원버튼 입력 (타이틀에서는 시작) |
| `1` `2` `3` | 수련 · 게임 · 연습 모드 |
| `←` `→` / `↑` `↓` / `T` | (연습) 기술 선택 / 진행 횟수 N / 배속 1·0.5·0.25 |

## 모드

| 모드 | 규칙 |
|---|---|
| 수련 (Flow) | 히트스톱·셰이크 없음, 거리 이동을 60fps 사인 보간으로 느긋하게. 실패 규칙 해제(Miss 여도 흐름 유지), 기술을 순서대로 이어서 반복, 타이밍 링 표시 |
| 게임 (Arcade) | SF3 블로킹 스타일: Perfect 순간 화면 정지(110ms, 던지기 150ms) + 카메라 셰이크 + 스파크 파티클 + 흰색 플래시. 기술·N 랜덤, 데이터의 실패 규칙, 목숨 3 |
| 연습 (Practice) | 선택한 기술만 반복, N·배속 조절, 타이밍 링 표시 |

모드 룰은 `src/game/modes.ts` 의 `MODES` 에서 수치로 조정한다.

## 구조

| 경로 | 내용 |
|---|---|
| `data/techniques/*.json` | 기술 데이터 (타이밍·판정·시퀀스 Key·거리·낙법) — 샘플 2종 |
| `data/animations.json` | 시퀀스 Key → 프레임 수 · frameRate(10~12) · holds(키포즈 정지) · 아틀라스/플레이스홀더 포즈 |
| `schema/*.schema.json` | 위 두 데이터의 JSON Schema |
| `src/engine/` | `TimingEngine` 등 판정 코어 (Phaser 비의존) |
| `src/render/` | `GameClock`(배속·히트스톱) · `AnimRegistry` · `AnimationController` · `FxLayer` · `Spacing`(거리) · 플레이스홀더 픽셀 아트 |
| `src/game/` | `GameScene` · 모드 룰 · 폰트 |
| `src/config/` | 640×360 Pixel-perfect 설정, 리미티드 애니메이션(10~12fps) 정책 |

## 설계 요점

- **Pixel-perfect**: 내부 640×360, `pixelArt`·`roundPixels`, `Scale.NONE` + 창 크기에 맞춘 **정수 배율 줌** (비정수 확대 번짐 없음)
- **60fps 로직 / 10~12fps 애니메이션**: 애니메이션은 Phaser anims 대신 가상시간으로 프레임을 직접 고른다. 보간 없는 이산 프레임 + `holds` 로 키포즈에서 묵직하게 멈춤
- **시작 Key 재생**: 엔진 `cue` 이벤트(`atMs`, `actor`, `key`) → `AnimationController.play(key, atMs)`. 매니페스트에 없는 Key 는 경고 후 마젠타 대체 시퀀스로 계속 진행
- **거리 좁히기**: 기술 JSON 의 `spacing` — 판정 순간(플레이어 입력 시각)에 목표 거리로 이동. Perfect 는 목표 그대로, Good/Bad 는 `slackPx` 만큼 덜 좁히고, Miss 는 이동 없음(수련 모드는 이동). 낙법 시작 시 우케가 날아가는 거리도 데이터로
- **히트스톱**: `GameClock.freeze()` 가 가상시간을 멈춤 → 엔진 판정·애니메이션·거리 이동이 함께 정지, 파티클·셰이크는 실시간. 입력 타임스탬프도 같은 시계로 변환하므로 판정 ms 가 어긋나지 않음
- **아트 교체**: `animations.json` 에 `atlas: { texture, prefix }` 를 넣고 텍스처를 로드하면 플레이스홀더 대신 실제 스프라이트 사용

```bash
npm run validate      # 스키마 + 의미 규칙 + 시퀀스 Key 교차 검사 + N별 타임라인
npm run typecheck
npm run build:single  # play/index.html 재생성
npm run build         # vite 빌드 (dist/)
```
