import { BrowserWindow, screen, ipcMain } from "electron";
import * as path from "path";
import * as koffi from "koffi";
import * as robotjs from "robotjs";
import { t, Lang } from "../shared/i18n";
import { loadConfig } from "./config-store";

const log = (msg: string) => console.log(`[AREA-SELECTOR] ${msg}`);

const user32 = koffi.load("user32.dll");
const GetAsyncKeyState = user32.func("short __stdcall GetAsyncKeyState(int vKey)");
const VK_LBUTTON = 0x01;
const MOUSE_DOWN_MASK = 0x8000;

function isLeftMouseDown(): boolean {
  return (GetAsyncKeyState(VK_LBUTTON) & MOUSE_DOWN_MASK) !== 0;
}

let overlayWindow: BrowserWindow | null = null;
let pendingCallback: ((rect: { x1: number; y1: number; x2: number; y2: number }) => void) | null = null;
let polling: ReturnType<typeof setInterval> | null = null;
let dragStart: { x: number; y: number } | null = null;
let lastEnd: { x: number; y: number } | null = null;

ipcMain.on("area-selection-ready", () => {
  log("Overlay ready, waiting for first click");
  startPolling();
});

ipcMain.on("area-selection-cancel", () => {
  log("Area selection cancelled");
  closeOverlay();
  pendingCallback = null;
});

let selecting = false;

function closeOverlay() {
  stopPolling();
  selecting = false;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }
  overlayWindow = null;
}

function toDip(physX: number, physY: number): { x: number; y: number } {
  const pt = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(pt);
  const factor = display.scaleFactor;
  const bounds = display.bounds;
  return {
    x: (physX - bounds.x) / factor + bounds.x,
    y: (physY - bounds.y) / factor + bounds.y,
  };
}

function startPolling() {
  stopPolling();
  let wasDown = false;

  polling = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      stopPolling();
      return;
    }

    const pos = robotjs.getMousePos();
    const down = isLeftMouseDown();

    if (down && !wasDown) {
      dragStart = { x: pos.x, y: pos.y };
      lastEnd = null;
      const d = toDip(pos.x, pos.y);
      overlayWindow.webContents.send("area-drag-start", d.x, d.y);
    } else if (down && wasDown && dragStart) {
      lastEnd = { x: pos.x, y: pos.y };
      const ds = toDip(dragStart.x, dragStart.y);
      const de = toDip(pos.x, pos.y);
      overlayWindow.webContents.send("area-drag-move", ds.x, ds.y, de.x, de.y);
    } else if (!down && wasDown && dragStart) {
      const x1 = Math.min(dragStart.x, pos.x);
      const y1 = Math.min(dragStart.y, pos.y);
      const x2 = Math.max(dragStart.x, pos.x);
      const y2 = Math.max(dragStart.y, pos.y);

      overlayWindow.webContents.send("area-drag-end");

      if (Math.abs(x2 - x1) < 10 || Math.abs(y2 - y1) < 10) {
        dragStart = null;
        wasDown = down;
        return;
      }

      const cb = pendingCallback;
      closeOverlay();
      if (cb) {
        cb({ x1, y1, x2, y2 });
      }
      return;
    }

    wasDown = down;
  }, 16);
}

function stopPolling() {
  if (polling) {
    clearInterval(polling);
    polling = null;
  }
  dragStart = null;
  lastEnd = null;
}

export function startAreaSelection(onComplete: (rect: { x1: number; y1: number; x2: number; y2: number }) => void): void {
  log("Starting area selection overlay");

  if (selecting) {
    log("Already selecting — ignoring duplicate activation");
    return;
  }
  selecting = true;

  if (overlayWindow) {
    closeOverlay();
  }

  pendingCallback = onComplete;

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
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
    fullscreenable: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "area-preload.js"),
    },
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  overlayWindow.webContents.on("console-message", (_e, _level, msg) => {
    log(`Overlay: ${msg}`);
  });

  const html = `data:text/html;charset=utf-8,${encodeURIComponent(getAreaHTML())}`;
  overlayWindow.loadURL(html);

  overlayWindow.once("ready-to-show", () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.show();
      log("Area selection overlay shown (mouse-through mode)");
    }
  });

  overlayWindow.on("closed", () => {
    stopPolling();
    selecting = false;
    overlayWindow = null;
  });
}

function getAreaHTML(): string {
  const lang = loadConfig().lang || "en";
  const hintText = `${t(lang as Lang, "areaHint")} · ${t(lang as Lang, "areaEsc")}`;
  return `<!DOCTYPE html>
<html>
<head>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; cursor: none; user-select: none; }
#crosshair {
  position: fixed;
  pointer-events: none;
  z-index: 9999;
  display: none;
}
#crosshair::before, #crosshair::after {
  content: '';
  position: absolute;
  background: rgba(255,255,255,0.85);
  border: 1px solid rgba(0,0,0,0.4);
}
#crosshair::before {
  width: 2px; height: 20px; left: 50%; top: 50%; transform: translate(-50%, -50%);
}
#crosshair::after {
  width: 20px; height: 2px; left: 50%; top: 50%; transform: translate(-50%, -50%);
}
#selection {
  position: absolute;
  border: 2px solid rgba(137, 180, 250, 0.9);
  background: transparent;
  display: none;
  pointer-events: none;
}
#hint {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: rgba(255, 255, 255, 0.95);
  font: 16px "Segoe UI", sans-serif;
  pointer-events: none;
  text-shadow: 0 1px 6px rgba(0,0,0,1);
  letter-spacing: 1px;
  background: rgba(0,0,0,0.5);
  padding: 10px 20px;
  border-radius: 8px;
}
</style>
</head>
<body>
<div id="crosshair"></div>
<div id="selection"></div>
<div id="hint">${hintText}</div>
<script>
const sel = document.getElementById('selection');
const hint = document.getElementById('hint');
const cross = document.getElementById('crosshair');

const api = window.areaSelection;

document.addEventListener('mousemove', (e) => {
  cross.style.display = 'block';
  cross.style.left = e.clientX + 'px';
  cross.style.top = e.clientY + 'px';
});

api.on('area-drag-start', (x, y) => {
  hint.style.display = 'none';
  cross.style.display = 'none';
  sel.style.display = 'block';
  sel.style.left = (x - window.screenX) + 'px';
  sel.style.top = (y - window.screenY) + 'px';
  sel.style.width = '0px';
  sel.style.height = '0px';
});

api.on('area-drag-move', (x1, y1, x2, y2) => {
  const sx = Math.min(x1, x2) - window.screenX;
  const sy = Math.min(y1, y2) - window.screenY;
  const sw = Math.abs(x2 - x1);
  const sh = Math.abs(y2 - y1);
  sel.style.left = sx + 'px';
  sel.style.top = sy + 'px';
  sel.style.width = sw + 'px';
  sel.style.height = sh + 'px';
});

api.on('area-drag-end', () => {
  sel.style.display = 'none';
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    api.cancel();
  }
});
</script>
</body>
</html>`;
}