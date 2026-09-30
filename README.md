# aikido-game-prototype

JSON 에 시간(ms)과 애니메이션 시퀀스 Key 만 넣으면, 엔진 수정 없이 **도입부 → 진행부(1~N회) → 던지기 → 낙법** 으로 이어지는 아이키도 기술이 추가되는 원버튼 타이밍 게임 (Phaser 3).

현재 단계: **Task 4 — 타이틀·씬 전환·UI 통합, 단일 파일 실행**

## 실행

- **바로 플레이 (인터넷 O)**: `play/index.html` 을 받아 더블클릭 — Phaser·한글 웹폰트만 CDN
- **완전 오프라인**: `play/index.offline.html` — Phaser + 사용 글자만 담은 한글 폰트 서브셋까지 파일 하나에 포함
- 개발 서버: `npm install && npm run dev` → http://localhost:5173

씬 흐름: **Title**(Touch to Start · 모드 선택) → **Game**(READY → 라운드 반복) → Home 버튼으로 Title

| 입력 | 동작 |
|---|---|
| `Space` / 화면 터치·클릭 | 원버튼 입력 (타이틀에서는 시작). 상단 버튼 위 터치는 입력으로 치지 않음 |
| 상단 `Reset` / `R` | 현재 모드를 처음부터 |
| 상단 `Home` / `H` · `Esc` | 타이틀로 |
| 상단 `Speed` / `T` | 배속 0.5x → 1x → 1.5x (판정·애니메이션·거리 이동이 같은 시계를 따름) |
| `1` `2` `3` | 수련 · 게임 · 연습 모드 |
| `←` `→` / `↑` `↓` | (연습) 기술 선택 / 진행 횟수 N |

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
| `src/game/` | `TitleScene` · `GameScene` · 모드 룰 · 폰트 |
| `src/ui/` | `PixelButton` (Graphics + Text 픽셀 버튼) |
| `src/config/` | 640×360 Pixel-perfect 설정, 리미티드 애니메이션(10~12fps) 정책 |

## 픽셀 아트 파이프라인

`art/tori_idle.json` (64×64 문자 그리드 + 팔레트) → `npm run build:sprites` →
`src/art/sprites.generated.ts` (최적화 SVG Data URI: 플레이어 3.5KB · 적 4.1KB), `art/preview/*.png`, `play/sprite-demo.html`

- SVG: 색마다 `<path>` 1개, 픽셀 가로줄 = 1px stroke 선분, 칠 순서 탐색으로 선분 최소화, `shape-rendering="crispEdges"`. 빌드 시 SVG → 픽셀 역변환으로 원본과 1픽셀도 다르지 않은지 검사
- 로드: `preload()` 에서 `load.image('player_idle' | 'enemy_idle', dataURI)` (`<img>` 디코딩 → `file://` 에서도 동작)
- 사용: 대기·잔심 포즈(`animations.json` 의 `"image"`)는 이 스프라이트, 동작 포즈는 같은 팔레트의 절차적 플레이스홀더 (적은 붉은 링 포함)
- 선명도: 캐릭터 배율은 정수만 허용(`addCharacterSprite`), `pixelArt`·`roundPixels`, 창에 맞춘 정수 줌

## 설계 요점

- **Pixel-perfect**: 내부 640×360, `pixelArt`·`roundPixels`, `Scale.NONE` + 창 크기에 맞춘 **정수 배율 줌** (비정수 확대 번짐 없음)
- **60fps 로직 / 10~12fps 애니메이션**: 애니메이션은 Phaser anims 대신 가상시간으로 프레임을 직접 고른다. 보간 없는 이산 프레임 + `holds` 로 키포즈에서 묵직하게 멈춤
- **시작 Key 재생**: 엔진 `cue` 이벤트(`atMs`, `actor`, `key`) → `AnimationController.play(key, atMs)`. 매니페스트에 없는 Key 는 경고 후 마젠타 대체 시퀀스로 계속 진행
- **거리 좁히기**: 기술 JSON 의 `spacing` — 판정 순간(플레이어 입력 시각)에 목표 거리로 이동. Perfect 는 목표 그대로, Good/Bad 는 `slackPx` 만큼 덜 좁히고, Miss 는 이동 없음(수련 모드는 이동). 낙법 시작 시 우케가 날아가는 거리도 데이터로
- **히트스톱**: `GameClock.freeze()` 가 가상시간을 멈춤 → 엔진 판정·애니메이션·거리 이동이 함께 정지, 파티클·셰이크는 실시간. 입력 타임스탬프도 같은 시계로 변환하므로 판정 ms 가 어긋나지 않음
- **캐릭터**: 64×64 픽셀 아트 (은발 · 흰 도복 · 검은 하카마, 자연체). 토리 = 원본 색 + 짙은 외곽선, 우케 = 같은 스프라이트 + 바깥 2px `#FF0000` 적 하이라이트. 근접(52~56px) 상태에서 시작
- **아트 교체**: `animations.json` 에 `atlas: { texture, prefix }` 를 넣고 텍스처를 로드하면 플레이스홀더 대신 실제 스프라이트 사용

```bash
npm run validate      # 스키마 + 의미 규칙 + 시퀀스 Key 교차 검사 + N별 타임라인
npm run typecheck
npm run build:sprites # 픽셀 아트 → SVG Data URI + 미리보기 + play/sprite-demo.html
npm run build:single  # (sprites 포함) play/index.html + play/index.offline.html 재생성
npm run build         # vite 빌드 (dist/)
```
