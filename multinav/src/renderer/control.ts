declare global {
  interface Window {
    controlAPI: {
      navigateAll(url: string): Promise<void>;
      navigateOne(i: number, url: string): Promise<void>;
      reloadAll(): Promise<void>;
      setViewCount(n: number): Promise<void>;
      setMirrorSource(i: number): Promise<void>;
      setMirrorEnabled(on: boolean): Promise<void>;
      sendText(t: string): Promise<void>;
      sendKey(k: string): Promise<void>;
    };
  }
}

const $ = (q: string) => document.querySelector(q) as HTMLElement;

function on(el: Element | Document, ev: string, selOrCb: string | ((e: Event) => void), cb?: (e: Event) => void) {
  if (typeof selOrCb === 'function') {
    el.addEventListener(ev, selOrCb as any);
    return;
  }
  el.addEventListener(ev, (e) => {
    const t = e.target as Element;
    if (t && (t.matches(selOrCb as string) || t.closest(selOrCb as string))) cb!(e);
  });
}

const allUrl = $('#all-url') as HTMLInputElement;
const goAll = $('#go-all') as HTMLButtonElement;
const reload = $('#reload') as HTMLButtonElement;
const typebox = $('#typebox') as HTMLTextAreaElement;
const toggleMirror = $('#toggle-mirror') as HTMLButtonElement;
const sourceSelect = $('#source-pane') as HTMLSelectElement;
const btn3 = $('#three') as HTMLButtonElement;
const btn4 = $('#four') as HTMLButtonElement;

goAll.addEventListener('click', async () => {
  if (!allUrl.value) return;
  await window.controlAPI.navigateAll(allUrl.value);
});

reload.addEventListener('click', async () => {
  await window.controlAPI.reloadAll();
});

on(document, 'click', '.go-one', async (e) => {
  const btn = e.target as HTMLElement;
  const idx = Number(btn.getAttribute('data-i') || '0');
  const input = document.querySelector<HTMLInputElement>(`.one-url[data-i="${idx}"]`)!;
  if (input && input.value) {
    await window.controlAPI.navigateOne(idx, input.value);
  }
});

// Send message on Enter (Ctrl+Enter for newline)
typebox.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
    const t = typebox.value.trim();
    if (!t) return;
    await window.controlAPI.sendText(t);
    typebox.value = '';
  }
});

on(document, 'click', '.kbtn', async (e) => {
  const btn = e.target as HTMLElement;
  const key = btn.getAttribute('data-k')!;
  await window.controlAPI.sendKey(key);
});

sourceSelect.addEventListener('change', async () => {
  const i = Number(sourceSelect.value);
  await window.controlAPI.setMirrorSource(i);
});

toggleMirror.addEventListener('click', async () => {
  const on = toggleMirror.getAttribute('data-on') === '1';
  const next = !on;
  await window.controlAPI.setMirrorEnabled(next);
  toggleMirror.setAttribute('data-on', next ? '1' : '0');
  toggleMirror.textContent = next ? 'Disable Mirror' : 'Enable Mirror';
});

btn3.addEventListener('click', async () => {
  await window.controlAPI.setViewCount(3);
});
btn4.addEventListener('click', async () => {
  await window.controlAPI.setViewCount(4);
});
