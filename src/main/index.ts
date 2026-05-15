import { app, BrowserWindow, screen, dialog, nativeTheme } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as koffi from "koffi";
import { createTrayWithShow, destroyTray } from "./tray";
import { Config, DEFAULT_CONFIG, ContextPayload, IPC } from "../shared/types";
import { registerIpcHandlers, setContext, setAreaContext, getLastContext, patchConfigPersistOnly, attachAutoScreenshot } from "./ipc-handlers";
import { startHotkeyListener, stopHotkeyListener, applyHotkeys } from "./hotkey";
import { loadConfig, saveConfig, isFirstRun, ensureAgentInWorkingDir, migrateLegacyConfig } from "./config-store";
import { initUpdater, stopUpdater } from "./updater";
import { readContextAtPoint } from "./context-reader";
import { startAreaSelection } from "./area-selector";
import { scanArea } from "./area-scanner";
import { showElementHighlight, showAreaHighlight } from "./highlight";
import { cleanupImage, captureAndOptimize } from "./vision";
import { log } from "./logger";

app.commandLine.appendSwitch("enable-features", "BackDropFilter");

let mainWindow: BrowserWindow | null = null;
let config: Config = { ...DEFAULT_CONFIG };

const dwmapi = koffi.load("dwmapi.dll");
const DwmSetWindowAttribute = dwmapi.func(
  "int DwmSetWindowAttribute(unsigned long long hwnd, int attr, void *val, int size)"
);
const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWCP_ROUND = 2;

function applyRoundedCorners(win: BrowserWindow): void {
  try {
    const buf = win.getNativeWindowHandle();
    const hwnd = buf.length === 8 ? Number(buf.readBigUInt64LE()) : buf.readUInt32LE();
    const prefBuf = Buffer.alloc(4);
    prefBuf.writeUInt32LE(DWMWCP_ROUND, 0);
    const hr = DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, prefBuf, 4);
    log(`DwmSetWindowAttribute hwnd=0x${hwnd.toString(16)} hr=0x${(hr >>> 0).toString(16)}`);
  } catch (e: any) {
    log(`DWM rounded corners failed: ${e.message}`);
  }
}

function applyAcrylic(win: BrowserWindow): void {
  try {
    win.setBackgroundMaterial("acrylic");
    log("setBackgroundMaterial('acrylic') applied");
  } catch (e: any) {
    log(`setBackgroundMaterial failed: ${e.message}`);
  }
}

function calculatePanelPosition(cursorX: number, cursorY: number): { x: number; y: number; width: number; height: number } {
  const electronCursor = screen.getCursorScreenPoint();
  log(`Cursor: robotjs=(${cursorX},${cursorY}) electron=(${electronCursor.x},${electronCursor.y})`);

  const display = screen.getDisplayNearestPoint(electronCursor);
  const workArea = display.workArea;
  const lx = electronCursor.x;
  const ly = electronCursor.y;
  const rightEdge = workArea.x + workArea.width;
  const bottomEdge = workArea.y + workArea.height;

  // Panel size as percentage of display
  const panelWidth = Math.round(workArea.width * 0.35);
  const panelHeight = Math.round(workArea.height * 0.60);

  const PADDING = 8;
  const halfWidth = workArea.width / 2;

  // Calculate available space on each side of cursor
  const leftSpace = lx - workArea.x;
  const rightSpace = rightEdge - lx;

  // Bias toward left side (10% of screen width).
  const BIAS = workArea.width * 0.1;

  let panelX: number;
  if (leftSpace >= rightSpace + BIAS) {
    // Cursor far to the right → place panel on LEFT half, centered within it
    const leftHalfCenter = workArea.x + halfWidth / 2; // 25% across screen
    panelX = Math.round(leftHalfCenter - panelWidth / 2);
    log(`Panel placement: LEFT-HALF-CENTER (cursor-right, leftSpace=${Math.round(leftSpace)}, rightSpace=${Math.round(rightSpace)})`);
  } else {
    // Cursor on left or middle → place panel on RIGHT half, centered within it
    const rightHalfCenter = workArea.x + halfWidth + halfWidth / 2; // 75% across screen
    panelX = Math.round(rightHalfCenter - panelWidth / 2);
    log(`Panel placement: RIGHT-HALF-CENTER (cursor-left, leftSpace=${Math.round(leftSpace)}, rightSpace=${Math.round(rightSpace)})`);
  }

  // Clamp horizontal so panel stays on screen
  panelX = Math.max(workArea.x + PADDING, Math.min(panelX, rightEdge - panelWidth - PADDING));

  // Vertically center on screen (not relative to cursor)
  let panelY = workArea.y + Math.round((workArea.height - panelHeight) / 2);
  panelY = Math.max(workArea.y + PADDING, Math.min(panelY, bottomEdge - panelHeight - PADDING));

  log(`Panel: x=${panelX} y=${panelY} width=${panelWidth} height=${panelHeight} | cursor=(${lx},${ly})`);

  return { x: Math.round(panelX), y: Math.round(panelY), width: panelWidth, height: panelHeight };
}

