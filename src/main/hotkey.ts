import { app, globalShortcut } from "electron";
import robot from "robotjs";

const log = (msg: string) => console.log(`[HOTKEY] ${msg}`);

export interface HotkeyCallbacks {
  onPointerActivate: (cursorPos: { x: number; y: number }) => void;
  onAreaActivate: () => void;
}

let lastPointerTime = 0;
let lastAreaTime = 0;
const DEBOUNCE_MS = 800;

export function startHotkeyListener(callbacks: HotkeyCallbacks): void {
  log("Starting hotkey listener...");
  registerHotkeys(callbacks);
}

export function stopHotkeyListener(): void {
  globalShortcut.unregisterAll();
  log("Hotkey listener stopped");
}

function registerHotkeys(callbacks: HotkeyCallbacks): void {
  app.whenReady().then(() => {
    const pointerKey = "Alt+Space";
    log(`Registering pointer shortcut: ${pointerKey}`);

    const pointerRegistered = globalShortcut.register(pointerKey, () => {
      const now = Date.now();
      if (now - lastPointerTime < DEBOUNCE_MS) {
        log(`Pointer hotkey debounced (${now - lastPointerTime}ms)`);
        return;
      }
      lastPointerTime = now;
      const pos = robot.getMousePos();
      log(`Pointer hotkey triggered! Cursor at: x=${pos.x}, y=${pos.y}`);
      callbacks.onPointerActivate({ x: pos.x, y: pos.y });
    });

    if (!pointerRegistered) {
      log(`ERROR: Failed to register ${pointerKey} — may already be in use`);
    } else {
      log(`Pointer shortcut ${pointerKey} registered`);
    }

    const areaKey = "CommandOrControl+Space";
    log(`Registering area shortcut: ${areaKey}`);

    const areaRegistered = globalShortcut.register(areaKey, () => {
      const now = Date.now();
      if (now - lastAreaTime < DEBOUNCE_MS) {
        log(`Area hotkey debounced (${now - lastAreaTime}ms)`);
        return;
      }
      lastAreaTime = now;
      log(`Area hotkey triggered!`);
      callbacks.onAreaActivate();
    });

    if (!areaRegistered) {
      log(`ERROR: Failed to register ${areaKey} — may already be in use`);
    } else {
      log(`Area shortcut ${areaKey} registered`);
    }

    log("Hotkey listener started");
  });
}