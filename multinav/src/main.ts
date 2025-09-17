// src/main.ts
import { app, BrowserWindow, BrowserView, ipcMain, Rectangle } from 'electron';
import path from 'node:path';
import url from 'node:url';
import fetch from 'node-fetch'; // for optional logging to local ingestor

let mainWin: BrowserWindow | null = null;
const views: BrowserView[] = [];
let controlView: BrowserView | null = null;
let mirrorEnabled = false;
let mirrorSourceIndex = 0; // 0..3
const CONTROL_WIDTH = 380;
let viewCount = 4; // 3 or 4 panes
const wcToIndex = new Map<number, number>();
const outlineCssKeys: (string | null)[] = [null, null, null, null];
let sharedZoom = 1.0;

// -------- ADDITIVE: Input modes --------
type InputMode = 'control' | 'mirror' | 'none';
let inputMode: InputMode = 'control';
let leaderPane: number | null = null;     // for mirror mode or targeted control spray
let sprayAll: boolean = true;             // in control mode, send to all panes by default
function setInputMode(mode: InputMode) {
  inputMode = mode;
  if (mode !== 'mirror') leaderPane = null;
}
function setLeader(idx: number | null) {
  leaderPane = idx;
  if (inputMode !== 'mirror' && idx !== null) inputMode = 'mirror';
}
function targetPaneIndices(): number[] {
  const all = views.map((_, i) => i);
  return sprayAll ? all : (leaderPane !== null ? [leaderPane] : []);
}

// -------- ADDITIVE: Logging state (optional) --------
const INGEST_URL = 'http://127.0.0.1:8787/log';
let lastPromptText: string | null = null;
let lastPromptTs: string | null = null;
let activeSessionId: string = new Date().toISOString().replace(/\..+/, '') + '-multinav';
function nowIso() { return new Date().toISOString(); }

// Launch-time defaults so panes are visible immediately
const INITIAL_URLS = [
  'https://example.com',
  'https://example.org',
  'https://example.net',
  'https://www.wikipedia.org'
];

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1680,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: '#111318',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Control panel on the left
  controlView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload_control.js'),
      sandbox: true,
      contextIsolation: true
    }
  });
  mainWin.addBrowserView(controlView);

  // Load control UI from Vite dev server ONLY if explicitly set; otherwise from built file
  const devServer = process.env.VITE_DEV_SERVER_URL; // e.g. "http://localhost:5173"
  const controlURL = app.isPackaged
    ? url.pathToFileURL(path.join(process.resourcesPath, 'renderer', 'index.html')).toString()
    : (devServer ?? url.pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).toString());

  controlView.webContents.loadURL(controlURL);

  // Ensure the main window itself is not trying to load a non-existent dist/index.html
  mainWin.loadURL('about:blank');

  // Debug traps to surface real load targets if anything fails
  mainWin.webContents.on('did-fail-load', (_e, code, desc, tried) => {
    console.error('mainWin FAIL:', code, desc, tried);
  });
  controlView.webContents.on('did-fail-load', (_e, code, desc, tried) => {
    console.error('controlView FAIL:', code, desc, tried);
  });

  // Right panes
  for (let i = 0; i < 4; i++) {
    const v = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, 'preload_view.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        worldSafeExecuteJavaScript: true,
        backgroundThrottling: false
      }
    });
    views.push(v);
    mainWin.addBrowserView(v);
  }

  layout();

  // Load initial content and paint non-black background
  views.forEach((v, i) => {
    v.webContents.loadURL(INITIAL_URLS[i] || 'about:blank').catch(() => {});
    v.webContents.insertCSS('html,body{background:#1b1d23 !important;min-height:100vh;}').catch(() => {});
    v.webContents.setZoomFactor(sharedZoom);
    wireBeforeInputFor(v);
  });
  if (controlView) wireBeforeInputFor(controlView);

  if (process.env.DEBUG === '1') {
    controlView.webContents.openDevTools({ mode: 'detach' });
    views[0].webContents.openDevTools({ mode: 'detach' });
  }

  mainWin.on('resize', layout);
  mainWin.on('closed', () => { mainWin = null; });

  wireIPC();
  applySourceOutline(mirrorSourceIndex);
}

