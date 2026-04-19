import { ipcMain, BrowserWindow } from "electron";
import { Config, ContextPayload, IPC, Action } from "../shared/types";
import { OpenCodeClient, OpenCodeEvent } from "./opencode-client";
import { SYSTEM_PROMPT } from "../shared/prompts";
import { executeAction, parseActionsFromResponse, ActionResult, setLastContextElement, validateAction } from "./action-executor";
import { showNotification } from "./tray";
import { cleanupImage, captureAndOptimize } from "./vision";
import { saveConfig } from "./config-store";
import { spawn } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

import { log } from "./logger";

function computeContextHash(context: ContextPayload | null, isArea: boolean, areaEls: any[]): string {
  if (!context) return "";
  const el = context.element;
  const imageLen = context.imagePath ? 1 : 0;
  const areaCount = areaEls.length;
  return `${isArea}:${el.type}:${el.name}:${el.value?.slice(0, 50)}:${imageLen}:${areaCount}`;
}

let client: OpenCodeClient;
let appConfig: Config;
let currentContext: ContextPayload | null = null;
let hidePanelFn: (() => void) | null = null;
let showPanelFn: ((context: ContextPayload) => void) | null = null;
let lastContext: ContextPayload | null = null;
let fullResponseText: string = "";
let lastFailedAction: Action | null = null;
let isAreaContext: boolean = false;
let areaElements: any[] = [];
let areaImagePath: string = "";
let lastContextHash: string = "";
let contextNeedsSending: boolean = false;
let hasSentFirstMessage: boolean = false;
let attachScreenshotNext: boolean = false;

export function setContext(context: ContextPayload): void {
  const newHash = computeContextHash(context, false, []);
  const isSameContext = newHash === lastContextHash && lastContextHash !== "";

  if (!isSameContext && currentContext?.imagePath) {
    cleanupImage(currentContext.imagePath);
  }
  if (areaImagePath) {
    cleanupImage(areaImagePath);
    areaImagePath = "";
  }
  currentContext = context;
  lastContext = context;
  isAreaContext = false;
  areaElements = [];

  if (isSameContext) {
    log(`setContext: same context — not marking for re-send (hash=${newHash})`);
  } else {
    contextNeedsSending = true;
    lastContextHash = newHash;
    log(`setContext: NEW context — marked for sending (hash=${newHash})`);
  }

  setLastContextElement({
    automationId: context.element?.automationId,
    bounds: context.element?.bounds,
    name: context.element?.name,
    type: context.element?.type,
  });
  log(`setContext: element type="${context.element?.type}" name="${context.element?.name}" automationId="${context.element?.automationId || ""}"`);
}

export function getLastContext(): ContextPayload | null {
  return lastContext;
}

export function setAreaContext(elements: any[], rect: { x1: number; y1: number; x2: number; y2: number }, cursorPos: { x: number; y: number }, imagePath?: string): ContextPayload {
  if (currentContext?.imagePath) {
    cleanupImage(currentContext.imagePath);
  }
  if (areaImagePath) {
    cleanupImage(areaImagePath);
  }
  isAreaContext = true;
  areaElements = elements;
  areaImagePath = imagePath || "";
  attachScreenshotNext = false;

  const primaryElement = elements.length > 0 ? elements[0] : {
    name: "Area Selection",
    type: "area",
    value: `Selected area (${rect.x1},${rect.y1}) to (${rect.x2},${rect.y2}) containing ${elements.length} elements`,
    bounds: { x: rect.x1, y: rect.y1, width: rect.x2 - rect.x1, height: rect.y2 - rect.y1 },
    children: [],
  };

  const context: ContextPayload = {
    element: primaryElement,
    surrounding: elements.slice(1, 30),
    cursorPos,
    imagePath,
    hasScreenshot: !!imagePath,
  };

  currentContext = context;
  lastContext = context;
  contextNeedsSending = true;
  hasSentFirstMessage = false;
  lastContextHash = computeContextHash(context, true, elements);
  client.resetSession();

  if (elements.length > 0) {
    setLastContextElement({
      automationId: elements[0].automationId,
      bounds: elements[0].bounds,
      name: elements[0].name,
      type: elements[0].type,
    });
  }

  log(`setAreaContext: ${elements.length} elements in rect (${rect.x1},${rect.y1})-(${rect.x2},${rect.y2}), image=${imagePath ? "yes" : "no"}`);
  return context;
}

