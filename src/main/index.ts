import { app, BrowserWindow, screen } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createTrayWithShow, destroyTray } from "./tray";
import { Config, DEFAULT_CONFIG, ContextPayload, IPC } from "../shared/types";
import { registerIpcHandlers, setContext, setAreaContext, getLastContext } from "./ipc-handlers";
import { startHotkeyListener, stopHotkeyListener } from "./hotkey";
import { readContextAtPoint } from "./context-reader";
import { startAreaSelection } from "./area-selector";
import { scanArea } from "./area-scanner";
import { showElementHighlight, showAreaHighlight } from "./highlight";
import { captureAndOptimize, computeFocusRegion, cleanupImage } from "./vision";
import { log } from "./logger";

let mainWindow: BrowserWindow | null = null;
let config: Config = { ...DEFAULT_CONFIG };

const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 620;

function calculatePanelPosition(cursorX: number, cursorY: number): { x: number; y: number } {
  // Use Electron's own cursor position (same coordinate space as window positioning)
  const electronCursor = screen.getCursorScreenPoint();
  log(`Cursor: robotjs=(${cursorX},${cursorY}) electron=(${electronCursor.x},${electronCursor.y})`);

  const display = screen.getDisplayNearestPoint(electronCursor);
  const workArea = display.workArea;
  const lx = electronCursor.x;
  const ly = electronCursor.y;
  const rightEdge = workArea.x + workArea.width;
  const bottomEdge = workArea.y + workArea.height;
  const screenMiddle = workArea.x + workArea.width / 2;

  const hGap = Math.round(workArea.width * 0.15);
  const vGap = Math.round(workArea.height * 0.15);
  let panelX: number;
  let panelY: number;

  if (lx < screenMiddle) {
    panelX = lx + hGap;
  } else {
    panelX = lx - PANEL_WIDTH - hGap;
  }

  panelY = ly - vGap;

  panelX = Math.max(workArea.x + 4, Math.min(panelX, rightEdge - PANEL_WIDTH - 4));
  panelY = Math.max(workArea.y + 4, Math.min(panelY, bottomEdge - PANEL_HEIGHT - 4));

  log(`Panel: x=${panelX} y=${panelY} | cursor=(${lx},${ly}) screenMid=${screenMiddle} ${lx < screenMiddle ? 'RIGHT' : 'LEFT'} of cursor`);

  return { x: Math.round(panelX), y: Math.round(panelY) };
}

