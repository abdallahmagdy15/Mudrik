import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// The log file lives next to config.json under Electron's userData folder.
// We can't use `app.getPath("userData")` here because logger.ts is imported
// before app.ready — every module that logs on import would crash. Hardcode
// the path instead (Windows filesystem is case-insensitive, so this matches
// both the dev `mudrik` and the packaged `Mudrik` folders).
const NEW_LOG_DIR = path.join(os.homedir(), "AppData", "Roaming", "mudrik");
// Fallback to the pre-rebrand folder if the user has only that one and a log
// line fires before migrateLegacyConfig() has run. Harmless once migration
// moves on — the old dir will be empty and the new one preferred.
const LEGACY_LOG_DIR = path.join(os.homedir(), "AppData", "Roaming", "hoverbuddy");
const LOG_FILE = fs.existsSync(NEW_LOG_DIR) || !fs.existsSync(LEGACY_LOG_DIR)
  ? path.join(NEW_LOG_DIR, "hoverbuddy.log")
  : path.join(LEGACY_LOG_DIR, "hoverbuddy.log");

export function log(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  console.log(line.trimEnd());
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch { /* can't write to log file */ }
}