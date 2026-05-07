// src/main/guide/guide-overlay.ts
//
// Always-on-top transparent BrowserWindow that renders the owl-wing
// pointer animating to a target + a translucent rounded circle around
// the target. Created lazily on first showOverlay() call; reused for
// subsequent steps; destroyed when the guide ends or the app quits.

import { BrowserWindow, screen, app } from "electron";
import * as path from "node:path";
import { log } from "../logger";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

let overlayWin: BrowserWindow | null = null;
let preloadPath: string | null = null;

function getPreloadPath(): string {
  // Webpack copies guide-overlay-preload.js next to main.js in dist/.
  // Resolve relative to __dirname (which is dist/ at runtime).
  if (preloadPath) return preloadPath;
  preloadPath = path.join(__dirname, "guide-overlay-preload.js");
  return preloadPath;
}

async function createOverlayWindow(): Promise<BrowserWindow> {
  const display = screen.getPrimaryDisplay();
  const w = new BrowserWindow({
    x: 0,
    y: 0,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: getPreloadPath(),
    },
  });
  await w.loadFile(path.join(__dirname, "guide-overlay.html"));
  // Click-through: ignore mouse events. forward:true keeps hover events
  // for any future hover-driven affordances; the user clicks pass to the
  // app underneath.
  w.setIgnoreMouseEvents(true, { forward: true });
  log("guide-overlay window created");
  return w;
}

export async function showOverlay(target: Bounds, fromCursor: { x: number; y: number }): Promise<void> {
  if (!overlayWin || overlayWin.isDestroyed()) {
    overlayWin = await createOverlayWindow();
  }
  overlayWin.webContents.send("guide-overlay-show", { target, fromCursor });
  overlayWin.showInactive();
}

export function hideOverlay(): void {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.webContents.send("guide-overlay-hide");
  // Give the fade-out animation 300ms to play before hiding the window
  setTimeout(() => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide();
  }, 320);
}

export function destroyOverlay(): void {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.destroy();
  overlayWin = null;
}

// Ensure overlay window is destroyed on app quit so it doesn't linger
app.on("before-quit", destroyOverlay);
