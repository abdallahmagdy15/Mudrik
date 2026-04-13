import { BrowserWindow, screen, ipcMain } from "electron";
import * as path from "path";

const log = (msg: string) => console.log(`[AREA-SELECTOR] ${msg}`);

let overlayWindow: BrowserWindow | null = null;
let pendingCallback: ((rect: { x1: number; y1: number; x2: number; y2: number }) => void) | null = null;

ipcMain.on("area-selection-complete", (_e, x1: number, y1: number, x2: number, y2: number) => {
  log(`Area selected: (${x1},${y1}) to (${x2},${y2})`);
  closeOverlay();
  if (pendingCallback) {
    pendingCallback({ x1, y1, x2, y2 });
    pendingCallback = null;
  }
});

ipcMain.on("area-selection-cancel", () => {
  log("Area selection cancelled");
  closeOverlay();
  pendingCallback = null;
});

function closeOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }
  overlayWindow = null;
}

export function startAreaSelection(onComplete: (rect: { x1: number; y1: number; x2: number; y2: number }) => void): void {
  log("Starting area selection overlay");

  if (overlayWindow) {
    closeOverlay();
  }

  pendingCallback = onComplete;

  const display = screen.getPrimaryDisplay();
  const { width, height } = display.bounds;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x: display.bounds.x,
    y: display.bounds.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "area-preload.js"),
    },
  });

  overlayWindow.setVisibleOnAllWorkspaces(true);

  overlayWindow.webContents.on("console-message", (_e, _level, msg) => {
    log(`Overlay: ${msg}`);
  });

  const html = `data:text/html;charset=utf-8,${encodeURIComponent(getAreaHTML())}`;
  overlayWindow.loadURL(html);

  overlayWindow.once("ready-to-show", () => {
    overlayWindow!.show();
    overlayWindow!.focus();
    log("Area selection overlay shown");
  });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

function getAreaHTML(): string {
  return `<!DOCTYPE html>
<html>
<head>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; cursor: crosshair; user-select: none; }
#selection {
  position: absolute;
  border: 2px solid rgba(137, 180, 250, 0.9);
  background: rgba(137, 180, 250, 0.06);
  display: none;
  pointer-events: none;
  box-shadow: 0 0 8px rgba(137, 180, 250, 0.3), inset 0 0 8px rgba(137, 180, 250, 0.1);
}
#hint {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: rgba(205, 214, 244, 0.7);
  font: 16px "Segoe UI", sans-serif;
  pointer-events: none;
  text-shadow: 0 1px 6px rgba(0,0,0,0.9);
  letter-spacing: 1px;
}
</style>
</head>
<body>
<div id="selection"></div>
<div id="hint">Click and drag to select area &middot; Esc to cancel</div>
<script>
const sel = document.getElementById('selection');
const hint = document.getElementById('hint');
let startX = 0, startY = 0, dragging = false;

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  startX = e.screenX;
  startY = e.screenY;
  dragging = true;
  hint.style.display = 'none';
  sel.style.display = 'block';
});

document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const sx = Math.min(startX, e.screenX) - window.screenX;
  const sy = Math.min(startY, e.screenY) - window.screenY;
  const sw = Math.abs(e.screenX - startX);
  const sh = Math.abs(e.screenY - startY);
  sel.style.left = sx + 'px';
  sel.style.top = sy + 'px';
  sel.style.width = sw + 'px';
  sel.style.height = sh + 'px';
});

document.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  dragging = false;
  sel.style.display = 'none';

  const x1 = Math.min(startX, e.screenX);
  const y1 = Math.min(startY, e.screenY);
  const x2 = Math.max(startX, e.screenX);
  const y2 = Math.max(startY, e.screenY);

  if (Math.abs(x2 - x1) < 10 || Math.abs(y2 - y1) < 10) {
    window.areaSelection.cancel();
    return;
  }
  window.areaSelection.complete(x1, y1, x2, y2);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.areaSelection.cancel();
  }
});
</script>
</body>
</html>`;
}