function createWindow(cursorX: number, cursorY: number): BrowserWindow {
  const pos = calculatePanelPosition(cursorX, cursorY);
  log(`Creating window at x=${pos.x}, y=${pos.y}, width=${PANEL_WIDTH}, height=${PANEL_HEIGHT}`);

  const win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minWidth: 320,
    minHeight: 400,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  log(`Loading index.html from ${path.join(__dirname, "index.html")}`);
  log(`dist dir contents: ${fs.readdirSync(path.join(__dirname)).join(", ")}`);

  win.loadFile(path.join(__dirname, "index.html"));

  win.webContents.on("did-finish-load", () => {
    log("Renderer finished loading");
  });

  win.webContents.on("did-fail-load", (_e, code, desc) => {
    log(`ERROR: Renderer failed to load: code=${code} desc=${desc}`);
  });

  win.webContents.on("console-message", (_e, level, msg) => {
    const levels = ["verbose", "info", "warning", "error"];
    log(`Renderer console [${levels[level] || level}]: ${msg}`);
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    log(`ERROR: Renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });

  log("Window created successfully");
  return win;
}

function showPanel(context: ContextPayload): void {
  log(`showPanel called with context: element=${context.element?.type} "${context.element?.name}" (${context.element?.value?.slice(0, 50)}...)`);

  const cursorX = context.cursorPos?.x ?? 400;
  const cursorY = context.cursorPos?.y ?? 400;

  if (!mainWindow) {
    log("No existing window, creating new one");
    mainWindow = createWindow(cursorX, cursorY);
    mainWindow.on("closed", () => {
      log("Window closed");
      mainWindow = null;
    });
  } else {
    const pos = calculatePanelPosition(cursorX, cursorY);
    log(`Repositioning existing window to x=${pos.x}, y=${pos.y}`);
    mainWindow.setPosition(pos.x, pos.y);
  }

  const sendContext = () => {
    log(`Sending CONTEXT_READY to renderer`);
    mainWindow?.webContents.send(IPC.CONTEXT_READY, context);
  };

  if (mainWindow.webContents.isLoading()) {
    log("Window still loading, waiting for did-finish-load...");
    mainWindow.webContents.once("did-finish-load", () => {
      log("did-finish-load fired, sending context");
      sendContext();
    });
  } else {
    log("Window already loaded, sending context immediately");
    sendContext();
  }

  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
      mainWindow.webContents.send(IPC.FOCUS_INPUT);
    }
  }, 150);

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
      mainWindow.webContents.send(IPC.FOCUS_INPUT);
    }
  }, 400);

  log("Panel shown and focused");
}

function hidePanel(): void {
  log("hidePanel called");
  if (mainWindow) {
    mainWindow.hide();
    log("Window hidden");
  }
}

function showExistingPanel(): void {
  log("showExistingPanel called — re-showing with last context (no reset)");
  if (!mainWindow) {
    log("No existing window, cannot re-show");
    return;
  }
  const pos = calculatePanelPosition(
    lastCursorX ?? screen.getPrimaryDisplay().workAreaSize.width / 2,
    lastCursorY ?? screen.getPrimaryDisplay().workAreaSize.height / 2
  );
  mainWindow.setPosition(pos.x, pos.y);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
      mainWindow.webContents.send(IPC.FOCUS_INPUT);
    }
  }, 150);
}

let lastCursorX: number | null = null;
let lastCursorY: number | null = null;

function handlePointerActivate(cursorPos: { x: number; y: number }): void {
  log(`Pointer hotkey at cursor pos: x=${cursorPos.x}, y=${cursorPos.y}`);
  lastCursorX = cursorPos.x;
  lastCursorY = cursorPos.y;
  readContextAtPoint(cursorPos.x, cursorPos.y).then(
    ({ element, surrounding, windowInfo }) => {
      log(`Context read: element type="${element.type}" name="${element.name}" value="${String(element.value).slice(0, 80)}", surrounding=${surrounding.length} items, window="${windowInfo?.title || ""}" app="${windowInfo?.processName || ""}"`);
      const context: ContextPayload = { element, surrounding, cursorPos, windowInfo };
      setContext(context);
      showElementHighlight(element.bounds);
      showPanel(context);

      if (element.bounds.width > 0 && element.bounds.height > 0) {
        const { x1, y1, x2, y2 } = computeFocusRegion(element.bounds, cursorPos);
        log(`Capturing pointer image: (${x1},${y1})-(${x2},${y2})`);

        captureAndOptimize(x1, y1, x2, y2).then((imagePath) => {
          if (imagePath) {
            log(`Pointer image captured: ${imagePath}`);
            context.imagePath = imagePath;
            context.hasScreenshot = true;
            const win = BrowserWindow.getAllWindows()[0];
            if (win) {
              win.webContents.send(IPC.CONTEXT_READY, context);
            }
          }
        }).catch((err) => {
          log(`Pointer image capture failed (non-fatal): ${err.message}`);
        });
      }
    }
  ).catch((err) => {
    log(`ERROR reading context: ${err.message}`);
  });
}

function handleAreaActivate(): void {
  log(`Area hotkey triggered — starting area selection`);
  hidePanel();
  startAreaSelection((rect) => {
    log(`Area selected: (${rect.x1},${rect.y1}) to (${rect.x2},${rect.y2})`);
    showAreaHighlight(rect);
    const cursorPos = { x: Math.round((rect.x1 + rect.x2) / 2), y: Math.round((rect.y1 + rect.y2) / 2) };
    scanArea(rect.x1, rect.y1, rect.x2, rect.y2).then(({ elements, imagePath }) => {
      log(`Area scan found ${elements.length} elements, image=${imagePath ? "captured" : "none"}`);
      const context = setAreaContext(elements, rect, cursorPos, imagePath);
      showPanel(context);
    }).catch((err) => {
      log(`ERROR scanning area: ${err.message}`);
    });
  });
}

app.whenReady().then(() => {
  log("App ready, initializing...");

  config = { ...DEFAULT_CONFIG, workingDir: path.join(__dirname, "..") || process.cwd() };
  log(`Config: model=${config.model}, workingDir=${config.workingDir}`);

  createTrayWithShow(
    () => {
      const lastCtx = getLastContext();
      if (lastCtx && mainWindow) {
        log("Show Panel from tray — re-showing with last context");
        showExistingPanel();
      } else {
        log("Show Panel from tray — no existing context, creating test context");
        const display = screen.getPrimaryDisplay();
        const testContext: ContextPayload = {
          element: {
            name: "Test Element",
            type: "text",
            value: "This is a test. If you can see this, the renderer is working!",
            bounds: { x: 0, y: 0, width: 200, height: 50 },
            children: [],
          },
          surrounding: [],
          cursorPos: { x: Math.round(display.workAreaSize.width / 2), y: Math.round(display.workAreaSize.height / 2) },
        };
        setContext(testContext);
        showPanel(testContext);
      }
    },
    () => app.quit()
  );
  log("Tray created");

  registerIpcHandlers(config, showPanel, hidePanel);
  log("IPC handlers registered");

  startHotkeyListener({
    onPointerActivate: handlePointerActivate,
    onAreaActivate: handleAreaActivate,
  });
  log("Hotkey listener started");

  app.on("before-quit", () => {
    log("App quitting...");
    stopHotkeyListener();
    destroyTray();
  });
});

log("Main process script loaded");

app.on("window-all-closed", () => {
  log("window-all-closed event (suppressed — tray app)");
});