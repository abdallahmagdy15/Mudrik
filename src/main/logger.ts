import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const LOG_FILE = path.join(os.homedir(), "AppData", "Roaming", "hoverbuddy", "hoverbuddy.log");

export function log(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  console.log(line.trimEnd());
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch { /* can't write to log file */ }
}