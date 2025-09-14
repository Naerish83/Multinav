import { app, BrowserWindow, BrowserView, ipcMain, Rectangle } from 'electron';
import path from 'node:path';
import url from 'node:url';

let mainWin: BrowserWindow | null = null;
const views: BrowserView[] = [];
let controlView: BrowserView | null = null;
let mirrorEnabled = false;
let mirrorSourceIndex = 0; // which view is the source

// Layout constants
const CONTROL_WIDTH = 380;
let viewCount = 4; // 3 or 4 panes on the right

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

  // Control panel as a BrowserView (left)
  controlView = new BrowserView({
    webPreferences: {
      preload: path.join(process.cwd(), 'src', 'preload_control.ts'),
      sandbox: true,
      contextIsolation: true
    }
  });
  mainWin.addBrowserView(controlView);

  // Load control UI (dev or prod)
  const dev = process.env.VITE_DEV_SERVER_URL;
  const controlURL = dev ? `${dev}` : url.pathToFileURL(path.join(process.cwd(), 'dist', 'renderer', 'index.html')).toString();
  controlView.webContents.loadURL(controlURL);

  // Create 4 BrowserViews for the sites
  for (let i = 0; i < 4; i++) {
    const v = new BrowserView({
      webPreferences: {
        preload: path.join(process.cwd(), 'src', 'preload_view.ts'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // important so we can inject input across sites
        worldSafeExecuteJavaScript: true
      }
    });
    views.push(v);
    mainWin.addBrowserView(v);
    // Neutral URL
    v.webContents.loadURL('about:blank');
  }

  layout();

  mainWin.on('resize', layout);
  mainWin.on('close', () => {
    mainWin = null;
  });

  wireIPC();
}

function workArea(win: BrowserWindow): Rectangle {
  const b = win.getBounds();
  return { x: 0, y: 0, width: b.width, height: b.height };
}

function layout() {
  if (!mainWin || !controlView) return;
  const { x, y, width, height } = workArea(mainWin);

  // Control panel on the left
  mainWin.setBrowserViewBounds(controlView, { x: 0, y: 0, width: CONTROL_WIDTH, height });

  // Right area grid
  const gx = x + CONTROL_WIDTH;
  const gw = Math.max(0, width - CONTROL_WIDTH);
  const gh = height;

  // Grid layout: either 2x2 (4 views) or 1x3 vertical for 3 views
  if (viewCount === 4) {
    const cw = Math.floor(gw / 2);
    const ch = Math.floor(gh / 2);
    setViewBounds(0, { x: gx,        y: 0,  width: cw, height: ch });
    setViewBounds(1, { x: gx + cw,   y: 0,  width: gw - cw, height: ch });
    setViewBounds(2, { x: gx,        y: ch, width: cw, height: gh - ch });
    setViewBounds(3, { x: gx + cw,   y: ch, width: gw - cw, height: gh - ch });
  } else {
    // 3-up tall stack
    const ch = Math.floor(gh / 3);
    setViewBounds(0, { x: gx, y: 0,       width: gw, height: ch });
    setViewBounds(1, { x: gx, y: ch,      width: gw, height: ch });
    setViewBounds(2, { x: gx, y: ch * 2,  width: gw, height: gh - ch * 2 });
    // hide the 4th
    setViewBounds(3, { x: gx + gw, y: 0, width: 1, height: 1 });
  }
}

function setViewBounds(index: number, r: Rectangle) {
  const v = views[index];
  if (!mainWin || !v) return;
  mainWin.setBrowserViewBounds(v, r);
  v['__bounds'] = r;
}

function boundsOf(index: number): Rectangle {
  return (views[index] as any)['__bounds'];
}

function inRightPaneBounds(globalX: number, globalY: number): boolean {
  if (!mainWin) return false;
  const { width } = workArea(mainWin);
  return globalX >= CONTROL_WIDTH && globalX <= width;
}

function wireIPC() {
  // Navigate all panes
  ipcMain.handle('control:navigateAll', async (_e, urlStr: string) => {
    for (const v of views) {
      await v.webContents.loadURL(urlStr);
    }
  });

  // Navigate a single pane
  ipcMain.handle('control:navigateOne', async (_e, i: number, urlStr: string) => {
    const v = views[i];
    if (v) await v.webContents.loadURL(urlStr);
  });

  // Reload all
  ipcMain.handle('control:reloadAll', async () => {
    for (const v of views) v.webContents.reload();
  });

  // Set count (3 or 4)
  ipcMain.handle('control:setViewCount', (_e, count: number) => {
    viewCount = count === 3 ? 3 : 4;
    layout();
  });

  // Choose mirror source
  ipcMain.handle('control:setMirrorSource', (_e, index: number) => {
    mirrorSourceIndex = Math.max(0, Math.min(3, index));
  });

  ipcMain.handle('control:setMirrorEnabled', (_e, enabled: boolean) => {
    mirrorEnabled = enabled;
  });

  // Broadcast typed text to all panes as keystrokes
  ipcMain.handle('control:sendText', (_e, text: string) => {
    for (const v of views) {
      for (const ch of Array.from(text)) {
        v.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      }
    }
  });

  // Broadcast simple special keys
  ipcMain.handle('control:sendKey', (_e, key: string) => {
    const evtDown = { type: 'keyDown' as const, keyCode: key };
    const evtUp   = { type: 'keyUp' as const, keyCode: key };
    for (const v of views) {
      v.webContents.sendInputEvent(evtDown);
      v.webContents.sendInputEvent(evtUp);
    }
  });

  // Mirror input from a view
  ipcMain.on('view:inputEvent', (_e, payload: { fromIndex: number; ev: any }) => {
    if (!mirrorEnabled) return;
    const { fromIndex, ev } = payload;
    if (fromIndex !== mirrorSourceIndex) return;

    // Translate coordinates from source view to target view
    if (ev && 'x' in ev && 'y' in ev) {
      const srcBounds = boundsOf(fromIndex);
      const localX = ev.x;
      const localY = ev.y;

      for (let i = 0; i < views.length; i++) {
        if (i === fromIndex) continue;
        const targetBounds = boundsOf(i);
        const scaleX = targetBounds.width / srcBounds.width;
        const scaleY = targetBounds.height / srcBounds.height;

        const mappedX = Math.max(0, Math.min(targetBounds.width - 1, Math.round(localX * scaleX)));
        const mappedY = Math.max(0, Math.min(targetBounds.height - 1, Math.round(localY * scaleY)));

        const evCopy = { ...ev };
        evCopy.x = mappedX;
        evCopy.y = mappedY;
        views[i].webContents.sendInputEvent(evCopy);
      }
      return;
    }

    // Non-positional event (e.g., char)
    for (let i = 0; i < views.length; i++) {
      if (i === fromIndex) continue;
      views[i].webContents.sendInputEvent(ev);
    }
  });

  // Determine which view the user clicked to set focus
  mainWin!.on('focus', () => {});
}

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  // On Windows and Linux, quit when all windows are closed.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
