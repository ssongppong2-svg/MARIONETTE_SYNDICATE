/** 작은 DOM 도우미 */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function $(root: ParentNode, sel: string): HTMLElement {
  const e = root.querySelector(sel);
  if (!e) throw new Error(`없는 요소: ${sel}`);
  return e as HTMLElement;
}

export function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const roman = (n: number) => ROMAN[n] ?? String(n);

/** 화면 가장자리를 넘지 않게 띄우는 요소의 위치를 잡는다 */
export function placeNear(node: HTMLElement, x: number, y: number, gap = 14) {
  const r = node.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = x + gap, top = y - r.height / 2;
  if (left + r.width > vw - 8) left = x - gap - r.width;
  left = clamp(left, 8, vw - r.width - 8);
  top = clamp(top, 8, vh - r.height - 8);
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

let toastHost: HTMLElement | null = null;
export function toast(message: string, tone: 'info' | 'err' | 'gold' = 'info', ms = 2600) {
  if (!toastHost) {
    toastHost = el('div', 'toast-stack');
    document.body.appendChild(toastHost);
  }
  const t = el('div', `toast frame ${tone === 'info' ? '' : tone}`);
  t.textContent = message;
  toastHost.appendChild(t);
  while (toastHost.children.length > 3) toastHost.firstElementChild?.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
}

/** 모달. 닫힐 때 resolve. */
export function modal(inner: string, opts: { wide?: boolean; dismissable?: boolean; onMount?: (root: HTMLElement, close: () => void) => void } = {}): Promise<void> {
  return new Promise((resolve) => {
    const back = el('div', 'modal-back');
    const box = el('div', `modal frame ${opts.wide ? 'wide' : ''}`, inner);
    back.appendChild(box);
    document.body.appendChild(back);
    const close = () => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && opts.dismissable !== false) { e.stopPropagation(); close(); }
    };
    document.addEventListener('keydown', onKey, true);
    if (opts.dismissable !== false) back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
    box.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', close));
    opts.onMount?.(box, close);
    (box.querySelector('[autofocus]') as HTMLElement | null)?.focus();
  });
}

export function confirmBox(title: string, body: string, yes: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    void modal(`
      <h2>${esc(title)}</h2>
      <p class="lead">${esc(body)}</p>
      <div class="row">
        <button class="btn" data-close>그만두기</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-yes autofocus>${esc(yes)}</button>
      </div>`, {
      onMount: (root, close) => {
        root.querySelector('[data-yes]')!.addEventListener('click', () => { answer = true; close(); });
      },
    }).then(() => resolve(answer));
  });
}
