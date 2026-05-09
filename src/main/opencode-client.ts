import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { log } from "./logger";
import { buildCleanOpenCodeEnv } from "../shared/providers";

export interface OpenCodeEvent {
  type: string;
  sessionID?: string;
  part?: {
    type?: string;
    text?: string;
    tool?: string;
    callID?: string;
    state?: {
      status?: string;
      input?: Record<string, any>;
      output?: string;
      metadata?: Record<string, any>;
    };
    reason?: string;
    tokens?: { total: number; input: number; output: number; reasoning: number };
  };
  properties?: {
    permission?: string;
    [key: string]: unknown;
  };
  error?: { message: string; data?: any };
  timestamp?: number;
}

export type EventHandler = (event: OpenCodeEvent) => void;

/**
 * Tools that must NEVER execute from a Mudrik-initiated OpenCode session.
 * The model is limited to text + `<!--ACTION:...-->` markers; anything else is
 * treated as a sandbox breach and terminates the session.
 *
 * Frontmatter permission rules in `.opencode/agent/readonly.md` are not
 * enforced by OpenCode 1.4.x, so this in-process kill-switch is the
 * authoritative enforcement point.
 */
/**
 * Allowlist — the only tools Mudrik's readonly agent may use. Switched
 * from a denylist after the original `*mcp*` substring failed to catch
 * `playwright_browser_navigate` / `playwright_browser_click` (registered
 * via the user's OpenCode global config and named without "mcp"). The AI
 * happily called them mid-guide, did the task itself via browser
 * automation, and never emitted guide_step markers — exactly the leak the
 * sandbox is meant to prevent.
 *
 * If OpenCode adds new built-in read tools, append here. Anything else
 * (bash, edit, write, task, todowrite, skill, ANY MCP server's tools
 * regardless of naming) terminates the session. Users can still register
 * MCP servers in their global OpenCode config — those tools just won't
 * be reachable from inside Mudrik's subprocess.
 */
const ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "grep",
  "glob",
  "list",
  "webfetch",
  "websearch",
]);

function isDisallowedToolName(name: string): boolean {
  return !ALLOWED_TOOLS.has(name.toLowerCase());
}

function detectDisallowedTool(event: OpenCodeEvent): string | null {
  if (event.type === "permission.asked") {
    const asked = event.properties?.permission;
    if (typeof asked === "string" && isDisallowedToolName(asked)) return asked;
  }
  const tool = event.part?.tool;
  if (typeof tool === "string" && isDisallowedToolName(tool)) return tool;
  return null;
}

export class OpenCodeClient {
  private sessionId: string | null = null;
  private freshSession: boolean = true;
  private model: string;
  private workingDir: string;
  private activeProcess: ChildProcess | null = null;
  private apiKeys: Record<string, string> = {};
  /**
   * Path to a Mudrik-controlled `XDG_CONFIG_HOME` directory containing an
   * `opencode/opencode.json` with empty `mcp` (and no plugins/skills). When
   * set, it's injected into the spawn env so the OpenCode subprocess reads
   * OUR config instead of the user's global one — making any MCP servers
   * the user registered (Playwright, zai-mcp-server, etc.) invisible to
   * the AI Mudrik runs. Provisioned via `ensureIsolatedOpenCodeConfig`.
   */
  private isolatedConfigDir: string | null = null;

  constructor(
    model: string = "ollama-cloud/gemini-3-flash-preview",
    workingDir?: string,
    apiKeys?: Record<string, string>,
    isolatedConfigDir?: string,
  ) {
    this.model = model;
    this.workingDir = workingDir || os.homedir();
    this.apiKeys = apiKeys || {};
    this.isolatedConfigDir = isolatedConfigDir || null;
    log(`OpenCodeClient created: model=${this.model}, dir=${this.workingDir}, keys=${Object.keys(this.apiKeys).length}, isolatedConfig=${this.isolatedConfigDir || "none"}`);
  }

  updateModel(model: string): void {
    this.model = model;
    log(`Model updated to: ${model}`);
  }

  /** Replace the provider→key map used to inject env vars on spawn. */
  updateApiKeys(apiKeys: Record<string, string>): void {
    this.apiKeys = apiKeys || {};
    log(`API keys updated: providers=[${Object.keys(this.apiKeys).join(", ")}]`);
  }

  resetSession(): void {
    this.sessionId = null;
    this.freshSession = true;
    log("Session reset — next message will start a NEW conversation (no --continue)");
  }

  hasSession(): boolean {
    return this.sessionId !== null;
  }

  setRestoredSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.freshSession = false;
    log(`Restored session: ${sessionId.slice(0, 30)}`);
  }

  sendMessage(prompt: string, onEvent: EventHandler, imageFiles?: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const opencodeBin = this.findOpenCodeBin();
      if (!opencodeBin) {
        const err = "Could not find opencode binary. Is it installed? (npm i -g opencode-ai)";
        log(err);
        onEvent({ type: "error", error: { message: err } });
        reject(new Error(err));
        return;
      }

      const args: string[] = [
        opencodeBin,
        "run",
        "--format", "json",
        "--model", this.model,
        "--agent", "readonly",
      ];

      if (this.sessionId) {
        args.push("--session", this.sessionId);
        log(`Reusing session: ${this.sessionId.slice(0, 30)}`);
      } else if (this.freshSession) {
        this.freshSession = false;
        log("Starting new session (no --continue)");
      } else {
        args.push("--continue");
        log("Continuing last session (--continue)");
      }

      if (imageFiles && imageFiles.length > 0) {
        for (const img of imageFiles) {
          args.push("-f", img);
        }
        log(`Image files: ${imageFiles.length} - ${imageFiles.map(f => { const exists = fs.existsSync(f); return `${path.basename(f)}${exists ? "" : " (MISSING!)"}`; }).join(", ")}`);
      }

      const promptSnippet = prompt.slice(0, 80).replace(/\n/g, " ");
      log(`Spawning node ${args.join(" ")} (prompt: "${promptSnippet}...")`);

      // Use a minimal env (Windows essentials + provider keys) to avoid
      // the Bun 1.3.13 segfault triggered by Electron/Chromium-injected env
      // vars on Windows. Inheriting process.env wholesale crashes opencode
      // 1.14.x at startup (~1ms in, in the Windows loader).
      const cleanEnv = buildCleanOpenCodeEnv(process.env, this.apiKeys);
      // Override XDG_CONFIG_HOME so the spawn reads our isolated config
      // (no MCPs, no plugins) instead of the user's global one. Cuts off
      // Playwright / zai-mcp-server / any future-registered MCP server
      // before OpenCode ever learns it exists. The kill-switch in
      // detectDisallowedTool stays as a belt-and-suspenders second layer.
      if (this.isolatedConfigDir) {
        cleanEnv.XDG_CONFIG_HOME = this.isolatedConfigDir;
      }
      const proc = spawn("node", args, {
        cwd: this.workingDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: cleanEnv,
      });

      this.activeProcess = proc;
      let buffer = "";
      let errorOccurred = false;
      let resolved = false;

      proc.stdout!.on("data", (data: Buffer) => {
        buffer += data.toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event: OpenCodeEvent = JSON.parse(trimmed);
            if (event.sessionID && !this.sessionId) {
              this.sessionId = event.sessionID;
              this.freshSession = false;
              log(`Captured sessionID: ${this.sessionId.slice(0, 30)}`);
            } else if (event.sessionID && this.sessionId && event.sessionID !== this.sessionId) {
              this.sessionId = event.sessionID;
              this.freshSession = false;
              log(`SessionID updated: ${this.sessionId.slice(0, 30)}`);
            }

            const blockedTool = detectDisallowedTool(event);
            if (blockedTool) {
              const msg = `Blocked: model attempted to use the "${blockedTool}" tool. Mudrik only allows UI action markers. Session terminated for safety.`;
              log(msg);
              onEvent({ type: "error", error: { message: msg, data: { blockedTool } } });
              try { proc.kill("SIGKILL"); } catch (e: any) { log(`kill failed: ${e.message}`); }
              this.activeProcess = null;
              errorOccurred = true;
              if (!resolved) {
                resolved = true;
                reject(new Error(msg));
              }
              return;
            }

            onEvent(event);
          } catch {
            log(`Non-JSON line: ${trimmed.slice(0, 100)}`);
          }
        }
      });

      proc.stderr!.on("data", (data: Buffer) => {
        const msg = data.toString("utf-8").trim();
        if (msg) log(`stderr: ${msg.slice(0, 200)}`);
      });

      proc.on("error", (err) => {
        log(`Process spawn error: ${err.message}`);
        errorOccurred = true;
        onEvent({ type: "error", error: { message: `Failed to start OpenCode: ${err.message}` } });
        this.activeProcess = null;
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      proc.on("close", (code) => {
        log(`Process exited with code ${code}`);

        if (buffer.trim()) {
          try {
            const event: OpenCodeEvent = JSON.parse(buffer.trim());
            onEvent(event);
          } catch {}
        }

        this.activeProcess = null;
        if (!errorOccurred && !resolved) {
          resolved = true;
          if (code !== 0 && code !== null) {
            reject(new Error(`exit:${code}`));
          } else {
            resolve();
          }
        }
      });

      log(`Writing prompt to stdin (${prompt.length} bytes)`);
      proc.stdin!.write(prompt);
      proc.stdin!.end();
    });
  }

  kill(): void {
    if (this.activeProcess) {
      log("Killing active OpenCode process");
      this.activeProcess.kill();
      this.activeProcess = null;
    }
  }

  private findOpenCodeBin(): string | null {
    const paths = [
      path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "opencode-ai", "bin", "opencode"),
      path.join(os.homedir(), ".local", "share", "npm", "node_modules", "opencode-ai", "bin", "opencode"),
      path.join("/usr", "local", "lib", "node_modules", "opencode-ai", "bin", "opencode"),
    ];

    for (const p of paths) {
      if (fs.existsSync(p)) {
        log(`Found opencode bin: ${p}`);
        return p;
      }
    }

    const npmGlobalPrefix = this.getNpmGlobalPrefix();
    if (npmGlobalPrefix) {
      const globalPath = path.join(npmGlobalPrefix, "node_modules", "opencode-ai", "bin", "opencode");
      if (fs.existsSync(globalPath)) {
        log(`Found opencode bin via npm prefix: ${globalPath}`);
        return globalPath;
      }
    }

    log("Could not find opencode binary in any known location");
    return null;
  }

  private getNpmGlobalPrefix(): string | null {
    try {
      const { execSync } = require("child_process");
      const prefix = execSync("npm config get prefix", { encoding: "utf-8" }).trim();
      log(`npm global prefix: ${prefix}`);
      return prefix;
    } catch {
      log("Could not determine npm global prefix");
      return null;
    }
  }
}