export type ConfigChangeListener = (next: Config, prev: Config) => void;

let configChangeListener: ConfigChangeListener | null = null;

/**
 * Mutate the in-memory config and persist without firing the change listener.
 * Used for high-frequency updates (panel resize/move) that don't require
 * re-registering hotkeys or other side effects.
 */
export function patchConfigPersistOnly(patch: Partial<Config>): void {
  if (!appConfig) return;
  Object.assign(appConfig, patch);
  saveConfig(appConfig);
}

export function registerIpcHandlers(
  config: Config,
  showPanel: (context: ContextPayload) => void,
  hidePanel: () => void,
  onConfigChange?: ConfigChangeListener
): void {
  hidePanelFn = hidePanel;
  showPanelFn = showPanel;
  appConfig = config;
  configChangeListener = onConfigChange || null;
  const workingDir = config.workingDir || process.cwd();
  client = new OpenCodeClient(config.model || "opencode-go/kimi-k2.5", workingDir);
  log(`OpenCodeClient initialized: model=${config.model}, dir=${workingDir}`);

  ipcMain.on(IPC.DISMISS, () => {
    log("DISMISS received");
    hidePanel();
  });

  ipcMain.on(IPC.MINIMIZE, () => {
    log("MINIMIZE received — hiding panel, will notify when response arrives");
    hidePanel();
  });

  // WINDOW_MOVE IPC removed: dragging is handled natively via
  // `-webkit-app-region: drag` on the panel header. See App.tsx. Keeping the
  // IPC constant for backwards compatibility but the handler is intentionally
  // absent — renderer calls will be silently ignored.

  ipcMain.handle(IPC.GET_CONFIG, () => {
    log(`GET_CONFIG -> ${JSON.stringify(config)}`);
    return config;
  });

  ipcMain.handle(IPC.SET_CONFIG, (_e, newConfig: Partial<Config>) => {
    log(`SET_CONFIG received: ${JSON.stringify(newConfig)}`);
    const prev: Config = { ...config };
    if (newConfig.model) {
      const updated = [newConfig.model, ...config.recentModels.filter(m => m !== newConfig.model)].slice(0, 3);
      config.recentModels = updated;
      client.updateModel(newConfig.model);
    }
    Object.assign(config, newConfig, { recentModels: config.recentModels });
    if (newConfig.workingDir) {
      client = new OpenCodeClient(config.model, config.workingDir);
    }
    log(`Config updated: model=${config.model}, recentModels=${JSON.stringify(config.recentModels)}`);
    saveConfig(config);
    if (configChangeListener) {
      try { configChangeListener(config, prev); }
      catch (e: any) { log(`Config change listener threw: ${e.message}`); }
    }
    return config;
  });

  ipcMain.handle(IPC.VALIDATE_MODEL, async (_e, modelId: string) => {
    try {
      const opencodeBin = findOpenCodeBinPath();
      if (!opencodeBin) return { valid: false, error: "opencode not found" };
      const { execFile } = require("child_process");
      const cwd = appConfig.workingDir || os.homedir();
      const raw = await new Promise<string>((res, rej) => {
        execFile("node", [opencodeBin, "models"], { encoding: "utf-8", timeout: 30000, cwd, maxBuffer: 5*1024*1024 }, (err: any, stdout: string) => err ? rej(err) : res(stdout));
      });
      const allModels = raw.trim().split("\n").map((l: string) => l.trim()).filter(Boolean);
      const match = allModels.find((m: string) => m.toLowerCase() === modelId.toLowerCase());
      if (match) {
        return { valid: true, modelId: match };
      }
      const suggestions = allModels.filter((m: string) => m.toLowerCase().includes(modelId.split("/").pop()!.toLowerCase())).slice(0, 5);
      return { valid: false, error: `Model "${modelId}" not found`, suggestions };
    } catch (err: any) {
      return { valid: false, error: err.message };
    }
  });

  ipcMain.on(IPC.NEW_SESSION, () => {
    log("NEW_SESSION: resetting OpenCode session");
    client.resetSession();
    contextNeedsSending = true;
    hasSentFirstMessage = false;
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send(IPC.SESSION_RESET);
    }
  });

  ipcMain.on(IPC.STOP_RESPONSE, () => {
    log("STOP_RESPONSE received — killing active process");
    client.kill();
  });

  ipcMain.on(IPC.SEND_PROMPT, async (_e, prompt: string) => {
    log(`SEND_PROMPT: "${prompt.slice(0, 80)}..."`);
    log(`hasSession=${client.hasSession()}, contextNeedsSending=${contextNeedsSending}, hasSentFirstMessage=${hasSentFirstMessage}, isAreaContext=${isAreaContext}`);
    log(`currentContext is ${currentContext ? `set: element="${currentContext.element?.name}" type="${currentContext.element?.type}" area=${isAreaContext} image=${currentContext.imagePath ? currentContext.imagePath.slice(-40) : "none"}` : "NULL"}`);
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) {
      log("ERROR: No window found for SEND_PROMPT");
      return;
    }

    fullResponseText = "";

    const isFollowUp = hasSentFirstMessage && !contextNeedsSending;
    log(`isFollowUp=${isFollowUp} (hasSent=${hasSentFirstMessage}, needsSend=${contextNeedsSending})`);
    let fullPrompt: string;

    if (isFollowUp) {
      log("Follow-up message — skipping system prompt and context (already in session)");
      fullPrompt = prompt;
    } else {
      let contextBlock = "";
      if (isAreaContext && areaElements.length > 0) {
        contextBlock = `\n--- SCREEN CONTEXT (use this data for actions, do not describe it back to the user) ---\n`;
        if (currentContext?.windowInfo) {
          const wi = currentContext.windowInfo;
          contextBlock += `\nACTIVE WINDOW: "${wi.title}" (app: ${wi.processName})`;
          if (wi.processPath) {
            const appBasename = wi.processPath.split(/[\\/]/).pop() || wi.processPath;
            contextBlock += ` [${appBasename}]`;
          }
        }
        contextBlock += `\nAREA SELECTION with ${areaElements.length} elements:`;
        for (const el of areaElements) {
          const contained = (el as any).isContained !== false ? "inside" : "partial";
          contextBlock += `\n[${el.type}] Name: "${el.name}"`;
          if (el.value) contextBlock += `\n  Value: "${el.value.slice(0, 100)}"`;
          if (el.automationId) contextBlock += `\n  AutomationId: ${el.automationId}`;
          contextBlock += `\n  Bounds: ${el.bounds.x},${el.bounds.y} ${el.bounds.width}x${el.bounds.height} [${contained}]`;
        }
        if (areaImagePath) {
          contextBlock += `\n\n[A screenshot of this area is attached as an image]`;
        }
        contextBlock += `\n--- END CONTEXT ---\n`;
      } else if (currentContext) {
        const el = currentContext.element;
        contextBlock = `\n--- SCREEN CONTEXT (use this data for actions, do not describe it back to the user) ---\n`;
        if (currentContext.windowInfo) {
          const wi = currentContext.windowInfo;
          contextBlock += `\nACTIVE WINDOW: "${wi.title}" (app: ${wi.processName})`;
          if (wi.processPath) {
            const appBasename = wi.processPath.split(/[\\/]/).pop() || wi.processPath;
            contextBlock += ` [${appBasename}]`;
          }
        }
        contextBlock += `\nELEMENT YOU POINTED AT:`;
        contextBlock += `\n  Type: ${el.type}`;
        if (el.name) contextBlock += `\n  Name: "${el.name}"`;
        if (el.value) {
          const valPreview = el.value.length > 200 ? el.value.slice(0, 200) + "..." : el.value;
          contextBlock += `\n  Value: "${valPreview}"`;
        }
        if (el.automationId) contextBlock += `\n  AutomationId: ${el.automationId}`;
        if (el.className) contextBlock += `\n  Class: ${el.className}`;
        contextBlock += `\n  Bounds: ${el.bounds.x},${el.bounds.y} ${el.bounds.width}x${el.bounds.height}`;
        if (el._drilledFromContainer) {
          contextBlock += `\n  Note: Found inside a ${el.containerType || "container"} wrapper`;
        }
        if (el.parentChain && el.parentChain.length > 0) {
          contextBlock += `\n  Parent chain: ${el.parentChain.join(" > ")}`;
        }
        if (el.windowTitle) {
          contextBlock += `\n  Window: ${el.windowTitle}`;
        }

        if (currentContext.surrounding && currentContext.surrounding.length > 0) {
          contextBlock += `\n\nNEARBY & SCREEN ELEMENTS:`;
          for (const sib of currentContext.surrounding.slice(0, 25)) {
            contextBlock += `\n  - ${sib.type}`;
            if (sib.name) contextBlock += ` "${sib.name}"`;
            if (sib.value) {
              const sv = sib.value.length > 80 ? sib.value.slice(0, 80) + "..." : sib.value;
              contextBlock += ` value="${sv}"`;
            }
            if (sib.automationId) contextBlock += ` autoId=${sib.automationId}`;
            if (sib.bounds) contextBlock += ` @(${sib.bounds.x},${sib.bounds.y} ${sib.bounds.width}x${sib.bounds.height})`;
            if (sib._pctDist) {
              contextBlock += ` [${sib._pctDist} ${sib.direction || ""}]`;
            } else if (sib.distance !== undefined && sib.direction) {
              contextBlock += ` (${sib.distance}px ${sib.direction})`;
            }
            if (sib._relation === "screen") contextBlock += ` (screen)`;
          }
        }

        contextBlock += `\n\nCURSOR POSITION: ${currentContext.cursorPos.x}, ${currentContext.cursorPos.y}`;
        if (attachScreenshotNext && (currentContext.imagePath || areaImagePath)) {
          contextBlock += `\n\n[A screenshot showing what you pointed at is attached as an image]`;
        }
        contextBlock += `\n--- END CONTEXT ---\n`;
      }

      const systemPrefix = `${SYSTEM_PROMPT}\n\n`;
      fullPrompt = systemPrefix + contextBlock + `\n--- USER SETTING ---\nautoClickGuide: ${config.autoClickGuide ? "true" : "false"}\n--- END SETTING ---\n\n--- USER MESSAGE ---\n${prompt}\n--- END MESSAGE ---\n`;
    }

    contextNeedsSending = false;
    hasSentFirstMessage = true;

    const imageFiles: string[] = [];
    if (!isFollowUp) {
      if (isAreaContext && areaImagePath) {
        imageFiles.push(areaImagePath);
      }
    }
    if (attachScreenshotNext) {
      if (currentContext?.imagePath) {
        imageFiles.push(currentContext.imagePath);
        log(`Attaching screenshot per user request: ${currentContext.imagePath.slice(-40)}`);
      } else if (areaImagePath) {
        imageFiles.push(areaImagePath);
        log(`Attaching area screenshot per user request: ${areaImagePath.slice(-40)}`);
      }
    }
    attachScreenshotNext = false;

    let receivedAnyText = false;
    let timeoutFired = false;

    try {
      const sendPromise = client.sendMessage(fullPrompt, (event: OpenCodeEvent) => {
        if (timeoutFired) return;
        if (event.type === "text" && event.part?.text) {
          receivedAnyText = true;
        }
        handleOpenCodeEvent(event, win);
      }, imageFiles.length > 0 ? imageFiles : undefined);

      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!receivedAnyText) {
            log("TIMEOUT: No response after 2 minutes — killing process");
            timeoutFired = true;
            client.kill();
            win.webContents.send(IPC.STREAM_ERROR, "AI took too long to respond. Please try again.");
            resolve();
          } else {
            resolve();
          }
        }, 120000);
      });

      await Promise.race([sendPromise, timeoutPromise]);
      if (timeoutFired) return;
      log("OpenCode session completed");

      const { actions, blocked } = parseActionsFromResponse(fullResponseText);
      if (blocked.length > 0) {
        log(`Blocked ${blocked.length} disallowed action marker(s): ${blocked.map((b) => b.type).join(", ")}`);
        for (const b of blocked) {
          win.webContents.send(IPC.ACTION_RESULT, {
            action: { type: b.type },
            result: { success: false, error: `Blocked: ${b.reason}` },
          });
        }
      }
      if (actions.length > 0) {
        log(`Found ${actions.length} actions in response: ${actions.map((a) => a.type).join(", ")}`);
        for (const action of actions) {
          log(`Executing action: type=${action.type} selector=${action.selector || ""}`);
          const result: ActionResult = await executeAction(action);
          log(`Action result: success=${result.success}${result.error ? ` error=${result.error}` : ""}`);

          win.webContents.send(IPC.ACTION_RESULT, { action, result });

          if (!result.success) {
            lastFailedAction = action;
          }
        }
      }
      win.webContents.send(IPC.STREAM_DONE);
    } catch (err: any) {
      log(`ERROR from OpenCode: ${err.message}`);
      win.webContents.send(IPC.STREAM_ERROR, err.message || String(err));
    }
  });

  ipcMain.on(IPC.EXECUTE_ACTION, async (_e, payload: unknown) => {
    const win = BrowserWindow.getAllWindows()[0];
    const v = validateAction(payload);
    if ("error" in v) {
      log(`EXECUTE_ACTION REJECTED: ${v.error}`);
      if (win) {
        const rejectedType = typeof (payload as any)?.type === "string" ? (payload as any).type : "(unknown)";
        win.webContents.send(IPC.ACTION_RESULT, {
          action: { type: rejectedType },
          result: { success: false, error: `Blocked: ${v.error}` },
        });
      }
      return;
    }
    const action = v.action;
    log(`EXECUTE_ACTION: type=${action.type}`);
    const result = await executeAction(action);
    log(`Action result: success=${result.success}${result.error ? ` error=${result.error}` : ""}`);
    if (win) {
      win.webContents.send(IPC.ACTION_RESULT, { action, result });
    }
  });

  ipcMain.on(IPC.RETRY_ACTION, async (_e, payload: unknown) => {
    const win = BrowserWindow.getAllWindows()[0];
    const v = validateAction(payload);
    if ("error" in v) {
      log(`RETRY_ACTION REJECTED: ${v.error}`);
      if (win) {
        const rejectedType = typeof (payload as any)?.type === "string" ? (payload as any).type : "(unknown)";
        win.webContents.send(IPC.ACTION_RESULT, {
          action: { type: rejectedType },
          result: { success: false, error: `Blocked: ${v.error}` },
        });
      }
      return;
    }
    const action = v.action;
    log(`RETRY_ACTION: type=${action.type} selector=${action.selector || ""}`);
    const result = await executeAction(action);
    log(`Retry result: success=${result.success}${result.error ? ` error=${result.error}` : ""}`);
    if (win) {
      win.webContents.send(IPC.ACTION_RESULT, { action, result });
    }
  });

  ipcMain.on(IPC.ATTACH_SCREENSHOT, async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const sendStatus = (attached: boolean, hasImage: boolean) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.ATTACH_SCREENSHOT, { attached, hasImage });
      }
    };

    // Fast path: pointer/area hotkey already captured a screenshot in the
    // current context. Just flag it for inclusion on the next prompt.
    if (currentContext?.imagePath || areaImagePath) {
      log(`ATTACH_SCREENSHOT — reusing existing image (context=${!!currentContext?.imagePath}, area=${!!areaImagePath})`);
      attachScreenshotNext = true;
      sendStatus(true, true);
      return;
    }

    // Cold attach: no existing screenshot (user opened the panel from the
    // tray, or the original context had no image). Capture the display
    // the cursor is on right now. Hide the panel first so HoverBuddy
    // itself isn't in the screenshot.
    log("ATTACH_SCREENSHOT — no existing image, capturing full screen now");
    try {
      const { screen: electronScreen } = require("electron");
      const cursor = electronScreen.getCursorScreenPoint();
      const display = electronScreen.getDisplayNearestPoint(cursor);
      const sf = display.scaleFactor || 1;
      const b = display.bounds;
      const x1 = Math.round(b.x * sf);
      const y1 = Math.round(b.y * sf);
      const x2 = Math.round((b.x + b.width) * sf);
      const y2 = Math.round((b.y + b.height) * sf);

      const panelWasVisible = !!(win && !win.isDestroyed() && win.isVisible());
      if (panelWasVisible && win) {
        win.hide();
        // Give the Windows compositor a moment to actually remove the
        // frame before we call GDI+ CopyFromScreen. 80ms is empirically
        // enough on Win10/11; shorter occasionally leaves ghost pixels.
        await new Promise((r) => setTimeout(r, 80));
      }

      const imagePath = await captureAndOptimize(x1, y1, x2, y2);

      if (panelWasVisible && win && !win.isDestroyed()) {
        win.show();
      }

      if (!imagePath) {
        log("ATTACH_SCREENSHOT — capture returned null");
        sendStatus(false, false);
        return;
      }

      // Wire the captured image into the current context so the normal
      // send path picks it up via `currentContext.imagePath`. If there's
      // no context yet, create a minimal placeholder.
      if (currentContext) {
        if (currentContext.imagePath) cleanupImage(currentContext.imagePath);
        currentContext.imagePath = imagePath;
        currentContext.hasScreenshot = true;
      } else {
        currentContext = {
          element: {
            name: "User-attached screenshot",
            type: "screenshot",
            value: "",
            bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
            children: [],
          },
          surrounding: [],
          cursorPos: cursor,
          imagePath,
          hasScreenshot: true,
        };
        lastContext = currentContext;
      }
      attachScreenshotNext = true;
      log(`ATTACH_SCREENSHOT — captured ${imagePath.slice(-40)}`);
      sendStatus(true, true);
    } catch (err: any) {
      log(`ATTACH_SCREENSHOT FAILED: ${err.message}`);
      sendStatus(false, false);
    }
  });

  ipcMain.handle(IPC.RESTORE_SESSION, async () => {
    try {
      const opencodeBin = findOpenCodeBinPath();
      if (!opencodeBin) { log("restoreSession: bin not found"); return null; }
      const { execFile } = require("child_process");
      const cwd = config.workingDir || os.homedir();
      const listRaw = await new Promise<string>((res, rej) => {
        execFile("node", [opencodeBin, "session", "list", "--format", "json", "-n", "1"], { encoding: "utf-8", timeout: 10000, cwd, maxBuffer: 1024*1024 }, (err: any, stdout: string) => err ? rej(err) : res(stdout));
      });
      const sessions = JSON.parse(listRaw);
      if (!Array.isArray(sessions) || sessions.length === 0) { log("restoreSession: no sessions"); return null; }
      const sessionId = sessions[0].id;
      log(`restoreSession: latest=${sessionId.slice(0, 30)}`);
      const exportRaw = await new Promise<string>((res, rej) => {
        execFile("node", [opencodeBin, "export", sessionId], { encoding: "utf-8", timeout: 15000, cwd, maxBuffer: 5*1024*1024 }, (err: any, stdout: string) => err ? rej(err) : res(stdout));
      });
      const jsonStart = exportRaw.indexOf("{");
      if (jsonStart < 0) { log("restoreSession: no json"); return null; }
      const data = JSON.parse(exportRaw.slice(jsonStart));
      if (!data.messages?.length) { log("restoreSession: empty"); return null; }
      const history: { role: string; content: string }[] = [];
      for (const msg of data.messages) {
        if (!msg.parts) continue;
        const texts: string[] = [];
        for (const p of msg.parts) { if (p.type === "text" && p.text) texts.push(p.text); }
        if (texts.length === 0) continue;
        const role = msg.info?.role || "user";
        let content = texts.join("\n");
        if (role === "user") {
          const msgMatch = content.match(/--- USER MESSAGE ---\n([\s\S]*?)\n--- END MESSAGE ---/);
          if (msgMatch) content = msgMatch[1].trim();
        } else {
          content = cleanAssistantContent(content);
        }
        if (content.trim()) history.push({ role, content });
      }
      const trimmed = history.slice(-10);
      const win = BrowserWindow.getAllWindows()[0];
      if (win && trimmed.length > 0) win.webContents.send(IPC.SESSION_HISTORY, trimmed);
      client.setRestoredSession(sessionId);
      log(`restoreSession: restored ${sessionId.slice(0, 30)}, ${trimmed.length}/${history.length} messages`);
      return sessionId;
    } catch (err: any) { log(`restoreSession error: ${err.message}`); return null; }
  });

  log("All IPC handlers registered");

  cleanupOldSessions();
}

