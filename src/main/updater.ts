import { app, dialog, Notification } from "electron";
import { autoUpdater } from "electron-updater";
import { log } from "./logger";

/**
 * Update flow:
 *  - On startup (packaged app only) check once.
 *  - Then re-check on a 6-hour cadence while the app is running.
 *  - When an update is downloaded, show a tray notification. A modal dialog
 *    is only used if the user explicitly picks "Check for updates…" from
 *    the tray menu, so background checks don't interrupt work.
 */

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let periodic: NodeJS.Timeout | null = null;
let updateDownloaded = false;

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "not-available" }
  | { kind: "available"; version: string }
  | { kind: "downloaded"; version: string }
  | { kind: "error"; message: string };

let status: UpdateStatus = { kind: "idle" };

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export function initUpdater(): void {
  if (!app.isPackaged) {
    log("Updater skipped: app is not packaged (dev build)");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m: string) => log(`[UPD] ${m}`),
    warn: (m: string) => log(`[UPD-WARN] ${m}`),
    error: (m: string) => log(`[UPD-ERR] ${m}`),
    debug: () => { /* suppressed */ },
  } as any;

  autoUpdater.on("checking-for-update", () => {
    status = { kind: "checking" };
  });
  autoUpdater.on("update-not-available", () => {
    status = { kind: "not-available" };
  });
  autoUpdater.on("update-available", (info) => {
    status = { kind: "available", version: info.version };
    log(`Update available: ${info.version}`);
  });
  autoUpdater.on("update-downloaded", (info) => {
    status = { kind: "downloaded", version: info.version };
    updateDownloaded = true;
    log(`Update downloaded: ${info.version}`);
    try {
      new Notification({
        title: "Mudrik update ready",
        body: `Version ${info.version} will be installed the next time you quit.`,
      }).show();
    } catch (e: any) {
      log(`Update notification failed: ${e.message}`);
    }
  });
  autoUpdater.on("error", (err) => {
    status = { kind: "error", message: err.message };
    log(`Updater error: ${err.message}`);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    log(`checkForUpdates failed at startup: ${err.message}`);
  });

  periodic = setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log(`Periodic update check failed: ${err.message}`);
    });
  }, CHECK_INTERVAL_MS);
}

export function stopUpdater(): void {
  if (periodic) {
    clearInterval(periodic);
    periodic = null;
  }
}

/**
 * User-initiated check (from the tray menu). Pops a native dialog with the
 * outcome so the user gets immediate feedback either way.
 */
export async function checkForUpdatesInteractive(): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox({
      type: "info",
      message: "Updates are only available in the packaged app.",
      buttons: ["OK"],
    });
    return;
  }
  try {
    const r = await autoUpdater.checkForUpdates();
    if (updateDownloaded) {
      const choice = await dialog.showMessageBox({
        type: "info",
        message: `Mudrik ${status.kind === "downloaded" ? status.version : "update"} is ready.`,
        detail: "Restart now to install, or keep working and it will install when you quit.",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (choice.response === 0) {
        setImmediate(() => autoUpdater.quitAndInstall());
      }
      return;
    }
    const info = r?.updateInfo;
    if (info && info.version !== app.getVersion()) {
      await dialog.showMessageBox({
        type: "info",
        message: `Update to ${info.version} is downloading.`,
        detail: "You'll be notified when it's ready to install.",
        buttons: ["OK"],
      });
      return;
    }
    await dialog.showMessageBox({
      type: "info",
      message: `Mudrik is up to date (${app.getVersion()}).`,
      buttons: ["OK"],
    });
  } catch (err: any) {
    await dialog.showMessageBox({
      type: "error",
      message: "Couldn't check for updates.",
      detail: err.message,
      buttons: ["OK"],
    });
  }
}