function workArea(win: BrowserWindow): Rectangle {
  const b = win.getBounds();
  return { x: 0, y: 0, width: b.width, height: b.height };
}

function layout() {
  if (!mainWin || !controlView) return;
  const { width, height } = workArea(mainWin);

  // control on left
  controlView.setBounds({ x: 0, y: 0, width: CONTROL_WIDTH, height });

  // right grid
  const gx = CONTROL_WIDTH;
  const gw = Math.max(0, width - CONTROL_WIDTH);
  const gh = height;

  if (viewCount === 4) {
    const cw = Math.floor(gw / 2);
    const ch = Math.floor(gh / 2);
    setViewBounds(0, { x: gx,        y: 0,  width: cw,      height: ch });
    setViewBounds(1, { x: gx + cw,   y: 0,  width: gw - cw, height: ch });
    setViewBounds(2, { x: gx,        y: ch, width: cw,      height: gh - ch });
    setViewBounds(3, { x: gx + cw,   y: ch, width: gw - cw, height: gh - ch });
  } else {
    const ch = Math.floor(gh / 3);
    setViewBounds(0, { x: gx, y: 0,      width: gw, height: ch });
    setViewBounds(1, { x: gx, y: ch,     width: gw, height: ch });
    setViewBounds(2, { x: gx, y: ch * 2, width: gw, height: gh - ch * 2 });
    setViewBounds(3, { x: gx + gw, y: 0, width: 1, height: 1 }); // hide #4
  }

  mainWin!.setTopBrowserView(controlView);
}

function setViewBounds(index: number, r: Rectangle) {
  const v = views[index];
  if (!v) return;
  (v as any).__bounds = r;
  v.setBounds(r);
}

function boundsOf(index: number): Rectangle {
  return (views[index] as any).__bounds;
}

/* ---------------- Keyboard shortcuts (all require modifiers) ------------
   - Ctrl+Shift+M  : toggle mirror
   - Ctrl+Alt+1..4 : set source pane
   - Ctrl+Shift+R  : reload all
   - Ctrl+L        : focus control URL
   - Ctrl+ + / - / 0 : zoom sync
------------------------------------------------------------------------- */
function wireBeforeInputFor(view: BrowserView) {
  view.webContents.on('before-input-event', (event, input) => {
    const ctrl = !!input.control;
    const shift = !!input.shift;
    const alt = !!input.alt;
    const key = input.key;   // 'M', '1', '+', '-','0','R','L' etc.
    const code = input.code; // 'Digit1','Numpad1','Minus','Equal', etc.

    // Reload all: Ctrl+Shift+R
    if (ctrl && shift && !alt && (key === 'R' || key === 'r')) {
      event.preventDefault();
      reloadAll();
      return;
    }

    // Focus control URL: Ctrl+L
    if (ctrl && !shift && !alt && (key === 'L' || key === 'l')) {
      event.preventDefault();
      focusControlURL();
      return;
    }

    // Mirror toggle: Ctrl+Shift+M
    if (ctrl && shift && !alt && (key === 'M' || key === 'm')) {
      event.preventDefault();
      setMirrorEnabled(!mirrorEnabled);
      return;
    }

    // Source pane: Ctrl+Alt+1..4 (support both Digit and Numpad)
    if (ctrl && !shift && alt) {
      if (code === 'Digit1' || code === 'Numpad1' || key === '1') { event.preventDefault(); setMirrorSource(0); return; }
      if (code === 'Digit2' || code === 'Numpad2' || key === '2') { event.preventDefault(); setMirrorSource(1); return; }
      if (code === 'Digit3' || code === 'Numpad3' || key === '3') { event.preventDefault(); setMirrorSource(2); return; }
      if (code === 'Digit4' || code === 'Numpad4' || key === '4') { event.preventDefault(); setMirrorSource(3); return; }
    }

    // Zoom controls: Ctrl +, Ctrl -, Ctrl 0
    if (ctrl && !alt) {
      if (code === 'Equal' || key === '+') { event.preventDefault(); setZoom(sharedZoom + 0.1); return; }
      if (code === 'Minus' || key === '-') { event.preventDefault(); setZoom(sharedZoom - 0.1); return; }
      if (code === 'Digit0' || key === '0') { event.preventDefault(); setZoom(1.0); return; }
    }
  });
}