const MAX_SESSIONS = 5;

function cleanupOldSessions(): void {
  const opencodeBin = findOpenCodeBinPath();
  if (!opencodeBin) return;
  const { execFile } = require("child_process");
  const cwd = appConfig.workingDir || os.homedir();

  execFile("node", [opencodeBin, "session", "list", "--format", "json", "-n", "100"], { encoding: "utf-8", timeout: 15000, cwd, maxBuffer: 2*1024*1024 }, async (err: any, stdout: string) => {
    if (err) { log(`cleanupSessions list error: ${err.message}`); return; }
    try {
      const sessions = JSON.parse(stdout);
      if (!Array.isArray(sessions)) return;

      const ourSessions = sessions
        .filter((s: any) => s.directory === cwd)
        .sort((a: any, b: any) => b.created - a.created);

      if (ourSessions.length <= MAX_SESSIONS) {
        log(`cleanupSessions: ${ourSessions.length} sessions in ${cwd}, nothing to delete`);
        return;
      }

      const toDelete = ourSessions.slice(MAX_SESSIONS);
      log(`cleanupSessions: deleting ${toDelete.length} old sessions (keeping ${MAX_SESSIONS})`);

      for (const session of toDelete) {
        const delProc = spawn("node", [opencodeBin, "session", "delete", session.id], { cwd, stdio: "pipe" });
        let delStderr = "";
        delProc.stderr!.on("data", (d: Buffer) => { delStderr += d.toString(); });
        delProc.on("close", (code) => {
          if (code === 0) {
            log(`cleanupSessions: deleted ${session.id.slice(0, 30)}`);
          } else {
            log(`cleanupSessions: failed to delete ${session.id.slice(0, 30)}: exit=${code} ${delStderr.slice(0, 100)}`);
          }
        });
      }
    } catch (parseErr: any) {
      log(`cleanupSessions parse error: ${parseErr.message}`);
    }
  });
}

