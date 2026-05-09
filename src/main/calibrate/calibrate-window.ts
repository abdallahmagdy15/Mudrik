// Cursor calibration test window — opened from the tray menu.
//
// Diagnostic tool: takes the AI/MCP/focus chaos out of the loop so we can
// answer "given a UIA element with known bounds, does the owl land on it?".
// Reuses the same modules Mudrik's guide flow uses (context-reader for
// UIA, guide-overlay for the owl) — no AI involved. User picks a target
// from a list of randomly-sampled clickables and visually verifies.

import { BrowserWindow, ipcMain, screen } from "electron";
import * as path from "path";
import { log } from "../logger";
import { showOverlay, hideOverlay } from "../guide/guide-overlay";
import { readContextAtPoint, getCursorPos } from "../context-reader";

// Same expanded set as the guide-mode candidates list in ipc-handlers.ts —
// keep the two in sync. Includes inputs (Edit), links (Hyperlink), and
// Chromium-generic types (Custom, Document, Image) so the calibration
// tool surfaces everything the AI would have to choose from.
const CLICKABLE_TYPES = new Set([
  "ControlType.Button","ControlType.MenuItem","ControlType.ListItem",
  "ControlType.Edit","ControlType.Hyperlink","ControlType.CheckBox",
  "ControlType.RadioButton","ControlType.ComboBox","ControlType.TabItem",
  "ControlType.TreeItem","ControlType.SplitButton","ControlType.Tab",
  "ControlType.Header","ControlType.HeaderItem",
  "ControlType.DataItem","ControlType.DataGrid","ControlType.Cell",
  "ControlType.Custom","ControlType.Image",
  "ControlType.Document","ControlType.Text",
  "ControlType.Slider","ControlType.Spinner","ControlType.Thumb",
  "ControlType.ToolBar","ControlType.MenuBar",
]);

interface Candidate {
  index: number;
  type: string;
  name: string;
  automationId: string;
  bounds: { x: number; y: number; width: number; height: number };
}

let win: BrowserWindow | null = null;

export function openCalibrateWindow(): void {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 560,
    height: 720,
    title: "Mudrik — Cursor Calibration",
    backgroundColor: "#0F1822",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "calibrate-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "calibrate.html"));
  win.on("closed", () => { win = null; });
  log("calibrate window opened");
}

// IPC: capture random clickables from the foreground window.
// Hides the calibrate window first so foreground reverts to the user's
// target, mirroring the same hide-then-capture pattern Mudrik's guide
// flow uses (so the test surfaces the same focus issues if any).
ipcMain.handle("calibrate-capture", async (_e, opts: { hideWaitMs?: number }) => {
  const hideWaitMs = typeof opts?.hideWaitMs === "number" ? opts.hideWaitMs : 500;
  const w = win;
  if (!w || w.isDestroyed()) return { error: "window gone" };
  try {
    w.blur();
    w.hide();
  } catch { /* best-effort */ }
  await new Promise((r) => setTimeout(r, hideWaitMs));
  const cursor = getCursorPos();
  let result;
  try {
    result = await readContextAtPoint(cursor.x, cursor.y);
  } catch (err: any) {
    if (w && !w.isDestroyed()) w.show();
    return { error: `UIA capture failed: ${err?.message || err}` };
  }
  if (w && !w.isDestroyed()) w.show();

  const tree = (result as any)?.windowTree as any[] | undefined;
  const windowTitle = result?.windowInfo?.title || "(unknown)";
  if (!Array.isArray(tree) || tree.length === 0) {
    // Report the most useful diagnostics for Chromium-empty-tree failures:
    // the element actually found at cursor (its type tells us if Chromium
    // returned ANY UIA at all — vs nothing at all), and the active window's
    // process name (so we know which Chromium-based app is refusing to
    // wake up). If the AI reports "Empty" but we DO have a typed element,
    // the wake-up partially worked — Chromium gave us the outer window
    // but didn't populate children.
    const el = (result as any)?.element;
    const elInfo = el ? `${el.type || "?"} "${el.name || ""}"` : "no element";
    const proc = result?.windowInfo?.processName || "?";
    return {
      error: `Empty window tree — wake-up didn't populate. Element at cursor: ${elInfo}. Process: ${proc}.`,
      windowTitle,
    };
  }
  const sf = screen.getPrimaryDisplay().scaleFactor || 1;
  const allClickables = tree.filter((el) =>
    el && CLICKABLE_TYPES.has(el.type) && el.bounds && el.bounds.width > 0 && el.bounds.height > 0
  );
  // Sample N at random (deterministic order would always show the first
  // ten in z-order — random gives broader coverage of the screen).
  const N = Math.min(10, allClickables.length);
  const shuffled = [...allClickables].sort(() => Math.random() - 0.5).slice(0, N);
  const candidates: Candidate[] = shuffled.map((el, i) => ({
    index: i,
    type: (el.type || "").replace(/^ControlType\./, ""),
    name: (el.name || "").replace(/\s+/g, " ").slice(0, 80),
    automationId: el.automationId || "",
    // Convert physical (DPI-aware capture) → logical (overlay's coord space)
    bounds: {
      x: Math.round(el.bounds.x / sf),
      y: Math.round(el.bounds.y / sf),
      width: Math.round(el.bounds.width / sf),
      height: Math.round(el.bounds.height / sf),
    },
  }));
  log(`calibrate-capture: window="${windowTitle}", total=${tree.length}, clickables=${allClickables.length}, sampled=${candidates.length}, sf=${sf}`);
  return {
    windowTitle,
    totalElements: tree.length,
    totalClickables: allClickables.length,
    scaleFactor: sf,
    candidates,
  };
});

// IPC: show the owl on a specific candidate's bounds for 3 seconds.
ipcMain.handle("calibrate-test-target", async (_e, bounds: { x: number; y: number; width: number; height: number }) => {
  if (!bounds) return { ok: false, error: "no bounds" };
  const cursor = getCursorPos();
  log(`calibrate-test-target: bounds=${JSON.stringify(bounds)} cursor=${JSON.stringify(cursor)}`);
  try {
    await showOverlay(bounds, cursor);
    setTimeout(() => { try { hideOverlay(); } catch { /* ok */ } }, 3000);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});