/* ---------------- Zoom + scroll sync ---------------- */
function setZoom(factor: number) {
  sharedZoom = Math.min(3.0, Math.max(0.25, Number(factor.toFixed(2))));
  for (const v of views) v.webContents.setZoomFactor(sharedZoom);
}

function reloadAll() {
  for (const v of views) v.webContents.reload();
}

function focusControlURL() {
  if (!controlView) return;
  mainWin!.setTopBrowserView(controlView);
  controlView.webContents.focus();
  controlView.webContents.send('control:focusURL');
}

/* ---------------- Source highlighting ---------------- */
async function applySourceOutline(sourceIdx: number) {
  const color = '#2a60e8';
  // remove old outlines
  for (let i = 0; i < views.length; i++) {
    const key = outlineCssKeys[i];
    if (key) {
      try { await views[i].webContents.removeInsertedCSS(key); } catch {}
      outlineCssKeys[i] = null;
    }
  }
  // add to the source
  const css = `
    html { outline: 3px solid ${color} !important; outline-offset: -3px !important; }
    body::after {
      content: "SOURCE";
      position: fixed; top: 8px; right: 8px;
      background: ${color}; color: white; font: 600 10px/1 ui-sans-serif, system-ui;
      padding: 3px 6px; border-radius: 6px; z-index: 2147483647; opacity: 0.9;
      pointer-events: none;
    }
  `;
  try {
    const key = await views[sourceIdx].webContents.insertCSS(css);
    outlineCssKeys[sourceIdx] = key;
  } catch {}
}