function createWindow(cursorX: number, cursorY: number): BrowserWindow {
  const pos = calculatePanelPosition(cursorX, cursorY);
  log(`Creating window at x=${pos.x}, y=${pos.y}, width=${pos.width}, height=${pos.height}`);

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
    width: pos.width,
    height: pos.height,
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
    log(`Repositioning existing window to x=${pos.x}, y=${pos.y}, size=${pos.width}x${pos.height}`);
    mainWindow.setPosition(pos.x, pos.y);
    mainWindow.setSize(pos.width, pos.height);
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
  applyAcrylic(mainWindow);
  applyRoundedCorners(mainWindow);
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

function showPanelWithLoading(cursorPos: { x: number; y: number }): void {
  const cursorX = cursorPos.x;
  const cursorY = cursorPos.y;

  if (!mainWindow) {
    mainWindow = createWindow(cursorX, cursorY);
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  } else {
    const pos = calculatePanelPosition(cursorX, cursorY);
    mainWindow.setPosition(pos.x, pos.y);
    mainWindow.setSize(pos.width, pos.height);
  }

  const send = () => {
    mainWindow?.webContents.send(IPC.CONTEXT_LOADING, true);
  };

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", () => send());
  } else {
    send();
  }

  mainWindow.show();
  applyAcrylic(mainWindow);
  applyRoundedCorners(mainWindow);
  mainWindow.focus();
  mainWindow.moveTop();
}

function updatePanelContext(context: ContextPayload): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  log(`updatePanelContext: delivering real context — element "${context.element?.name}" type="${context.element?.type}"`);
  mainWindow.webContents.send(IPC.CONTEXT_LOADING, false);
  mainWindow.webContents.send(IPC.CONTEXT_READY, context);
  mainWindow.focus();
  mainWindow.moveTop();
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.FOCUS_INPUT);
    }
  }, 150);
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
  mainWindow.setSize(pos.width, pos.height);
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

// Monotonically increasing activation id. Each hotkey press bumps it and
// stamps the resulting context read; any .then that resolves for a superseded
// id is dropped. Without this, a slow first UIA read can finish AFTER a
// faster second read and overwrite the live context with stale data — the
// user sees the panel "stuck on" the previous element.
let activationSeq = 0;

