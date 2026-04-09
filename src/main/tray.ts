import { Tray, Menu, nativeImage } from "electron";
import * as path from "path";

let tray: Tray | null = null;

export function createTray(onQuit: () => void): Tray {
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAEbSURBVFhH7ZQ9DoMwDEXTvPo/xPOQaWyMRcYgZOyM0exlVEr76QUO6qZp+qcb/5ck+QCSfABJvoAknyASD6DnB8gBJPsAkt8gQD4gywWS3CBDPh6gnweSPCDKB5I8IMkHknwgyQeSfCDJB5J8IMkHknwgyQeSfCDJB5J8IMkHknwgyeeQJD5Akj8gyQeSfCDJB5J8IMkHknwgyQeSfCDJB5J8IMkHknwgyQeSfCDJB5I8IMoHknwgyQeSfCDJB5J8IMkHknwgyQeSfCDJB5J8IMkHknwgyQeSfCDJB5J8IMkH0hygSQfSHKBJB9IcoEkH0hygSQfSHKBJB9IcoEkH0hygSQfSHKB/w7oO4N3+wFq2C6D+AAAAABJRU5ErkJggg==",
      "base64"
    )
  );

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: "HoverBuddy", enabled: false },
    { type: "separator" },
    { label: "Quit", click: onQuit },
  ]);

  tray.setToolTip("HoverBuddy - Ctrl+Shift+Space to activate");
  tray.setContextMenu(contextMenu);

  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}