function filterToolArtifactLines(text: string): string {
  let clean = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<skill_content[\s\S]*?<\/skill_content>/gi, "")
    .replace(/<skill[\s\S]*?<\/skill>/gi, "");
  const lines = clean.split("\n");
  const filtered = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^⚙\s/.test(trimmed)) return false;
    if (/^(Thinking|Thought|Action|Observation)\s*:/i.test(trimmed)) return false;
    if (/^playwright_|^browser_|^web_search|^mcp__|^skill\b|^tool_/.test(trimmed)) return false;
    if (/^\[[\w_]+\]/.test(trimmed) && /playwright|browser|tool|search|skill/i.test(trimmed)) return false;
    if (/operational mode has changed/i.test(trimmed)) return false;
    if (/no longer in read-only mode/i.test(trimmed)) return false;
    if (/permitted to make file changes/i.test(trimmed)) return false;
    if (/permitted to.*run shell commands/i.test(trimmed)) return false;
    if (/permitted to.*utilize.*tools/i.test(trimmed)) return false;
    return true;
  });
  return filtered.join("\n");
}

function cleanAssistantContent(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<skill_content[\s\S]*?<\/skill_content>/gi, "")
    .replace(/<skill[\s\S]*?<\/skill>/gi, "")
    .replace(/\[skill\][\s\S]*?\[\/skill\]/gi, "")
    .replace(/<!--ACTION:[\s\S]*?-->/g, "")
    .trim();
}

