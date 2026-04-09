import { config as loadDotEnv } from "dotenv";
import { app, BrowserWindow, screen } from "electron";
import * as path from "path";
import * as fs from "fs";
import { createTrayWithShow, destroyTray } from "./tray";
import { Config, DEFAULT_CONFIG, ContextPayload, IPC } from "../shared/types";
import { registerIpcHandlers, setContext } from "./ipc-handlers";
import { startHotkeyListener, stopHotkeyListener } from "./hotkey";
import { readContextAtPoint } from "./context-reader";

loadDotEnv();

const LOG_FILE = path.join(app.getPath("userData"), "hoverbuddy.log");

function log(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  console.log(line.trimEnd());
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // can't write to log file, that's fine
  }
}

let mainWindow: BrowserWindow | null = null;
let config: Config = { ...DEFAULT_CONFIG };

function createWindow(): BrowserWindow {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  log(`Creating window at x=${screenWidth - 440}, width=420, height=600`);

  const win = new BrowserWindow({
    width: 420,
    height: 600,
    x: screenWidth - 440,
    y: 100,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
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
  setContext(context);

  if (!mainWindow) {
    log("No existing window, creating new one");
    mainWindow = createWindow();
    mainWindow.on("closed", () => {
      log("Window closed");
      mainWindow = null;
    });
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
  log("Panel shown and focused");
}

function hidePanel(): void {
  log("hidePanel called");
  if (mainWindow) {
    mainWindow.hide();
    log("Window hidden");
  }
}

app.whenReady().then(() => {
  log("App ready, initializing...");
  log(`Log file: ${LOG_FILE}`);

  config = { ...DEFAULT_CONFIG };
  log(`Config: ollamaUrl=${config.ollamaUrl}, model=${config.model}`);

  createTrayWithShow(
    () => {
      log("Show Panel from tray — creating test context");
      const testContext: ContextPayload = {
        element: {
          name: "Test Element",
          type: "text",
          value: "This is a test. If you can see this, the renderer is working!",
          bounds: { x: 0, y: 0, width: 200, height: 50 },
          children: [],
        },
        surrounding: [],
        cursorPos: { x: 400, y: 400 },
      };
      showPanel(testContext);
    },
    () => app.quit()
  );
  log("Tray created");

  registerIpcHandlers(config, showPanel, hidePanel);
  log("IPC handlers registered");

  startHotkeyListener((cursorPos) => {
    log(`Hotkey activated at cursor pos: x=${cursorPos.x}, y=${cursorPos.y}`);
    readContextAtPoint(cursorPos.x, cursorPos.y).then(
      ({ element, surrounding }) => {
        log(`Context read: element type="${element.type}" name="${element.name}" value="${String(element.value).slice(0, 80)}", surrounding=${surrounding.length} items`);
        showPanel({ element, surrounding, cursorPos });
      }
    ).catch((err) => {
      log(`ERROR reading context: ${err.message}`);
    });
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