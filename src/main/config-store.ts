import { app } from "electron";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { Config, DEFAULT_CONFIG } from "../shared/types";
import { log } from "./logger";

/**
 * One-shot rebrand migration: copy any config the user had under the old
 * `%APPDATA%\hoverbuddy\` folder into the new `%APPDATA%\mudrik\` (or
 * `Mudrik\` when packaged) folder that Electron now resolves
 * `app.getPath("userData")` to.
 *
 * Runs BEFORE loadConfig on app startup. Safe to run every launch:
 *   - if the new config already exists, does nothing
 *   - if there's no old folder at all, does nothing (fresh install)
 *   - if only the old folder exists, copies config.json + the log file
 *
 * Leaves the old folder on disk so users can still find it if they want
 * to roll back. Can be removed once a few minor releases have shipped.
 */
export function migrateLegacyConfig(): void {
  try {
    const newDir = app.getPath("userData");
    const newConfig = path.join(newDir, "config.json");
    if (fs.existsSync(newConfig)) return; // already migrated or fresh new install

    const legacyDir = path.join(os.homedir(), "AppData", "Roaming", "hoverbuddy");
    const legacyConfig = path.join(legacyDir, "config.json");
    if (!fs.existsSync(legacyConfig)) return; // nothing to migrate

    fs.mkdirSync(newDir, { recursive: true });
    fs.copyFileSync(legacyConfig, newConfig);
    log(`migrateLegacyConfig: copied ${legacyConfig} -> ${newConfig}`);

    // Also carry over the log file so users keep their history on first launch
    // after the rebrand. Best-effort — don't fail migration if this trips.
    const legacyLog = path.join(legacyDir, "hoverbuddy.log");
    const newLog = path.join(newDir, "hoverbuddy.log");
    if (fs.existsSync(legacyLog) && !fs.existsSync(newLog)) {
      try { fs.copyFileSync(legacyLog, newLog); } catch (e: any) {
        log(`migrateLegacyConfig: log copy skipped (${e.message})`);
      }
    }
  } catch (err: any) {
    log(`migrateLegacyConfig FAILED (non-fatal): ${err.message}`);
  }
}

/**
 * Ensure the sandboxed OpenCode agent definition exists in the given working
 * directory. OpenCode 1.4.x discovers agents by scanning `.opencode/agent/`
 * in the CWD, so we copy `readonly.md` out of the packaged resources the
 * first time we see a working dir that doesn't have one. Overwrites on each
 * launch so updated versions of the agent propagate on upgrade.
 */
export function ensureAgentInWorkingDir(workingDir: string): void {
  try {
    // In dev, `process.resourcesPath` points at Electron's own resources —
    // our source agent lives next to the repo root. In a packaged install it
    // points at the NSIS install dir's `resources/.opencode/agent/readonly.md`.
    const packagedSrc = path.join(process.resourcesPath, ".opencode", "agent", "readonly.md");
    const devSrc = path.resolve(__dirname, "..", ".opencode", "agent", "readonly.md");
    const src = fs.existsSync(packagedSrc) ? packagedSrc : devSrc;
    if (!fs.existsSync(src)) {
      log(`ensureAgentInWorkingDir: source agent missing at ${packagedSrc} and ${devSrc}`);
      return;
    }
    const destDir = path.join(workingDir, ".opencode", "agent");
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, "readonly.md");
    fs.copyFileSync(src, dest);
    log(`readonly agent provisioned at ${dest}`);
  } catch (e: any) {
    log(`ensureAgentInWorkingDir FAILED (non-fatal): ${e.message}`);
  }
}

/**
 * Persisted config lives at `<userData>/config.json`. Writes are atomic
 * (write to `.tmp`, then rename) so a crash mid-write can't leave a
 * corrupt file that bricks startup. Unknown fields from future versions
 * are preserved; missing fields are backfilled from DEFAULT_CONFIG.
 */

let configPath: string | null = null;

function getConfigPath(): string {
  if (configPath) return configPath;
  configPath = path.join(app.getPath("userData"), "config.json");
  return configPath;
}

export function loadConfig(): Config {
  const p = getConfigPath();
  const defaults: Config = {
    ...DEFAULT_CONFIG,
    workingDir: app.getPath("userData"),
  };

  if (!fs.existsSync(p)) {
    log(`Config file not found at ${p} — using defaults`);
    return defaults;
  }

  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      log(`Config at ${p} is not an object — using defaults`);
      return defaults;
    }
    const merged: Config = { ...defaults, ...parsed };
    // Coerce: don't let a missing recentModels strand the UI
    if (!Array.isArray(merged.recentModels) || merged.recentModels.length === 0) {
      merged.recentModels = [merged.model];
    }
    log(`Config loaded from ${p}`);
    return merged;
  } catch (err: any) {
    log(`Config read failed (${err.message}) — using defaults`);
    return defaults;
  }
}

export function saveConfig(config: Config): void {
  const p = getConfigPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), "utf-8");
    fs.renameSync(tmp, p);
    log(`Config saved to ${p}`);
  } catch (err: any) {
    log(`Config write FAILED (${err.message})`);
  }
}

export function isFirstRun(): boolean {
  return !fs.existsSync(getConfigPath());
}
