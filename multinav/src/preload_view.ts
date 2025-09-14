import { contextBridge, ipcRenderer } from 'electron';

// The index of this BrowserView is assigned from main via userAgent trick or URL param.
// We’ll parse "?idx=N" if present; else default 0. Main maps bounds, so coords will be scaled there.
let viewIndex = 0;
try {
  const u = new URL(location.href);
  const idx = u.searchParams.get('idx');
  if (idx) viewIndex = parseInt(idx, 10) || 0;
} catch {}

function forward(ev: any) {
  ipcRenderer.send('view:inputEvent', { fromIndex: viewIndex, ev });
}

function install() {
  // Mouse events
  window.addEventListener('mousemove', (e) => {
    forward({ type: 'mouseMove', x: e.clientX, y: e.clientY, movementX: e.movementX, movementY: e.movementY });
  }, { capture: true, passive: true });

  window.addEventListener('mousedown', (e) => {
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    forward({ type: 'mouseDown', x: e.clientX, y: e.clientY, button });
  }, { capture: true });

  window.addEventListener('mouseup', (e) => {
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    forward({ type: 'mouseUp', x: e.clientX, y: e.clientY, button });
  }, { capture: true });

  window.addEventListener('wheel', (e) => {
    forward({ type: 'mouseWheel', x: e.clientX, y: e.clientY, deltaX: e.deltaX, deltaY: e.deltaY, canScroll: true });
  }, { capture: true, passive: true });

  // Keyboard
  window.addEventListener('keydown', (e) => {
    // Let the page get the event too; we just mirror
    forward({ type: 'keyDown', keyCode: e.key });
  }, { capture: true });

  window.addEventListener('keypress', (e) => {
    if (e.key.length === 1) {
      forward({ type: 'char', keyCode: e.key });
    }
  }, { capture: true });

  window.addEventListener('keyup', (e) => {
    forward({ type: 'keyUp', keyCode: e.key });
  }, { capture: true });
}

try { install(); } catch {}
contextBridge.exposeInMainWorld('viewIndex', viewIndex);
