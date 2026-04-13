import { Tray, Menu, nativeImage, app } from "electron";
import * as path from "path";
import * as fs from "fs";

const log = (msg: string) => console.log(`[TRAY] ${msg}`);

let tray: Tray | null = null;

export function createTray(onQuit: () => void): Tray {
  return createTrayWithShow(undefined, onQuit);
}

export function createTrayWithShow(onShow: (() => void) | undefined, onQuit: () => void): Tray {
  log("Creating tray icon...");

  let icon = nativeImage.createEmpty();

  const iconPaths = [
    path.join(__dirname, "..", "assets", "icon.png"),
    path.join(__dirname, "..", "..", "assets", "icon.png"),
    path.join(app.getAppPath(), "assets", "icon.png"),
  ];

  for (const iconPath of iconPaths) {
    log(`Trying icon path: ${iconPath}`);
    if (fs.existsSync(iconPath)) {
      log(`Found icon at: ${iconPath}`);
      icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        log("Icon loaded successfully");
        break;
      }
    }
  }

  if (icon.isEmpty()) {
    log("No custom icon found, creating 16x16 blue dot");
    const size = 16;
    const buf = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const cx = size / 2;
        const cy = size / 2;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist < size / 2) {
          buf[i] = 137;     // R (#89b4fa blue)
          buf[i + 1] = 180; // G
          buf[i + 2] = 250; // B
          buf[i + 3] = 255; // A
        } else {
          buf[i] = 0;
          buf[i + 1] = 0;
          buf[i + 2] = 0;
          buf[i + 3] = 0;
        }
      }
    }
    icon = nativeImage.createFromBuffer(buf, {
      width: size,
      height: size,
    });
    log("Created fallback icon");
  }

  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: "HoverBuddy v1.0", enabled: false },
    { type: "separator" },
    ...(onShow ? [{ label: "Show Panel", click: () => { log("Show Panel clicked from tray"); onShow(); } }] : []),
    { type: "separator" },
    {
      label: "Show Log",
      click: () => {
        const { shell } = require("electron");
        const logPath = path.join(app.getPath("userData"), "hoverbuddy.log");
        log(`Opening log file: ${logPath}`);
        shell.showItemInFolder(logPath);
      },
    },
    { type: "separator" },
    { label: "Quit", click: onQuit },
  ]);

  tray.setToolTip("HoverBuddy - Ctrl+Alt+H to activate");
  tray.setContextMenu(contextMenu);

  if (onShow) {
    tray.on("double-click", () => {
      log("Tray double-clicked — showing panel");
      onShow();
    });
    tray.on("balloon-click", () => {
      log("Balloon notification clicked — showing panel");
      onShow();
    });
  }

  log("Tray created successfully");
  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
    log("Tray destroyed");
  }
}

export function showNotification(title: string, body: string): void {
  if (tray) {
    tray.displayBalloon({
      title,
      content: body,
      iconType: "info",
    });
    log(`Notification: ${title} - ${body}`);
  }
}