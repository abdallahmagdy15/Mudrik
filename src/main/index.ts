import { app, BrowserWindow, screen, dialog, nativeTheme } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createTrayWithShow, destroyTray } from "./tray";
import { Config, DEFAULT_CONFIG, ContextPayload, IPC } from "../shared/types";
import { registerIpcHandlers, setContext, setAreaContext, getLastContext, patchConfigPersistOnly } from "./ipc-handlers";
import { startHotkeyListener, stopHotkeyListener, applyHotkeys } from "./hotkey";
import { loadConfig, saveConfig, isFirstRun, ensureAgentInWorkingDir } from "./config-store";
import { initUpdater, stopUpdater } from "./updater";
import { readContextAtPoint } from "./context-reader";
import { startAreaSelection } from "./area-selector";
import { scanArea } from "./area-scanner";
import { showElementHighlight, showAreaHighlight } from "./highlight";
import { captureAndOptimize, computeFocusRegion, cleanupImage } from "./vision";
import { log } from "./logger";

let mainWindow: BrowserWindow | null = null;
let config: Config = { ...DEFAULT_CONFIG };

function calculatePanelPosition(cursorX: number, cursorY: number): { x: number; y: number } {
  // Panel always anchors to the cursor on activation. We used to support a
  // "remember panel position" toggle, but it was removed — the panel is a
  // cursor-first tool, not a fixed floating window.
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
    panelX = lx - config.panelWidth - hGap;
  }

  panelY = ly - vGap;

  panelX = Math.max(workArea.x + 4, Math.min(panelX, rightEdge - config.panelWidth - 4));
  panelY = Math.max(workArea.y + 4, Math.min(panelY, bottomEdge - config.panelHeight - 4));

  log(`Panel: x=${panelX} y=${panelY} | cursor=(${lx},${ly}) screenMid=${screenMiddle} ${lx < screenMiddle ? 'RIGHT' : 'LEFT'} of cursor`);

  return { x: Math.round(panelX), y: Math.round(panelY) };
}

function createWindow(cursorX: number, cursorY: number): BrowserWindow {
  const pos = calculatePanelPosition(cursorX, cursorY);
  log(`Creating window at x=${pos.x}, y=${pos.y}, width=${config.panelWidth}, height=${config.panelHeight}`);

  // Resolve the owl icon for the BrowserWindow (Alt+Tab, taskbar if the
  // user ever un-sets skipTaskbar). Looked up relative to the built main
  // bundle so it works both in dev and packaged.
  const iconCandidates = [
    path.join(__dirname, "..", "assets", "icon.png"),
    path.join(__dirname, "..", "..", "assets", "icon.png"),
    path.join(app.getAppPath(), "assets", "icon.png"),
  ];
  const winIcon = iconCandidates.find((p) => {
    try { require("fs").accessSync(p); return true; } catch { return false; }
  });

  const win = new BrowserWindow({
    width: config.panelWidth,
    height: config.panelHeight,
    x: pos.x,
    y: pos.y,
    frame: false,
    ...(winIcon ? { icon: winIcon } : {}),
    // TRUE per-pixel transparency. All three of these must be set
    // together on Windows — without them Electron draws a default
    // opaque white/gray rectangle behind the CSS-rounded `.app`, which
    // is what produced the visible "rectangle behind the rounded
    // corners" bug:
    //   - `transparent: true`        enables the alpha channel
    //   - `backgroundColor: "#00000000"`  clears the default opaque fill
    //   - `hasShadow: false`         disables the OS drop shadow (we
    //                                draw our own macOS-style stacked
    //                                shadow in global.css `.app`)
    // We're also NOT using backdrop-filter (Chromium on an Electron
    // transparent window can't sample the desktop behind) nor Windows 11
    // acrylic (auto-dims on blur). The panel uses a solid teal-ink tint.
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // User-resizable. A frameless resizable window has an invisible
    // ~6px edge-resize gutter on all sides — settings items that sit
    // close to the right edge used to accidentally trigger a native
    // edge-resize on long-click. We mitigate that with explicit
    // min/max dimensions below + the header is a drag region, so the
    // gutter is the only resize affordance. Final size is persisted
    // via the `resize` / `close` handlers further down.
    resizable: true,
    minWidth: 320,
    minHeight: 360,
    maxWidth: 900,
    maxHeight: 1000,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Persist the resized size on hide/close so it survives a relaunch.
  // We persist only on hide/close — NOT on every `resize` event — to
  // avoid hammering the config file while the user drags a corner.
  // Position is NOT persisted; the panel is cursor-first and re-anchors
  // on every activation.
  const savePanelSizeOnHide = () => {
    if (win.isDestroyed()) return;
    const [w, h] = win.getSize();
    patchConfigPersistOnly({ panelWidth: w, panelHeight: h });
  };
  win.on("hide", savePanelSizeOnHide);
  win.on("close", savePanelSizeOnHide);

  // Desktop-wide cursor polling for the owl mascot. Runs only while the
  // panel is visible — ~33ms cadence (~30 Hz) is smooth enough for pupil
  // tracking and cheap enough not to notice. Using the Electron `screen`
  // API (not robotjs) so we don't pay a native-module call per tick.
  let cursorTimer: NodeJS.Timeout | null = null;
  const { screen: electronScreen } = require("electron") as typeof import("electron");
  const startCursorPolling = () => {
    if (cursorTimer) return;
    cursorTimer = setInterval(() => {
      if (win.isDestroyed() || !win.isVisible()) return;
      const pos = electronScreen.getCursorScreenPoint();
      win.webContents.send(IPC.CURSOR_POS, pos);
    }, 33);
  };
  const stopCursorPolling = () => {
    if (cursorTimer) {
      clearInterval(cursorTimer);
      cursorTimer = null;
    }
  };
  win.on("show", startCursorPolling);
  win.on("hide", stopCursorPolling);
  win.on("close", stopCursorPolling);

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

function applyTheme(theme: "system" | "light" | "dark"): void {
  try {
    nativeTheme.themeSource = theme;
    log(`Theme set to: ${theme} (resolved dark=${nativeTheme.shouldUseDarkColors})`);
  } catch (e: any) {
    log(`applyTheme FAILED: ${e.message}`);
  }
}

function applyLoginItemSetting(launchOnStartup: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: launchOnStartup,
      openAsHidden: true,
    });
    log(`setLoginItemSettings: openAtLogin=${launchOnStartup}`);
  } catch (e: any) {
    log(`setLoginItemSettings FAILED: ${e.message}`);
  }
}

