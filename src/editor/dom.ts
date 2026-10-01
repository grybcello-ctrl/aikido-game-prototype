/** 아주 작은 DOM 빌더 (의존성 없음) */

type Child = Node | string | number | null | undefined | false;
export type Attrs = {
  class?: string;
  style?: string;
  title?: string;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
  [attr: string]: unknown;
};

/**
 * h('button', { class: 'primary', on: { click } }, '저장')
 * - value / checked / disabled 는 속성(property)으로, 나머지는 attribute 로 설정
 * - false / null / undefined 인 속성·자식은 건너뜀
 */
export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Child[]): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'on') {
      for (const [ev, fn] of Object.entries(v as Record<string, (e: Event) => void>)) el.addEventListener(ev, fn);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'textContent') {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  return el;
};

/** 파일 → Data URI */
export const readDataUri = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('파일을 읽을 수 없음'));
    r.readAsDataURL(file);
  });

/** Data URI → 로드된 <img> (크기 확인용) */
export const loadImage = (uri: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 해석할 수 없음 (PNG / SVG 인지 확인)'));
    img.src = uri;
  });

/** 클립보드 복사: Clipboard API → 실패 시 textarea + execCommand (file:// 등 비보안 컨텍스트) */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 폴백으로 */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
};

/** 텍스트 파일 다운로드 */
export const downloadText = (name: string, text: string, type = 'application/json'): void => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
