/**
 * 원버튼 입력 어댑터 (프레임워크 비의존: DOM 이벤트만 사용).
 * 스페이스바(키 리피트 제외) + 터치/마우스(Pointer Events 로 통합, 주 포인터·왼쪽 버튼만)를
 * 하나의 onPress(atMs) 로 모은다. atMs 는 이벤트 발생 시각(event.timeStamp)이라 프레임 지연과 무관하다.
 *
 * 사용: const unbind = bindOneButton(window, (t) => engine.press(t));
 */

export interface OneButtonOptions {
  /** 입력으로 인정할 KeyboardEvent.code. 기본 ['Space'] */
  codes?: readonly string[];
  /** 터치·마우스 입력 사용. 기본 true */
  pointer?: boolean;
  /** 스페이스바 스크롤·터치 기본 동작 차단. 기본 true */
  preventDefault?: boolean;
  /** 이벤트 시각 → 엔진 시계 변환 (배속/일시정지 시계 등). 기본 그대로 */
  toEngineTime?: (eventTimeStamp: number) => number;
}

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export const bindOneButton = (target: Target, onPress: (atMs: number) => void, opts: OneButtonOptions = {}): (() => void) => {
  const codes = new Set(opts.codes ?? ['Space']);
  const prevent = opts.preventDefault ?? true;
  const map = opts.toEngineTime ?? ((t: number) => t);

  const onKey = (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (!codes.has(e.code)) return;
    if (prevent) e.preventDefault();
    if (e.repeat) return; // 누르고 있기 = 1회 입력
    onPress(map(e.timeStamp));
  };
  const onPointer = (ev: Event) => {
    const e = ev as PointerEvent;
    if (e.isPrimary === false || e.button !== 0) return; // 멀티터치 보조 포인터·우클릭 제외
    if (prevent && e.cancelable) e.preventDefault();
    onPress(map(e.timeStamp));
  };

  target.addEventListener('keydown', onKey);
  if (opts.pointer ?? true) target.addEventListener('pointerdown', onPointer, { passive: !prevent });
  return () => {
    target.removeEventListener('keydown', onKey);
    target.removeEventListener('pointerdown', onPointer);
  };
};