/* ---------------- IPC wiring -------------------------- */
function wireIPC() {
  ipcMain.on('view:hello', (e) => {
    const idx = views.findIndex(v => v.webContents.id === e.sender.id);
    if (idx >= 0) wcToIndex.set(e.sender.id, idx);
  });

  // ADDITIVE: control:prompt (for logging/latency grouping)
  ipcMain.handle('control:prompt', (_e, text: string) => {
    lastPromptText = text || '';
    lastPromptTs = nowIso();
    activeSessionId = new Date().toISOString().replace(/\..+/, '') + '-multinav';
  });

  // ADDITIVE: input-mode controls
  ipcMain.handle('control:setInputMode', (_e, mode: InputMode) => setInputMode(mode));
  ipcMain.handle('control:setLeader', (_e, idx: number | null) => setLeader(idx));
  ipcMain.handle('control:setSprayAll', (_e, on: boolean) => { sprayAll = !!on; });

  ipcMain.handle('control:navigateAll', async (_e, urlStr: string) => {
    for (const v of views) await v.webContents.loadURL(urlStr);
  });

  ipcMain.handle('control:navigateOne', async (_e, i: number, urlStr: string) => {
    const v = views[i];
    if (v) await v.webContents.loadURL(urlStr);
  });

  ipcMain.handle('control:reloadAll', async () => reloadAll());

  ipcMain.handle('control:setViewCount', (_e, count: number) => {
    viewCount = count === 3 ? 3 : 4;
    layout();
  });

  ipcMain.handle('control:setMirrorSource', (_e, index: number) => setMirrorSource(index));

  ipcMain.handle('control:setMirrorEnabled', (_e, enabled: boolean) => setMirrorEnabled(enabled));

  // MODIFIED: route control:sendText by inputMode (was spraying to all panes unconditionally)
  ipcMain.handle('control:sendText', (_e, text: string) => {
    if (!text) return;
    if (inputMode === 'control') {
      const targets = targetPaneIndices();
      for (const idx of targets) {
        const v = views[idx];
        if (!v) continue;
        for (const ch of Array.from(text)) v.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      }
    } else if (inputMode === 'mirror' && leaderPane !== null) {
      const v = views[leaderPane];
      if (v) for (const ch of Array.from(text)) v.webContents.sendInputEvent({ type: 'char', keyCode: ch });
    } else {
      // none → do nothing
    }
  });

  ipcMain.handle('control:sendKey', (_e, key: string) => {
    const down = { type: 'keyDown' as const, keyCode: key };
    const up   = { type: 'keyUp'   as const, keyCode: key };
    for (const v of views) {
      v.webContents.sendInputEvent(down);
      v.webContents.sendInputEvent(up);
    }
  });

  // Mirror events coming from any view
  ipcMain.on('view:inputEvent', (e, ev: any) => {
    // In control mode, ignore pane->pane mirroring entirely
    if (inputMode === 'control') return;

    if (!mirrorEnabled) return;
    const fromIndex = wcToIndex.get(e.sender.id);
    if (fromIndex === undefined || fromIndex !== mirrorSourceIndex) return;

    if (ev && typeof ev.x === 'number' && typeof ev.y === 'number') {
      const src = boundsOf(fromIndex);
      for (let i = 0; i < views.length; i++) {
        if (i === fromIndex) continue;
        const tgt = boundsOf(i);
        const scaleX = tgt.width / src.width;
        const scaleY = tgt.height / src.height;
        const mapped = { ...ev };
        mapped.x = Math.max(0, Math.min(tgt.width  - 1, Math.round(ev.x * scaleX)));
        mapped.y = Math.max(0, Math.min(tgt.height - 1, Math.round(ev.y * scaleY)));
        views[i].webContents.sendInputEvent(mapped);
      }
      return;
    }

    for (let i = 0; i < views.length; i++) {
      if (i === fromIndex) continue;
      views[i].webContents.sendInputEvent(ev);
    }
  });

  // ADDITIVE: receive assistant content from panes and log it
  ipcMain.on('view:content', async (e, payload: {
    provider: string;
    model?: string;
    text: string;
    tokensOut?: number | null;
    latencyMs?: number | null;
    detectedAt?: string | null;
  }) => {
    const idx = wcToIndex.get(e.sender.id);
    if (idx === undefined) return;

    const event = {
      session_id: activeSessionId,
      ts: payload.detectedAt || nowIso(),
      user_input: { text: lastPromptText || '', tags: ['multinav'] },
      task_context: { topic: 'ad-hoc', intent: 'compare' },
      client: { surface: 'multinav-app', pane_id: `pane-${idx}`, browser: 'electron', os: process.platform, device: 'desktop' },
      model: { provider: payload.provider, name: payload.model || 'unknown', mode: 'chat' },
      response: { text: payload.text, raw_tokens: payload.tokensOut ?? null, latency_ms: payload.latencyMs ?? null, finish_reason: 'stop' },
      observations: { contains_code: /```|class |function |=>|\{.*\}/s.test(payload.text), has_citations: /\[\d+\]|\u3010|\u3011/.test(payload.text), ui_broke: false },
      costing: {}
    };

    try {
      const r = await fetch(INGEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      });
      if (!r.ok) console.error('ingest failed', r.status);
    } catch (err) {
      console.error('ingest error', err);
    }
  });
}

/* ---------------- helpers for state ------------------- */
function setMirrorSource(index: number) {
  mirrorSourceIndex = Math.max(0, Math.min(3, index));
  applySourceOutline(mirrorSourceIndex);
}

function setMirrorEnabled(enabled: boolean) {
  mirrorEnabled = !!enabled;
}

app.whenReady().then(createMainWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
