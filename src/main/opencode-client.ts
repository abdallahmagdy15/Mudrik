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
  // True when the active process was killed via `kill()` (user clicked
  // Stop, or the idle-timeout fired). The close handler uses this to
  // suppress the silent-failure diagnostic — surfacing "model
  // unavailable / API key bad" right after the user deliberately
  // cancelled would be misleading and confusing.
  private killedByUser: boolean = false;

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
      // Reset per-send. Set to true by `kill()` if the user (or the idle
      // timeout) terminates the process; the close handler uses it to
      // suppress the "silent failure" diagnostic that would otherwise
      // mislead a deliberate cancellation.
      this.killedByUser = false;
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
      // Accumulators for diagnostic when OpenCode bails silently (empty
      // error event, exit 0, no text streamed). Without these we just
      // logged "OpenCode error: undefined" and lost all signal — see
      // session ses_1de8b600cffeQGo3oslUB55e98 where model name
      // "ollama-cloud/kimi-k2.6:cloud" caused an instant provider
      // failure with no message.
      let stderrBuf = "";
      let textWasStreamed = false;
      let lastErrorEvent: any = null;

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

            // Track whether ANY text was streamed (so close-handler can
            // distinguish "silent failure" from "graceful empty response").
            if (event.type === "text" && event.part?.text) {
              textWasStreamed = true;
            }
            // Capture raw error event for close-time diagnostic. Some
            // provider failures (bad model name, auth) come through as
            // {"type":"error","error":{}} with no message — log the raw
            // line so future debugging has SOMETHING to look at.
            if (event.type === "error") {
              lastErrorEvent = event;
              if (!event.error?.message) {
                log(`OpenCode error event with no message — raw line: ${trimmed.slice(0, 500)}`);
              }
            }

            onEvent(event);
          } catch {
            log(`Non-JSON line: ${trimmed.slice(0, 100)}`);
          }
        }
      });

      proc.stderr!.on("data", (data: Buffer) => {
        const msg = data.toString("utf-8");
        // Accumulate (capped) for close-time diagnostic surfacing.
        if (stderrBuf.length < 4000) stderrBuf += msg;
        const trimmed = msg.trim();
        if (trimmed) log(`stderr: ${trimmed.slice(0, 200)}`);
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
            // Same tracking as in stdout handler.
            if (event.type === "text" && event.part?.text) textWasStreamed = true;
            if (event.type === "error") lastErrorEvent = event;
            onEvent(event);
          } catch {}
        }

        this.activeProcess = null;

        // Silent-failure path: OpenCode exited cleanly (code 0) but
        // streamed no text. Either a) it emitted an error event with
        // an empty message field (provider auth/model-name failure
        // — common with mistyped model names like
        // "ollama-cloud/kimi-k2.6:cloud"), b) it crashed without
        // emitting anything useful, or c) the model returned nothing.
        // Surface a useful message including any stderr we captured.
        //
        // BUT skip when the process was killed via `kill()` — the user
        // (or the idle timeout) deliberately cancelled. Surfacing
        // "model unavailable / check API key" after a deliberate Stop
        // is misleading. The caller already showed its own message
        // (Stop button → renders nothing; idle timeout → shows the
        // timeout message).
        if (this.killedByUser) {
          log(`Process was killed by user/timeout — skipping silent-failure diagnostic`);
        } else if (!textWasStreamed && !errorOccurred && (code === 0 || code === null)) {
          const stderrTail = stderrBuf.trim().slice(-800);
          const errorMsgFromEvent = lastErrorEvent?.error?.message;
          let diagnostic: string;
          // Lead with the MOST COMMON cause: transient provider issue.
          // OpenCode internally retries 5xx / network errors; if it
          // still emitted an empty error or exited silently, the
          // retries didn't help. Almost always "try again in a moment"
          // is the right next step — not "your model/API key is bad."
          // Configuration problems are real but rare and we'd usually
          // have a real error message from the provider in that case.
          if (errorMsgFromEvent) {
            diagnostic = errorMsgFromEvent;
          } else if (stderrTail) {
            diagnostic = `OpenCode failed silently. stderr: ${stderrTail}`;
          } else if (lastErrorEvent) {
            // Empty error event — usually a 5xx from the provider that
            // OpenCode couldn't extract a message from after exhausting
            // its retries.
            diagnostic = `Provider returned an error with no details — likely a temporary outage. Please try sending again.\n\nIf this keeps happening: check the model name and API key for "${this.model.split("/")[0]}" in ⚙ Settings.`;
          } else {
            // No error event at all, no text — the subprocess exited
            // cleanly with nothing to say. Same root cause space.
            diagnostic = `No response received. The provider may be temporarily unavailable — please try sending again.\n\nIf this keeps happening: check the model "${this.model}" and the API key for "${this.model.split("/")[0]}" in ⚙ Settings.`;
          }
          log(`Silent-failure diagnostic: ${diagnostic.slice(0, 300)}`);
          onEvent({ type: "error", error: { message: diagnostic } });
          errorOccurred = true;
        }

        if (!errorOccurred && !resolved) {
          resolved = true;
          if (code !== 0 && code !== null) {
            reject(new Error(`exit:${code}`));
          } else {
            resolve();
          }
        } else if (errorOccurred && !resolved) {
          resolved = true;
          resolve(); // error was already surfaced via onEvent
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
      this.killedByUser = true;
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