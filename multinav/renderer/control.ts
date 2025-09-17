// src/renderer/control.ts

declare global {
  interface Window {
    controlAPI: {
      // original APIs
      navigateAll(url: string): Promise<void>;
      navigateOne(i: number, url: string): Promise<void>;
      reloadAll(): Promise<void>;
      setViewCount(n: number): Promise<void>;
      setMirrorSource(i: number): Promise<void>;
      setMirrorEnabled(on: boolean): Promise<void>;
      sendText(t: string): Promise<void>;
      sendKey(k: string): Promise<void>;
      // additive input-mode APIs (optional until wired in preload/main)
      setInputMode?: (mode: "control" | "mirror" | "none") => Promise<void>;
      setLeader?: (idx: number | null) => Promise<void>;
      setSprayAll?: (on: boolean) => Promise<void>;
      prompt?: (text: string) => Promise<void>;
    };
  }
}

type El<T extends HTMLElement = HTMLElement> = T | null;
const $  = <T extends HTMLElement = HTMLElement>(q: string, r: ParentNode = document) => r.querySelector(q) as T | null;
const $$ = <T extends HTMLElement = HTMLElement>(q: string, r: ParentNode = document) => Array.from(r.querySelectorAll(q)) as T[];

function on(root: Document | HTMLElement, ev: string, sel: string, fn: (e: Event) => void) {
  root.addEventListener(ev, (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const m = t.closest(sel);
    if (m) fn(e);
  });
}

function boot() {
  // Lazily resolve elements at boot time (after DOM exists)
  const allUrl    = $('#all-url') as El<HTMLInputElement>;
  const goAll     = $('#go-all') as El<HTMLButtonElement>;
  const reloadAll = $('#reload-all') as El<HTMLButtonElement>;

  const typebox   = $('#typebox') as El<HTMLTextAreaElement>;
  const kbtns     = $$('.kbtn') as HTMLButtonElement[];

  const mirrorSource = $('#mirror-source') as El<HTMLSelectElement>;
  const toggleMirror = $('#toggle-mirror') as El<HTMLButtonElement>;

  const btn3 = $('#three') as El<HTMLButtonElement>;
  const btn4 = $('#four') as El<HTMLButtonElement>;

  // New mode controls (optional if not present)
  const modeToggle = $('#modeToggle') as El<HTMLInputElement>;
  const sprayAll   = $('#sprayAll') as El<HTMLInputElement>;
  const leaderSel  = $('#leaderSelect') as El<HTMLSelectElement>;

  // Guardrails: log once if critical controls are missing
  if (!allUrl || !goAll || !reloadAll || !typebox) {
    console.warn('[multinav/control] Missing critical controls in DOM — check index.html IDs');
  }

  // --- Navigation: all ---
  goAll?.addEventListener('click', async () => {
    const url = allUrl?.value?.trim();
    if (!url) return;
    await window.controlAPI.navigateAll(url);
  });

  reloadAll?.addEventListener('click', async () => {
    await window.controlAPI.reloadAll();
  });

  // --- Navigation: one ---
  on(document, 'click', '.go-one', async (e) => {
    const btn = e.target as HTMLElement;
    const idx = Number(btn.getAttribute('data-i') || '0');
    const input = document.querySelector<HTMLInputElement>(`.one-url[data-i="${idx}"]`);
    const val = input?.value?.trim();
    if (val) await window.controlAPI.navigateOne(idx, val);
  });

  // --- Broadcast typing ---
  typebox?.addEventListener('input', async () => {
    const t = typebox.value;
    if (!t) return;
    try { await window.controlAPI.prompt?.(t); } catch {}
    await window.controlAPI.sendText(t);
    typebox.value = '';
  });

  // --- Special keys ---
  kbtns.forEach((b) => {
    b.addEventListener('click', async () => {
      const key = b.getAttribute('data-k')!;
      await window.controlAPI.sendKey(key);
    });
  });

  // --- Mirroring controls (original behavior) ---
  mirrorSource?.addEventListener('change', async () => {
    const idx = parseInt(mirrorSource.value, 10);
    await window.controlAPI.setMirrorSource(idx);
  });

  toggleMirror?.addEventListener('click', async () => {
    const on = toggleMirror.getAttribute('data-on') === '1';
    const next = !on;
    await window.controlAPI.setMirrorEnabled(next);
    toggleMirror.setAttribute('data-on', next ? '1' : '0');
    toggleMirror.textContent = next ? 'Disable Mirror' : 'Enable Mirror';
  });

  // --- Layout controls ---
  btn3?.addEventListener('click', async () => { await window.controlAPI.setViewCount(3); });
  btn4?.addEventListener('click', async () => { await window.controlAPI.setViewCount(4); });

  // --- Input Mode wiring (no-op if preload/main hasn’t exposed them yet) ---
  async function applyModeUI() {
    if (!modeToggle || !sprayAll || !leaderSel) return;
    const api = window.controlAPI;
    if (!api.setInputMode || !api.setLeader || !api.setSprayAll) return;

    if (modeToggle.checked) {
      await api.setInputMode('control');
      await api.setLeader(null);
    } else {
      const v = leaderSel.value;
      if (!v) {
        await api.setInputMode('none');
        await api.setLeader(null);
      } else {
        await api.setInputMode('mirror');
        await api.setLeader(parseInt(v, 10));
      }
    }
    await api.setSprayAll(!!sprayAll.checked);
  }

  modeToggle?.addEventListener('change', () => { void applyModeUI(); });
  sprayAll  ?.addEventListener('change', () => { void window.controlAPI.setSprayAll?.(!!sprayAll!.checked); });
  leaderSel ?.addEventListener('change', () => { void applyModeUI(); });

  // Initialize defaults
  if (modeToggle) modeToggle.checked = true;
  void applyModeUI();

  console.log('[multinav/control] UI bound.');
}

// Robust boot: in case the module executes early in <head>, wait for DOM.
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
