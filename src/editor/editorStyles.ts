/**
 * 개발자 모드 DOM 스타일. <style id="dev-editor-style"> 로 한 번만 주입.
 *
 * 클릭 충돌 방지 구조:
 *   - #dev-editor 는 화면 전체 grid 이지만 pointer-events: none. 실제 패널만 pointer-events: auto
 *   - Phaser 캔버스(#game)는 가운데 칸(.dev-stage-slot)과 정확히 같은 사각형으로 옮겨짐 → 패널과 겹치지 않음
 *   - 가운데 칸 자체는 비어 있고 pointer-events: none → 그 위의 클릭은 캔버스로 곧장 전달
 */
export const EDITOR_CSS = `
:root {
  --dev-top: 46px;
  --dev-left: 248px;
  --dev-right: clamp(420px, 36vw, 600px);
  --dev-log: 184px;
  --dev-bg: #101018;
  --dev-panel: #161622;
  --dev-card: #1c1c2a;
  --dev-line: #2e2e44;
  --dev-text: #e6e6f0;
  --dev-dim: #9a9ab0;
  --dev-accent: #7da8ff;
  --dev-perfect: #7df9ff;
  --dev-good: #9be564;
  --dev-bad: #ffb347;
  --dev-miss: #ff5a5f;
}
@media (max-width: 1100px) {
  :root { --dev-left: 200px; --dev-right: 380px; --dev-log: 160px; }
}
body.dev-mode { user-select: auto; -webkit-user-select: auto; touch-action: auto; }
body.dev-mode #game {
  position: fixed;
  left: var(--dev-left);
  right: var(--dev-right);
  top: var(--dev-top);
  bottom: var(--dev-log);
  width: auto;
  height: auto;
  background: #07070b;
}
#dev-editor {
  position: fixed; inset: 0; z-index: 10;
  display: grid;
  grid-template-columns: var(--dev-left) 1fr var(--dev-right);
  grid-template-rows: var(--dev-top) 1fr var(--dev-log);
  grid-template-areas: "top top top" "list stage form" "list log form";
  pointer-events: none;
  font: 13px/1.45 "Nanum Gothic Coding", D2Coding, "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif;
  color: var(--dev-text);
}
#dev-editor * { box-sizing: border-box; }
#dev-editor .dev-top, #dev-editor .dev-list, #dev-editor .dev-form, #dev-editor .dev-log, #dev-editor .dev-modal-wrap { pointer-events: auto; }
#dev-editor .dev-stage-slot { grid-area: stage; pointer-events: none; outline: 1px solid var(--dev-line); outline-offset: -1px; }

/* 상단 바 */
.dev-top { grid-area: top; display: flex; align-items: center; gap: 8px; padding: 0 10px; background: #0b0b12; border-bottom: 1px solid var(--dev-line); }
.dev-top h1 { font-size: 14px; margin: 0 10px 0 0; letter-spacing: .5px; white-space: nowrap; }
.dev-top h1 b { color: var(--dev-accent); }
.dev-top .dev-spacer { flex: 1; }
.dev-save { color: var(--dev-dim); font-size: 12px; white-space: nowrap; }
.dev-save.err { color: var(--dev-miss); }

/* 버튼 · 입력 */
#dev-editor button {
  font: inherit; color: var(--dev-text); background: #24243a; border: 1px solid #44446a; border-radius: 3px;
  padding: 4px 10px; cursor: pointer; white-space: nowrap;
}
#dev-editor button:hover { background: #2e2e4c; }
#dev-editor button:active { transform: translateY(1px); }
#dev-editor button:disabled { opacity: .45; cursor: default; transform: none; }
#dev-editor button.primary { background: #24406e; border-color: var(--dev-accent); font-weight: 700; }
#dev-editor button.test { background: #1f5a3a; border-color: #5ad08a; font-weight: 700; }
#dev-editor button.danger { background: #4a1f28; border-color: #a0404e; }
#dev-editor button.small { padding: 1px 7px; font-size: 12px; }
#dev-editor button.link { background: none; border: none; color: var(--dev-accent); padding: 0 2px; text-decoration: underline; }
#dev-editor input, #dev-editor select, #dev-editor textarea {
  font: inherit; color: var(--dev-text); background: #0e0e18; border: 1px solid #3a3a56; border-radius: 3px; padding: 3px 6px; min-width: 0;
}
#dev-editor input:focus, #dev-editor select:focus, #dev-editor textarea:focus { outline: 1px solid var(--dev-accent); border-color: var(--dev-accent); }
#dev-editor input[type=number] { width: 78px; text-align: right; }
#dev-editor input.bad { border-color: var(--dev-miss); background: #2a0f14; }
#dev-editor label.f { display: grid; grid-template-columns: 118px 1fr; align-items: center; gap: 6px; margin: 4px 0; }
#dev-editor label.f > span { color: var(--dev-dim); }
#dev-editor .hint { color: var(--dev-dim); font-size: 12px; }
#dev-editor .warn { color: var(--dev-bad); font-size: 12px; }
#dev-editor .err { color: var(--dev-miss); }
#dev-editor .ok { color: var(--dev-good); }

/* 좌측 목록 */
.dev-list { grid-area: list; background: var(--dev-panel); border-right: 1px solid var(--dev-line); display: flex; flex-direction: column; min-height: 0; }
.dev-list header { padding: 10px; border-bottom: 1px solid var(--dev-line); display: grid; gap: 8px; }
.dev-list header h2 { margin: 0; font-size: 13px; color: var(--dev-dim); font-weight: 400; }
.dev-list ul { list-style: none; margin: 0; padding: 6px; overflow: auto; flex: 1; }
.dev-list li { padding: 7px 8px; border: 1px solid transparent; border-radius: 3px; cursor: pointer; margin-bottom: 4px; background: var(--dev-card); }
.dev-list li:hover { border-color: #44446a; }
.dev-list li.sel { border-color: var(--dev-accent); background: #1d2744; }
.dev-list li .n { font-weight: 700; display: flex; gap: 6px; align-items: center; }
.dev-list li .n i { font-style: normal; font-size: 11px; }
.dev-list li .m { color: var(--dev-dim); font-size: 11px; margin-top: 2px; word-break: break-all; }
.dev-list footer { padding: 8px 10px; border-top: 1px solid var(--dev-line); display: grid; gap: 6px; }

/* 우측 폼 */
.dev-form { grid-area: form; background: var(--dev-panel); border-left: 1px solid var(--dev-line); overflow: auto; min-height: 0; }
.dev-form .dev-form-head { position: sticky; top: 0; z-index: 2; background: #12121c; border-bottom: 1px solid var(--dev-line); padding: 8px 12px; display: flex; gap: 6px; align-items: center; }
.dev-form .dev-form-head .t { flex: 1; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dev-form .dev-body { padding: 10px 12px 40px; }
.dev-empty { padding: 30px 16px; color: var(--dev-dim); text-align: center; }
.dev-sec { background: var(--dev-card); border: 1px solid var(--dev-line); border-radius: 4px; margin: 0 0 12px; }
.dev-sec > h3 { margin: 0; padding: 7px 10px; font-size: 13px; border-bottom: 1px solid var(--dev-line); display: flex; align-items: center; gap: 8px; }
.dev-sec > h3 .tag { font-size: 11px; font-weight: 400; color: #0b0b12; background: var(--dev-accent); border-radius: 2px; padding: 0 5px; }
.dev-sec > h3 .tag.p2 { background: var(--dev-good); }
.dev-sec > h3 .tag.p3 { background: var(--dev-bad); }
.dev-sec > h3 .tag.uk { background: var(--dev-perfect); }
.dev-sec > .in { padding: 8px 10px; }
.dev-row { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
.dev-row label { display: inline-flex; gap: 6px; align-items: center; color: var(--dev-dim); }
.dev-step { border: 1px dashed #3a3a56; border-radius: 4px; padding: 8px; margin: 8px 0; background: #181826; }
.dev-step .h { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-weight: 700; }
.dev-step .h .sp { flex: 1; }

/* 판정 윈도우 표 */
table.dev-win { border-collapse: collapse; margin: 6px 0 4px; }
table.dev-win th, table.dev-win td { padding: 2px 6px; text-align: center; }
table.dev-win th { color: var(--dev-dim); font-weight: 400; font-size: 12px; }
table.dev-win td.g { text-align: left; font-weight: 700; font-size: 12px; }
table.dev-win td.g.perfect { color: var(--dev-perfect); } table.dev-win td.g.good { color: var(--dev-good); } table.dev-win td.g.bad { color: var(--dev-bad); }
table.dev-win td.r { color: var(--dev-dim); font-size: 11px; text-align: left; min-width: 96px; }
table.dev-win input[type=number] { width: 62px; }

/* 타이밍 막대 (0 ~ durationMs) */
.dev-bar { position: relative; height: 16px; background: #0b0b12; border: 1px solid #33334c; border-radius: 2px; margin: 6px 0 2px; overflow: hidden; }
.dev-bar > div { position: absolute; top: 0; bottom: 0; }
.dev-bar .bad { background: rgba(255,179,71,.35); } .dev-bar .good { background: rgba(155,229,100,.5); } .dev-bar .perfect { background: rgba(125,249,255,.85); }
.dev-bar .mark { width: 2px; background: #fff; }
.dev-bar .over { background: repeating-linear-gradient(45deg, rgba(255,90,95,.8) 0 4px, transparent 4px 8px); }
.dev-bar-axis { display: flex; justify-content: space-between; color: var(--dev-dim); font-size: 10px; }

/* 이미지 슬롯 */
.dev-slots { display: grid; gap: 6px; margin-top: 6px; }
.dev-slot { display: grid; grid-template-columns: 52px 38px 1fr auto; gap: 6px; align-items: center; }
.dev-slot > .a { color: var(--dev-dim); font-size: 12px; }
.dev-thumb { width: 38px; height: 38px; background: #0b0b12 repeating-conic-gradient(#15151f 0 25%, #0b0b12 0 50%) 0 0 / 8px 8px; border: 1px solid #33334c; image-rendering: pixelated; object-fit: contain; display: block; }
.dev-thumb.flip { transform: scaleX(-1); }
.dev-slot .st { grid-column: 3 / 5; font-size: 11px; color: var(--dev-dim); margin-top: -3px; }
.dev-slot .st.warn { color: var(--dev-bad); }
.dev-slot input[type=text] { width: 100%; }

/* 검증 */
.dev-issues { margin: 0; padding-left: 18px; font-size: 12px; }
.dev-issues li { color: var(--dev-miss); margin: 2px 0; word-break: break-all; }
.dev-issues li.w { color: var(--dev-bad); }
.dev-status { font-size: 12px; padding: 1px 6px; border-radius: 2px; }
.dev-status.ok { background: #183a24; color: var(--dev-good); }
.dev-status.ng { background: #3a1820; color: var(--dev-miss); }

/* 테스트 로그 */
.dev-log { grid-area: log; background: #0b0b12; border-top: 1px solid var(--dev-line); display: flex; flex-direction: column; min-height: 0; }
.dev-log .bar { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--dev-line); flex-wrap: wrap; }
.dev-log .bar .sp { flex: 1; }
.dev-log ol { list-style: none; margin: 0; padding: 4px 10px; overflow: auto; flex: 1; font-size: 12px; font-family: D2Coding, "Nanum Gothic Coding", monospace; }
.dev-log li.perfect { color: var(--dev-perfect); } .dev-log li.good { color: var(--dev-good); } .dev-log li.bad { color: var(--dev-bad); } .dev-log li.miss, .dev-log li.fail { color: var(--dev-miss); }
.dev-log li.sys { color: var(--dev-dim); } .dev-log li.ukemi { color: #ffd166; font-weight: 700; }
.dev-running { color: #5ad08a; font-weight: 700; }

/* 모달 (Export / Import) */
.dev-modal-wrap { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 20; }
.dev-modal { width: min(820px, 92vw); max-height: 88vh; display: flex; flex-direction: column; background: var(--dev-panel); border: 1px solid var(--dev-accent); border-radius: 4px; }
.dev-modal h3 { margin: 0; padding: 10px 12px; border-bottom: 1px solid var(--dev-line); font-size: 14px; }
.dev-modal .in { padding: 10px 12px; display: grid; gap: 8px; min-height: 0; overflow: auto; }
.dev-modal textarea { width: 100%; height: 46vh; font-family: D2Coding, monospace; font-size: 12px; white-space: pre; }
.dev-modal .act { display: flex; gap: 8px; justify-content: flex-end; padding: 10px 12px; border-top: 1px solid var(--dev-line); flex-wrap: wrap; }
`;
