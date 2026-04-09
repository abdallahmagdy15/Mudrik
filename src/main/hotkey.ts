import { exec } from "child_process";
import { app, globalShortcut } from "electron";
import robot from "robotjs";

let isListening = false;
let ctrlHeld = false;

function simulateCtrlState(): void {
  robot.keyToggle("control", "down");
}

function restoreCtrlState(): void {
  robot.keyToggle("control", "up");
}

export function startHotkeyListener(
  onActivate: (cursorPos: { x: number; y: number }) => void
): void {
  registerIOHook(onActivate);
}

export function stopHotkeyListener(): void {
  globalShortcut.unregisterAll();
  isListening = false;
}

function registerIOHook(
  onActivate: (cursorPos: { x: number; y: number }) => void
): void {
  app.whenReady().then(() => {
    globalShortcut.register("CommandOrControl+Shift+Space", () => {
      const pos = robot.getMousePos();
      onActivate({ x: pos.x, y: pos.y });
    });

    isListening = true;
    console.log("Hotkey registered: Ctrl+Shift+Space");
  });
}