import { app, globalShortcut } from "electron";
import robot from "robotjs";

const log = (msg: string) => console.log(`[HOTKEY] ${msg}`);

let isListening = false;

export function startHotkeyListener(
  onActivate: (cursorPos: { x: number; y: number }) => void
): void {
  log("Starting hotkey listener...");
  registerIOHook(onActivate);
}

export function stopHotkeyListener(): void {
  globalShortcut.unregisterAll();
  isListening = false;
  log("Hotkey listener stopped");
}

function registerIOHook(
  onActivate: (cursorPos: { x: number; y: number }) => void
): void {
  app.whenReady().then(() => {
    const accelerator = "CommandOrControl+Alt+H";
    log(`Registering global shortcut: ${accelerator}`);

    const registered = globalShortcut.register(accelerator, () => {
      const pos = robot.getMousePos();
      log(`Hotkey triggered! Cursor at: x=${pos.x}, y=${pos.y}`);
      onActivate({ x: pos.x, y: pos.y });
    });

    if (!registered) {
      log(`ERROR: Failed to register shortcut ${accelerator} — it may already be in use`);
    } else {
      log(`Shortcut ${accelerator} registered successfully`);
    }

    isListening = true;
    log("Hotkey listener started");
  });
}