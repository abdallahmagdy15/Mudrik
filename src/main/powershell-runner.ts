import { exec } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const log = (msg: string) => console.log(`[PS-RUNNER] ${msg}`);

const TMP_DIR = path.join(os.tmpdir(), "hoverbuddy");

function ensureTmpDir(): string {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
  return TMP_DIR;
}

export function makeOutputPath(): string {
  return path.join(ensureTmpDir(), `ps-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
}

export function readAndDelete(filePath: string): string {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8").trim();
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      return raw;
    }
  } catch (e: any) {
    log(`Failed to read output file ${filePath}: ${e.message}`);
  }
  return "";
}

export function runPowerShell(
  scriptPath: string,
  args: string[],
  options?: { timeout?: number }
): Promise<{ output: string; stderr: string; exitCode: number | null }> {
  const outputFile = makeOutputPath();
  const allArgs = [...args, "-OutputFile", outputFile];
  const argStr = allArgs.map((a) => {
    if (a.startsWith("-")) return a;
    if (a.includes(" ") || a.includes('"')) return `"${a.replace(/"/g, '\\"')}"`;
    return a;
  }).join(" ");

  const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" ${argStr}`;
  log(`PS cmd: ${cmd.slice(0, 300)}`);
  const timeout = options?.timeout || 15000;

  return new Promise((resolve) => {
    exec(cmd, { maxBuffer: 1024 * 1024, timeout }, (err: any, _stdout: string, stderr: string) => {
      const output = readAndDelete(outputFile);
      resolve({
        output,
        stderr: stderr || (err ? err.message : ""),
        exitCode: err ? err.code || 1 : 0,
      });
    });
  });
}