async function maybeShowWelcome(): Promise<void> {
  if (config.hasCompletedWelcome) return;
  try {
    await dialog.showMessageBox({
      type: "info",
      title: "Welcome to HoverBuddy",
      message: "HoverBuddy runs from the system tray.",
      detail:
        `Press ${config.hotkeyPointer} on any window to open the assistant for the UI element under your cursor.\n\n` +
        `Press ${config.hotkeyArea} to draw a rectangle and ask about that area.\n\n` +
        `You can change the model, hotkeys, and startup behaviour from the ⚙ menu in the panel.`,
      buttons: ["Get started"],
      defaultId: 0,
      noLink: true,
    });
  } catch (e: any) {
    log(`Welcome dialog failed: ${e.message}`);
  }
  config.hasCompletedWelcome = true;
  saveConfig(config);
}

app.whenReady().then(async () => {
  log("App ready, initializing...");

  const firstRun = isFirstRun();
  config = loadConfig();
  log(`Config loaded: model=${config.model}, workingDir=${config.workingDir}, firstRun=${firstRun}`);

  // Persist the default config on first run so subsequent launches see it
  // and first-run detection is accurate.
  if (firstRun) saveConfig(config);

  ensureAgentInWorkingDir(config.workingDir);

  applyTheme(config.theme);
  applyLoginItemSetting(config.launchOnStartup);

  await maybeShowWelcome();

  createTrayWithShow(
    () => {
      const lastCtx = getLastContext();
      if (lastCtx && mainWindow) {
        log("Show Panel from tray — re-showing with last context");
        showExistingPanel();
        return;
      }
      // No real context yet. Open an empty panel centered on the primary
      // display so the user can chat without a target element. Previously we
      // synthesized a fake "Test Element" context, which looked like a bug
      // to first-time users.
      log("Show Panel from tray — no existing context, opening empty panel");
      const display = screen.getPrimaryDisplay();
      const emptyContext: ContextPayload = {
        element: {
          name: "",
          type: "none",
          value: "",
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          children: [],
        },
        surrounding: [],
        cursorPos: {
          x: Math.round(display.workAreaSize.width / 2),
          y: Math.round(display.workAreaSize.height / 2),
        },
      };
      setContext(emptyContext);
      showPanel(emptyContext);
    },
    () => app.quit()
  );
  log("Tray created");

  registerIpcHandlers(config, showPanel, hidePanel, (next, prev) => {
    if (next.hotkeyPointer !== prev.hotkeyPointer || next.hotkeyArea !== prev.hotkeyArea) {
      const result = applyHotkeys({ pointer: next.hotkeyPointer, area: next.hotkeyArea });
      if (!result.ok) {
        // Roll back the in-memory config so UI shows the previous working values.
        config.hotkeyPointer = prev.hotkeyPointer;
        config.hotkeyArea = prev.hotkeyArea;
        saveConfig(config);
      }
    }
    if (next.launchOnStartup !== prev.launchOnStartup) {
      applyLoginItemSetting(next.launchOnStartup);
    }
    if (next.theme !== prev.theme) {
      applyTheme(next.theme);
    }
    if (next.workingDir !== prev.workingDir) {
      ensureAgentInWorkingDir(next.workingDir);
    }
  });
  log("IPC handlers registered");

  startHotkeyListener(
    {
      onPointerActivate: handlePointerActivate,
      onAreaActivate: handleAreaActivate,
    },
    { pointer: config.hotkeyPointer, area: config.hotkeyArea }
  );
  log("Hotkey listener started");

  initUpdater();
  log("Updater initialized");

  app.on("before-quit", () => {
    log("App quitting...");
    stopUpdater();
    stopHotkeyListener();
    destroyTray();
  });
});

log("Main process script loaded");

app.on("window-all-closed", () => {
  log("window-all-closed event (suppressed — tray app)");
});