function findOpenCodeBinPath(): string | null {
  const p = path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "opencode-ai", "bin", "opencode");
  if (fs.existsSync(p)) return p;
  try {
    const { execSync } = require("child_process");
    const prefix = execSync("npm config get prefix", { encoding: "utf-8" }).trim();
    const gp = path.join(prefix, "node_modules", "opencode-ai", "bin", "opencode");
    if (fs.existsSync(gp)) return gp;
  } catch {}
  return null;
}

function handleOpenCodeEvent(event: OpenCodeEvent, win: BrowserWindow): void {
  switch (event.type) {
    case "step_start":
      log("step_start");
      break;

    case "text":
      if (event.part?.text) {
        const raw = event.part.text;
        const filtered = filterToolArtifactLines(raw);
        if (filtered) {
          fullResponseText += filtered;
          log(`text: "${filtered.slice(0, 60)}..."`);
          win.webContents.send(IPC.STREAM_TOKEN, filtered);
        } else {
          log(`text filtered out (tool artifact): "${raw.slice(0, 60)}..."`);
        }
      }
      break;

    case "tool_use":
      if (event.part) {
        const toolName = event.part.tool || "unknown";
        const status = event.part.state?.status || "unknown";
        log(`tool_use: ${toolName} status=${status} (suppressed from display)`);
      }
      break;

    case "step_finish":
      log(`step_finish: reason=${event.part?.reason || "unknown"}`);
      if (event.part?.reason === "stop") {
        if (!win.isVisible() && lastContext) {
          log("Panel was hidden — auto-showing with last context");
          showPanelFn?.(lastContext);
        }
        showNotification("HoverBuddy", "AI response is ready");
      }
      break;

    case "error":
      log(`OpenCode error: ${event.error?.message}`);
      win.webContents.send(IPC.STREAM_ERROR, event.error?.message || "Unknown error");
      break;

    default:
      log(`unhandled event type: ${event.type}`);
  }
}