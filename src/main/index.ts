import {
  app,
  BrowserWindow,
  screen,
} from "electron";
import * as path from "path";
import { createTray, destroyTray } from "./tray";
import { Config, DEFAULT_CONFIG, ContextPayload, IPC } from "../shared/types";
import { registerIpcHandlers } from "./ipc-handlers";
import { startHotkeyListener, stopHotkeyListener } from "./hotkey";
import { readContextAtPoint } from "./context-reader";

let mainWindow: BrowserWindow | null = null;
let config: Config = { ...DEFAULT_CONFIG };

function createWindow(): BrowserWindow {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

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

  win.loadFile(path.join(__dirname, "index.html"));
  return win;
}

function showPanel(context: ContextPayload): void {
  if (!mainWindow) {
    mainWindow = createWindow();
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  }
  mainWindow.webContents.send(IPC.CONTEXT_READY, context);
  mainWindow.show();
  mainWindow.focus();
}

function hidePanel(): void {
  if (mainWindow) {
    mainWindow.hide();
  }
}

app.whenReady().then(() => {
  config = { ...DEFAULT_CONFIG };
  createTray(() => app.quit());

  registerIpcHandlers(config, showPanel, hidePanel);

  startHotkeyListener((cursorPos) => {
    readContextAtPoint(cursorPos.x, cursorPos.y).then(
      ({ element, surrounding }) => {
        showPanel({ element, surrounding, cursorPos });
      }
    );
  });

  app.on("before-quit", () => {
    stopHotkeyListener();
    destroyTray();
  });
});

app.on("window-all-closed", () => {
  // prevent default - we want to keep running in system tray
});