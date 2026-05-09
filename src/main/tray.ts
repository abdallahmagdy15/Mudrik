import { Tray, Menu, nativeImage, app } from "electron";
import * as path from "path";
import * as fs from "fs";
import { checkForUpdatesInteractive } from "./updater";
import { openCalibrateWindow } from "./calibrate/calibrate-window";

const log = (msg: string) => console.log(`[TRAY] ${msg}`);

let tray: Tray | null = null;

export function createTray(onQuit: () => void): Tray {
  return createTrayWithShow(undefined, onQuit);
}

export function createTrayWithShow(onShow: (() => void) | undefined, onQuit: () => void): Tray {
  log("Creating tray icon...");

  let icon = nativeImage.createEmpty();

  // Preferred filenames in priority order. `tray.png` (32x32) is hand-tuned
  // for the Windows system tray; `icon.png` (256x256) is the fallback.
  // Each name is looked up across several locations so the icon resolves in
  // dev (`dist/` sibling), packaged (`resources/app/assets`), and ASAR
  // builds (`app.getAppPath()`).
  const candidateNames = ["tray.png", "icon.png"];
  const searchRoots = [
    path.join(__dirname, "..", "assets"),        // dev: dist/ → ../assets
    path.join(__dirname, "..", "..", "assets"),  // dist/main/ → ../../assets
    path.join(app.getAppPath(), "assets"),       // packaged
    path.join(process.resourcesPath || "", "assets"),
  ];

  outer: for (const name of candidateNames) {
    for (const root of searchRoots) {
      const p = path.join(root, name);
      log(`Trying icon path: ${p}`);
      if (!fs.existsSync(p)) continue;
      const img = nativeImage.createFromPath(p);
      if (img.isEmpty()) continue;
      icon = img;
      // Attach the @2x variant for HiDPI displays if present. Electron's
      // nativeImage picks the right one based on device scale factor.
      const hiDpi = path.join(root, "tray@2x.png");
      if (name === "tray.png" && fs.existsSync(hiDpi)) {
        icon.addRepresentation({ scaleFactor: 2.0, buffer: fs.readFileSync(hiDpi) });
        log(`Added HiDPI representation from ${hiDpi}`);
      }
      log(`Icon loaded from ${p}`);
      break outer;
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
    { label: `Mudrik v${app.getVersion()}`, enabled: false },
    { type: "separator" },
    ...(onShow ? [{ label: "Show Panel", click: () => { log("Show Panel clicked from tray"); onShow(); } }] : []),
    { type: "separator" },
    {
      label: "Check for updates…",
      click: () => {
        log("Check for updates clicked");
        checkForUpdatesInteractive().catch((e) => log(`checkForUpdatesInteractive failed: ${e.message}`));
      },
    },
    {
      label: "Show Log",
      click: () => {
        const { shell } = require("electron");
        const logPath = path.join(app.getPath("userData"), "hoverbuddy.log");
        log(`Opening log file: ${logPath}`);
        shell.showItemInFolder(logPath);
      },
    },
    // Cursor Calibration Test: dev-only diagnostic. Hidden in release
    // builds so end users don't see internal tooling. `app.isPackaged` is
    // false for `electron .` (local/debug) and true for installer-built
    // releases. Power users can still force-show via MUDRIK_DEV=1.
    ...((!app.isPackaged || process.env.MUDRIK_DEV === "1")
      ? [{
          label: "🎯 Cursor Calibration Test",
          click: () => {
            log("Opening calibrate window from tray");
            openCalibrateWindow();
          },
        }]
      : []),
    { type: "separator" },
    { label: "Quit", click: onQuit },
  ]);

  tray.setToolTip("Mudrik — Alt+Space to activate");
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