async function handlePointerActivate(cursorPos: { x: number; y: number }): Promise<void> {
  const myActivation = ++activationSeq;
  log(`Pointer hotkey at cursor pos: x=${cursorPos.x}, y=${cursorPos.y} (activation #${myActivation})`);
  lastCursorX = cursorPos.x;
  lastCursorY = cursorPos.y;

  // Edge case: Mudrik panel is currently focused (user pressed Alt+Space
  // while typing in our chat input). Without intervention, getActiveHwnd
  // inside readContextAtPoint returns Mudrik's own HWND, and the PS
  // script walks Mudrik's panel tree (chat input, owl logo, settings
  // button) — useless to the user, who meant "refresh context from
  // whatever I was working on."
  //
  // Fix: detect the case, hide the panel, force the cached user-app
  // HWND to foreground, brief settle wait, THEN capture. This matches
  // the user's mental model — Alt+Space always reads "what's underneath
  // / behind me," not Mudrik itself.
  try {
    const { getPanelWindow } = await import("./ipc-handlers");
    const panel = getPanelWindow();
    if (panel && panel.isVisible() && panel.isFocused()) {
      const { getLastUserAppHwnd, setForegroundHwnd } = await import("./guide/active-window");
      const cachedHwnd = getLastUserAppHwnd();
      log(`Alt+Space fired while Mudrik was focused; cached user-app HWND=${cachedHwnd}`);
      try { panel.blur(); } catch { /* best-effort */ }
      panel.hide();
      if (cachedHwnd) {
        try { await setForegroundHwnd(cachedHwnd); } catch { /* best-effort */ }
      }
      // Brief wait for Windows to transition foreground back. The
      // remainder of the capture will see the user's app as foreground
      // via the standard `getActiveHwnd` path inside readContextAtPoint.
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (err: any) {
    log(`Mudrik-as-foreground detection failed (${err?.message || err}) — continuing with live foreground`);
  }

  // Show panel IMMEDIATELY with a loading indicator, then capture context
  // in the background. Without this the user sees nothing for 1-4 seconds
  // while PowerShell + UIA COM round-trips run — feels broken.
  showPanelWithLoading(cursorPos);

  const contextPromise = readContextAtPoint(cursorPos.x, cursorPos.y);
  // When autoAttachImage is on, capture a full-screen screenshot in parallel
  // with the UIA context read. The panel isn't visible yet so the capture is
  // clean. The screenshot will be attached to the first prompt in this session.
  const imagePromise = config.autoAttachImage
    ? ((): Promise<string | null> => {
        const { screen: electronScreen } = require("electron") as typeof import("electron");
        const display = electronScreen.getDisplayNearestPoint(cursorPos);
        const sf = display.scaleFactor || 1;
        const b = display.bounds;
        return captureAndOptimize(
          Math.round(b.x * sf),
          Math.round(b.y * sf),
          Math.round((b.x + b.width) * sf),
          Math.round((b.y + b.height) * sf)
        );
      })()
    : Promise.resolve(null);

  Promise.all([contextPromise, imagePromise]).then(
    ([{ element, surrounding, windowInfo, windowTree, visibleWindows }, imagePath]) => {
      if (myActivation !== activationSeq) {
        log(`Pointer activation #${myActivation} superseded by #${activationSeq} — discarding stale read`);
        if (imagePath) cleanupImage(imagePath);
        return;
      }
      log(`Context read: element type="${element.type}" name="${element.name}" value="${String(element.value).slice(0, 80)}", surrounding=${surrounding.length}, windowTree=${windowTree?.length || 0}, visibleWindows=${visibleWindows?.length || 0}, window="${windowInfo?.title || ""}" app="${windowInfo?.processName || ""}"`);
      const context: ContextPayload = { element, surrounding, cursorPos, windowInfo, windowTree, visibleWindows };
      if (imagePath) {
        attachAutoScreenshot(imagePath);
        context.hasScreenshot = true;
      }
      setContext(context);
      showElementHighlight(element.bounds);
      updatePanelContext(context);
    }
  ).catch((err) => {
    log(`ERROR reading context: ${err.message}`);
    // Still dismiss the loading state so the panel isn't stuck
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.CONTEXT_LOADING, false);
    }
  });
}

function handleAreaActivate(): void {
  const myActivation = ++activationSeq;
  log(`Area hotkey triggered — starting area selection (activation #${myActivation})`);
  hidePanel();
  startAreaSelection((rect) => {
    if (myActivation !== activationSeq) {
      log(`Area activation #${myActivation} superseded by #${activationSeq}`);
      return;
    }
    log(`Area selected (physical): (${rect.x1},${rect.y1}) to (${rect.x2},${rect.y2})`);
    const px1 = rect.x1;
    const py1 = rect.y1;
    const px2 = rect.x2;
    const py2 = rect.y2;
    const midX = (px1 + px2) / 2;
    const midY = (py1 + py2) / 2;
    const cursorPos = { x: Math.round(midX), y: Math.round(midY) };
    // Capture/scan BEFORE showing the highlight — otherwise the glowing
    // border window is drawn on top of the region and gets baked into the
    // PowerShell CopyFromScreen capture.
    scanArea(px1, py1, px2, py2).then(({ elements, imagePath }) => {
      if (myActivation !== activationSeq) {
        log(`Area scan for #${myActivation} superseded by #${activationSeq} — discarding result`);
        if (imagePath) cleanupImage(imagePath);
        return;
      }
      log(`Area scan found ${elements.length} elements, image=${imagePath ? "captured" : "none"}`);
      showAreaHighlight(rect);
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
      args: launchOnStartup ? ["--hidden"] : [],
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
      title: "Welcome to Mudrik",
      message: "Mudrik runs from the system tray.",
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

  const startedHidden = process.argv.includes("--hidden");

  // One-shot: carry the user's config over from %APPDATA%\hoverbuddy\ if it
  // was installed pre-rebrand. Must run BEFORE isFirstRun/loadConfig so the
  // first-run flow doesn't trigger for people who already had config.
  migrateLegacyConfig();

  const firstRun = isFirstRun();
  config = loadConfig();
  log(`Config loaded: model=${config.model}, workingDir=${config.workingDir}, firstRun=${firstRun}`);

  // Persist the default config on first run so subsequent launches see it
  // and first-run detection is accurate.
  if (firstRun) saveConfig(config);

  ensureAgentInWorkingDir(config.workingDir);

  applyTheme(config.theme);
  applyLoginItemSetting(config.launchOnStartup);

  if (!startedHidden) {
    await maybeShowWelcome();
  }

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