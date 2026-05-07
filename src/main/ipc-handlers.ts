import { ipcMain, BrowserWindow } from "electron";
import { Config, ContextPayload, IPC, Action, VisibleWindow } from "../shared/types";
import { OpenCodeClient, OpenCodeEvent } from "./opencode-client";
import { buildSystemPrompt } from "../shared/prompts";
import { buildCleanOpenCodeEnv, providerFromModelId, OpenCodeAuthFile } from "../shared/providers";

/**
 * OpenCode reads provider credentials from `<XDG_DATA_HOME>/opencode/auth.json`.
 * On Windows there's no native `XDG_DATA_HOME`, so OpenCode (and Mudrik)
 * fall back to `~/.local/share/opencode/auth.json` — same as Linux/macOS.
 */
function findOpenCodeAuthPath(): string {
  const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(xdgData, "opencode", "auth.json");
}

/**
 * Mirror Mudrik's apiKey changes into OpenCode's on-disk auth.json. Env-var
 * injection is enough to make a Mudrik-spawned `opencode run` use the right
 * key, but if the user later runs `opencode` from a terminal, they'd see a
 * stale or missing entry — so we keep the file in sync.
 *
 * `key === null` clears the entry. Only touches `type: "api"` rows so any
 * OAuth credentials written by `opencode auth login` survive untouched.
 */
function syncOpenCodeAuth(provider: string, key: string | null): void {
  const authPath = findOpenCodeAuthPath();
  let auth: OpenCodeAuthFile = {};
  try {
    if (fs.existsSync(authPath)) {
      const raw = fs.readFileSync(authPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") auth = parsed as OpenCodeAuthFile;
    }
  } catch (err: any) {
    log(`syncOpenCodeAuth: read failed (${err.message}) — starting fresh`);
  }

  const existing = auth[provider];
  if (existing && existing.type !== "api") {
    log(`syncOpenCodeAuth: skipping ${provider} — entry is type=${existing.type}, not API key`);
    return;
  }

  if (key) {
    auth[provider] = { type: "api", key };
  } else {
    delete auth[provider];
  }

  try {
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    fs.writeFileSync(authPath, JSON.stringify(auth, null, 2));
    log(`syncOpenCodeAuth: ${key ? "set" : "cleared"} ${provider} in ${authPath}`);
  } catch (err: any) {
    log(`syncOpenCodeAuth: write failed (${err.message}) — env-var injection still works for Mudrik-spawned runs`);
  }
}

/** True while a SEND_PROMPT cycle is in-flight. STOP_RESPONSE flips this so
 *  the "no text received" branch can stay quiet (the user knows they stopped
 *  it; surfacing a generic error would be misleading). */
let userStoppedCurrentResponse = false;
import { executeAction, parseActionsFromResponse, ActionResult, setLastContextElement, validateAction, isInteractiveAction } from "./action-executor";
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
// Mirror of the guide controller's phase, updated by onStateUpdate. Lets
// callers (auto-show suppression, onContext message preservation) gate on
// guide activity without forcing the lazy-loaded guide module to load.
let guidePhase: string = "idle";
function guideIsActive(): boolean {
  return guidePhase !== "idle";
}
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

/**
 * Attach an auto-captured screenshot to the current pointer context.
 * Called from the main hotkey flow when `autoAttachImage` is enabled.
 * Sets the imagePath on currentContext + arms the `attachScreenshotNext`
 * flag so the next SEND_PROMPT includes the image.
 */
export function attachAutoScreenshot(imagePath: string): void {
  if (currentContext) {
    if (currentContext.imagePath && currentContext.imagePath !== imagePath) {
      cleanupImage(currentContext.imagePath);
    }
    currentContext.imagePath = imagePath;
    currentContext.hasScreenshot = true;
  } else {
    currentContext = {
      element: { name: "Auto-attached screenshot", type: "screenshot", value: "", bounds: { x: 0, y: 0, width: 0, height: 0 }, children: [] },
      surrounding: [],
      cursorPos: { x: 0, y: 0 },
      imagePath,
      hasScreenshot: true,
    };
    lastContext = currentContext;
  }
  attachScreenshotNext = true;
  log(`attachAutoScreenshot: image=${imagePath.slice(-40)}`);
}

/**
 * Returns the context that is *currently* active (i.e. the one most recently
 * set via setContext or setAreaContext). Used by deferred async work (like
 * pointer-flow image capture) to detect that the user has moved on to a
 * different element before pushing a stale update to the renderer.
 */
export function getCurrentContext(): ContextPayload | null {
  return currentContext;
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

function formatElementType(type: string): string {
  return type.replace("ControlType.", "");
}

function formatWindowTree(elements: { type: string; name: string; value: string; automationId?: string; bounds: { x: number; y: number; width: number; height: number }; depth?: number; isTarget?: boolean; isOffscreen?: boolean }[]): string {
  if (!elements || elements.length === 0) return "";
  const lines: string[] = [];
  for (const el of elements) {
    if (el.isOffscreen) continue;
    const indent = "  ".repeat(Math.max(0, el.depth || 0));
    const t = formatElementType(el.type);
    let line = `${indent}${t}`;
    if (el.name) line += ` "${el.name}"`;
    if (el.automationId) line += ` [${el.automationId}]`;
    if (el.value) {
      const v = el.value.length > 60 ? el.value.slice(0, 60) + "..." : el.value;
      line += `="${v}"`;
    }
    line += ` @(${el.bounds.x},${el.bounds.y} ${el.bounds.width}x${el.bounds.height})`;
    if (el.isTarget) line += ` \u2190 YOU ARE HERE`;
    lines.push(line);
  }
  return lines.join("\n");
}

/**
 * Lazy initializer for the auto-guide controller. Called when
 * `autoGuideEnabled` is true (at startup or when SET_CONFIG flips it).
 *
 * All `./guide/*` modules are loaded via `await import(...)` to keep them
 * out of the main bundle's startup cost — webpack splits them into a
 * separate chunk that's only fetched when the user enables Auto-Guide.
 */
async function initGuideControllerIfNeeded(): Promise<void> {
  if (!appConfig?.autoGuideEnabled) return;
  const ctrlMod = await import("./guide/guide-controller");
  if (ctrlMod.isControllerInitialized()) return; // already wired
  const overlayMod = await import("./guide/guide-overlay");
  const hookMod = await import("./guide/mouse-hook");
  const winMod = await import("./guide/active-window");
  const { getCursorPos } = await import("./context-reader");

  ctrlMod.getController({
    overlay: {
      show: overlayMod.showOverlay,
      hide: overlayMod.hideOverlay,
    },
    mouseHook: {
      start: hookMod.startMouseHook,
      stop: hookMod.stopMouseHook,
    },
    getActiveHwnd: winMod.getActiveHwnd,
    getCursorPos,
    sendFollowUp: async (prompt: string) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      // Send the follow-up through the existing OpenCode flow. The auto-execute
      // loop in SEND_PROMPT is NOT triggered here — guide_* markers in the
      // AI's response come back through handleOpenCodeEvent → text events
      // streamed to the renderer, then the main SEND_PROMPT path's
      // parseActionsFromResponse → executeAction → controller.handleAction.
      // For follow-ups initiated by the controller we mirror that pattern in
      // a slimmed-down form: stream tokens to the renderer for visibility,
      // accumulate the response text, and parse + dispatch guide markers.
      let buffer = "";
      await client.sendMessage(prompt, (event) => {
        handleOpenCodeEvent(event, win);
        if (event.type === "text" && event.part?.text) {
          buffer += event.part.text;
        }
      });
      try {
        const { actions } = parseActionsFromResponse(buffer);
        for (const action of actions) {
          if ((["guide_offer","guide_step","guide_complete","guide_abort"] as string[]).includes(action.type)) {
            const result = await executeAction(action, {
              actionsEnabled: appConfig.actionsEnabled,
              autoGuideEnabled: appConfig.autoGuideEnabled,
            });
            if (win && !win.isDestroyed()) {
              win.webContents.send(IPC.ACTION_RESULT, { action, result });
            }
          }
        }
      } catch (err: any) {
        log(`guide follow-up dispatch failed: ${err?.message || err}`);
      }
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.STREAM_DONE);
      }
    },
    buildFollowUpPrompt: async (actionDesc) => {
      // Recapture screen state at the user's current focal point so the AI
      // sees the post-action UI (e.g. the dialog that just opened), not the
      // pre-Alt+Space snapshot. Click events know exactly where; option
      // choices fall back to the live cursor position.
      const ctxReader = await import("./context-reader");
      const point =
        actionDesc.kind === "click"
          ? { x: actionDesc.x, y: actionDesc.y }
          : ctxReader.getCursorPos();
      let fresh: { element: any; windowInfo?: { title: string } } | null = null;
      try {
        fresh = await ctxReader.readContextAtPoint(point.x, point.y);
      } catch (err: any) {
        log(`buildFollowUpPrompt: recapture failed (${err?.message || err}) — falling back to cached context`);
      }
      const ctx = fresh || currentContext;
      const desc =
        actionDesc.kind === "click"
          ? `User clicked at (${actionDesc.x}, ${actionDesc.y}).`
          : `User chose option: "${actionDesc.choice}".`;
      const screen = ctx
        ? `Active window: ${ctx.windowInfo?.title || "unknown"}. Element under cursor: ${ctx.element?.name || "none"} (${ctx.element?.type || "?"}).`
        : "No screen context captured.";
      return `${desc}\n\n${screen}\n\nDecide the next guide marker (guide_step, guide_complete, or guide_abort).`;
    },
    onStateUpdate: (state) => {
      guidePhase = state.phase;
      log(`GUIDE_STATE_UPDATE phase=${state.phase} options=${JSON.stringify(state.options || [])} caption=${state.caption ? "yes" : "no"} summary=${state.summary ? "yes" : "no"}`);
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.GUIDE_STATE_UPDATE, state);
      }
    },
  });
  log("Guide controller initialized");
}

function formatVisibleWindows(windows: VisibleWindow[], activeWindowTitle?: string): string {
  if (!windows || windows.length === 0) return "";
  const lines: string[] = [];
  for (const w of windows) {
    let line = `  ${formatElementType(w.type)} "${w.name}" @(${w.bounds.x},${w.bounds.y} ${w.bounds.width}x${w.bounds.height})`;
    if (w.name && activeWindowTitle && w.name === activeWindowTitle) line += ` \u2190 ACTIVE`;
    lines.push(line);
  }
  return lines.join("\n");
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
  client = new OpenCodeClient(config.model || "ollama-cloud/gemini-3-flash-preview", workingDir, config.apiKeys);
  log(`OpenCodeClient initialized: model=${config.model}, dir=${workingDir}, keys=${Object.keys(config.apiKeys || {}).length}`);

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
      client = new OpenCodeClient(config.model, config.workingDir, config.apiKeys);
    }
    // If keys changed without a full client rebuild, propagate the new map.
    if (newConfig.apiKeys) {
      client.updateApiKeys(config.apiKeys);
    }
    log(`Config updated: model=${config.model}, recentModels=${JSON.stringify(config.recentModels)}`);
    saveConfig(config);
    if (configChangeListener) {
      try { configChangeListener(config, prev); }
      catch (e: any) { log(`Config change listener threw: ${e.message}`); }
    }
    // Initialize the auto-guide controller on the first false→true flip of
    // autoGuideEnabled. We don't tear down on the reverse flip — the
    // controller stays loaded but inactive. action-executor.ts gates guide
    // markers on the live cfg.autoGuideEnabled, so disabling the flag stops
    // new sessions immediately. Full teardown can be a future task.
    if (newConfig.autoGuideEnabled === true && !prev.autoGuideEnabled) {
      void initGuideControllerIfNeeded();
    }
    return config;
  });

  ipcMain.handle(IPC.VALIDATE_MODEL, async (_e, modelId: string) => {
    try {
      const opencodeBin = findOpenCodeBinPath();
      if (!opencodeBin) return { valid: false, error: "opencode not found" };
      const { execFile } = require("child_process");
      const cwd = appConfig.workingDir || os.homedir();
      const env = buildCleanOpenCodeEnv(process.env, config.apiKeys);
      const raw = await new Promise<string>((res, rej) => {
        execFile("node", [opencodeBin, "models"], { encoding: "utf-8", timeout: 30000, cwd, env, maxBuffer: 5*1024*1024 }, (err: any, stdout: string) => err ? rej(err) : res(stdout));
      });
      const allModels = raw.trim().split("\n").map((l: string) => l.trim()).filter(Boolean);
      const match = allModels.find((m: string) => m.toLowerCase() === modelId.toLowerCase());
      if (match) {
        return { valid: true, modelId: match };
      }
      // Miss — figure out whether it's the provider that isn't authed, vs the
      // model name being wrong on an authed provider. `allModels` lists every
      // model OpenCode can see right now; if NONE of them start with the same
      // provider prefix the user typed, the provider is likely unauthenticated
      // and the UI should offer an API-key input.
      const provider = providerFromModelId(modelId);
      const providerHasAnyModel = allModels.some((m: string) =>
        providerFromModelId(m).toLowerCase() === provider.toLowerCase(),
      );
      const needsAuth = !providerHasAnyModel && !!provider && provider !== modelId;
      const suggestions = allModels.filter((m: string) => m.toLowerCase().includes(modelId.split("/").pop()!.toLowerCase())).slice(0, 5);
      log(`VALIDATE_MODEL miss: modelId=${modelId}, provider=${provider}, needsAuth=${needsAuth}, suggestions=${suggestions.length}`);
      return {
        valid: false,
        error: needsAuth
          ? `Provider "${provider}" is not authenticated. Add an API key to use this model.`
          : `Model "${modelId}" not found`,
        suggestions,
        needsAuth,
        provider: needsAuth ? provider : undefined,
      };
    } catch (err: any) {
      return { valid: false, error: err.message };
    }
  });

  /**
   * Persist an API key for the named provider and refresh the OpenCode
   * client's env map so the next `opencode run` / `opencode models` call
   * sees it. Does NOT validate the key — OpenCode has no pre-flight test
   * endpoint, so a bad key surfaces as a runtime error on the first
   * message send. An empty key clears the entry.
   */
  ipcMain.handle(IPC.SAVE_API_KEY, (_e, provider: string, key: string) => {
    if (!provider) return { ok: false, error: "provider is required" };
    const normalized = provider.toLowerCase();
    const trimmed = (key || "").trim();
    const map = { ...(config.apiKeys || {}) };
    if (trimmed) {
      map[normalized] = trimmed;
    } else {
      delete map[normalized];
    }
    config.apiKeys = map;
    client.updateApiKeys(map);
    saveConfig(config);
    // Mirror into OpenCode's auth.json so a plain `opencode` invocation from
    // a terminal sees the same credentials Mudrik uses internally.
    syncOpenCodeAuth(normalized, trimmed || null);
    log(`SAVE_API_KEY: provider=${provider} (${trimmed ? "set" : "cleared"}), total providers=${Object.keys(map).length}`);
    return { ok: true };
  });

  /**
   * Remove a model from the recentModels list. If the removed entry was the
   * currently-active model, switch to the next remaining one (or keep the
   * current model if the list would become empty — we never let the user
   * orphan themselves).
   */
  ipcMain.handle(IPC.REMOVE_MODEL, (_e, modelToRemove: string) => {
    if (!modelToRemove) return config;
    const filtered = config.recentModels.filter((m) => m !== modelToRemove);
    if (filtered.length === 0) {
      log(`REMOVE_MODEL ignored: would empty the list (model=${modelToRemove})`);
      return config;
    }
    config.recentModels = filtered;
    if (modelToRemove === config.model) {
      config.model = filtered[0];
      client.updateModel(filtered[0]);
      log(`REMOVE_MODEL: removed current model ${modelToRemove}, switched to ${filtered[0]}`);
    } else {
      log(`REMOVE_MODEL: removed ${modelToRemove}, active model ${config.model} unchanged`);
    }
    // Cascade: if no remaining model uses this provider, drop the saved key
    // (both from Mudrik's config and OpenCode's auth.json) so the credential
    // doesn't sit on disk for a provider the user no longer wants.
    const removedProvider = providerFromModelId(modelToRemove).toLowerCase();
    const stillUsed = filtered.some((m) => providerFromModelId(m).toLowerCase() === removedProvider);
    if (!stillUsed && config.apiKeys && removedProvider in config.apiKeys) {
      const nextKeys = { ...config.apiKeys };
      delete nextKeys[removedProvider];
      config.apiKeys = nextKeys;
      client.updateApiKeys(nextKeys);
      syncOpenCodeAuth(removedProvider, null);
      log(`REMOVE_MODEL: cleared API key for provider=${removedProvider} (no remaining models use it)`);
    }
    saveConfig(config);
    return config;
  });

  ipcMain.on(IPC.NEW_SESSION, () => {
    log("NEW_SESSION: resetting OpenCode session — preserving context/image");
    client.resetSession();
    contextNeedsSending = true;
    hasSentFirstMessage = false;
    // Preserve currentContext, areaImagePath, isAreaContext, areaElements so
    // the user's selection and attached image carry into the new chat. If a
    // pointer-context screenshot is present, re-arm it for the next send
    // (area images reattach automatically via the isAreaContext branch).
    const hasPointerImage = !isAreaContext && !!currentContext?.imagePath;
    if (hasPointerImage) {
      attachScreenshotNext = true;
      log(`NEW_SESSION: re-arming pointer screenshot for next send`);
    }
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send(IPC.SESSION_RESET, { hasImage: hasPointerImage || (isAreaContext && !!areaImagePath) });
    }
  });

  ipcMain.on(IPC.STOP_RESPONSE, () => {
    log("STOP_RESPONSE received — killing active process");
    userStoppedCurrentResponse = true;
    client.kill();
    // Tell renderer the stream is done so it can drop the "thinking" UI.
    // No error message — the stop was deliberate.
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send(IPC.STREAM_DONE);
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
    userStoppedCurrentResponse = false;

    const isFollowUp = hasSentFirstMessage && !contextNeedsSending;
    log(`isFollowUp=${isFollowUp} (hasSent=${hasSentFirstMessage}, needsSend=${contextNeedsSending})`);
    log(`actionsEnabled=${config.actionsEnabled} (live — not snapshotted)`);
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
          const indent = "  ".repeat(Math.max(0, (el as any).depth || 0));
          const contained = el.isContained === true ? "inside" : "partial";
          let line = `${indent}${formatElementType(el.type)}`;
          if (el.name) line += ` "${el.name}"`;
          if (el.automationId) line += ` [${el.automationId}]`;
          if (el.value) line += `="${el.value.slice(0, 100)}"`;
          line += ` @(${el.bounds.x},${el.bounds.y} ${el.bounds.width}x${el.bounds.height})`;
          line += ` [${contained}]`;
          contextBlock += `\n${line}`;
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
        contextBlock += `\nCURSOR: ${currentContext.cursorPos.x}, ${currentContext.cursorPos.y}`;
        contextBlock += `\n\nYOU POINTED AT:`;
contextBlock += `\n  ${formatElementType(el.type)}`;
        if (el.name) contextBlock += ` "${el.name}"`;
        if (el.automationId) contextBlock += ` [${el.automationId}]`;
        contextBlock += ` @(${el.bounds.x},${el.bounds.y} ${el.bounds.width}x${el.bounds.height})`;
        if (el.value) {
          const MAX_TARGET_VALUE = 8000;
          const val = el.value.length > MAX_TARGET_VALUE ? el.value.slice(0, MAX_TARGET_VALUE) + `\n... (${el.value.length} chars total, showing first ${MAX_TARGET_VALUE})` : el.value;
          if (val.includes("\n")) {
            contextBlock += `\n  value:\n${val.split("\n").map((l: string) => `    ${l}`).join("\n")}`;
          } else if (val.length > 200) {
            contextBlock += `\n  value: ${val}`;
          } else {
            contextBlock += ` value="${val}"`;
          }
        }
        if (el.parentChain && el.parentChain.length > 0) {
          contextBlock += `\n  Hierarchy: ${el.parentChain.join(" > ")}`;
        }
        if (el.windowTitle) {
          contextBlock += `\n  Window: ${el.windowTitle}`;
        }

        if (currentContext.visibleWindows && currentContext.visibleWindows.length > 0) {
          contextBlock += `\n\nVISIBLE WINDOWS:`;
          contextBlock += "\n" + formatVisibleWindows(currentContext.visibleWindows, currentContext.windowInfo?.title);
        }

        if (currentContext.windowTree && currentContext.windowTree.length > 0) {
          contextBlock += `\n\nACTIVE WINDOW LAYOUT:`;
          contextBlock += "\n" + formatWindowTree(currentContext.windowTree);
        }

        if (attachScreenshotNext && (currentContext.imagePath || areaImagePath)) {
          contextBlock += `\n\n[A screenshot showing what you pointed at is attached as an image]`;
        }
contextBlock += `\n--- END CONTEXT ---\n`;
      }

      const MAX_CONTEXT_CHARS = 16000;
      if (contextBlock.length > MAX_CONTEXT_CHARS) {
        const targetSection = "YOU POINTED AT:";
        const targetIdx = contextBlock.indexOf(targetSection);
        if (targetIdx !== -1) {
          const beforeTarget = contextBlock.substring(0, targetIdx);
          const afterTarget = contextBlock.substring(targetIdx);
          const afterTargetEnd = afterTarget.indexOf("\n\nVISIBLE WINDOWS:");
          const afterTargetSection = afterTargetEnd !== -1 ? afterTarget.substring(0, afterTargetEnd) : afterTarget;
          const tail = afterTargetEnd !== -1 ? afterTarget.substring(afterTargetEnd) : "";
          const budget = MAX_CONTEXT_CHARS - beforeTarget.length - 200;
          const trimmed = afterTargetSection.length > budget ? afterTargetSection.substring(0, budget) + `\n... (value truncated at ${budget} chars)` : afterTargetSection;
          contextBlock = beforeTarget + trimmed + (tail ? "\n" + tail : "") + `\n--- END CONTEXT ---\n`;
        }
      }

      const systemPrefix = `${buildSystemPrompt({
        actionsEnabled: config.actionsEnabled,
        autoGuideEnabled: config.autoGuideEnabled,
      })}\n\n`;
      // Tell the AI about the current actions permission. The toggle is
      // LIVE — when the user flips it in settings, contextNeedsSending is
      // forced true so the very next message rebuilds this block with the
      // new value. Earlier turns of the same conversation may carry the
      // opposite instruction in their history; the model must trust THIS
      // block (the most recent system instruction) over older ones.
      const actionsBlock = config.actionsEnabled
        ? `\n--- USER SETTING ---\nactionsEnabled: true — you MAY emit interactive action markers (click, type, paste, press_keys, invoke, set_value, guide_to). This is the live, current setting; if earlier in this conversation you said you were in read-only mode, that instruction is now superseded.\n--- END SETTING ---\n`
        : `\n--- USER SETTING ---\nactionsEnabled: false — READ-ONLY MODE. Do NOT emit interactive action markers (click, type, paste, press_keys, invoke, set_value, guide_to) — they will be blocked and the user will see a "blocked" error. You MAY still emit copy_to_clipboard markers and COPY chips so the user can paste content themselves. This is the live, current setting; if earlier in this conversation you said actions were enabled, that instruction is now superseded. If the user wants to re-enable actions: tell them to toggle 'Allow desktop actions' in ⚙ settings — the change takes effect on their next message.\n--- END SETTING ---\n`;
      fullPrompt = systemPrefix + contextBlock + actionsBlock + `\n--- USER MESSAGE ---\n${prompt}\n--- END MESSAGE ---\n`;
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

    // Idle-based timeout: fires only after 5 minutes of *silence* from
    // OpenCode. Every event (step_start, tool_use, text, step_finish) resets
    // the timer — so heavy reasoning / slow-first-token models don't trip it
    // as long as they're making any progress. Once sendPromise resolves the
    // subprocess is done, we cancel the timer entirely so action execution
    // (which can take 30+ seconds for a chain of UIA paste/click ops) never
    // fires this error.
    const IDLE_TIMEOUT_MS = 300000; // 5 min
    let idleTimer: NodeJS.Timeout | null = null;
    const armIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timeoutFired = true;
        log(`TIMEOUT: No AI activity for ${IDLE_TIMEOUT_MS / 60000} minutes — killing process`);
        client.kill();
        win.webContents.send(IPC.STREAM_ERROR, "AI took too long to respond. Please try again.");
      }, IDLE_TIMEOUT_MS);
    };
    const stopIdleTimer = () => {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    };

    try {
      armIdleTimer();
      await client.sendMessage(fullPrompt, (event: OpenCodeEvent) => {
        if (timeoutFired) return;
        armIdleTimer(); // reset on every event — AI is still making progress
        if (event.type === "text" && event.part?.text) {
          receivedAnyText = true;
        }
        handleOpenCodeEvent(event, win);
      }, imageFiles.length > 0 ? imageFiles : undefined);

      // Subprocess is done. Action execution that follows can take as long
      // as it needs — no more idle timeout from this point on.
      stopIdleTimer();
      if (timeoutFired) return;
      log("OpenCode session completed");

      // If the process exited cleanly but produced zero text (e.g. Bun segfault
      // with exit code 0 suppressed), surface a friendly error instead of a
      // blank response. EXCEPT when the user explicitly hit Stop — that's a
      // deliberate cancellation, not a failure, and showing an error message
      // would be misleading.
      if (!receivedAnyText && fullResponseText.trim().length === 0) {
        if (userStoppedCurrentResponse) {
          log("No text received — but user manually stopped, skipping error");
        } else {
          log("No text received — sending friendly error");
          win.webContents.send(IPC.STREAM_ERROR, "No response was received from the AI. Please try again — if this keeps happening, restart Mudrik.");
        }
        return;
      }

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
          // Read-only mode guard. Interactive actions are blocked with a clear
          // reason; copy_to_clipboard still passes through.
          if (!config.actionsEnabled && isInteractiveAction(action.type)) {
            log(`BLOCKED (read-only): ${action.type}`);
            win.webContents.send(IPC.ACTION_RESULT, {
              action,
              result: { success: false, error: "Desktop actions are disabled (read-only mode). Toggle 'Allow desktop actions' in settings to enable." },
            });
            continue;
          }
          log(`Executing action: type=${action.type} selector=${action.selector || ""}`);
          const result: ActionResult = await executeAction(action, { actionsEnabled: config.actionsEnabled, autoGuideEnabled: config.autoGuideEnabled });
          log(`Action result: success=${result.success}${result.error ? ` error=${result.error}` : ""}`);

          win.webContents.send(IPC.ACTION_RESULT, { action, result });

          if (!result.success) {
            lastFailedAction = action;
          }
        }
      }
      win.webContents.send(IPC.STREAM_DONE);
    } catch (err: any) {
      stopIdleTimer();
      // If the timeout already surfaced an error to the user, swallow the
      // resulting "kill" rejection so we don't double-error.
      if (timeoutFired) return;
      const msg = err?.message || String(err);
      log(`ERROR from OpenCode: ${msg}`);
      if (msg.startsWith("exit:")) {
        const code = msg.replace("exit:", "");
        win.webContents.send(IPC.STREAM_ERROR, `Oops! The AI engine crashed (exit code ${code}). Please try again — if this keeps happening, restart Mudrik.`);
      } else {
        win.webContents.send(IPC.STREAM_ERROR, msg.length > 120 ? "Something went wrong. Please try again." : msg);
      }
    }
  });

  ipcMain.on(IPC.EXECUTE_ACTION, async (_e, payload: unknown) => {
    const win = BrowserWindow.getAllWindows()[0];
    const v = validateAction(payload, { actionsEnabled: config.actionsEnabled, autoGuideEnabled: config.autoGuideEnabled });
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
    if (!config.actionsEnabled && isInteractiveAction(action.type)) {
      log(`EXECUTE_ACTION BLOCKED (read-only): ${action.type}`);
      if (win) {
        win.webContents.send(IPC.ACTION_RESULT, {
          action,
          result: { success: false, error: "Desktop actions are disabled (read-only mode). Toggle 'Allow desktop actions' in settings to enable." },
        });
      }
      return;
    }
    log(`EXECUTE_ACTION: type=${action.type}`);

    // Hide panel before interactive actions so clicks/paste go to the target
    // window, not the panel. The panel covers the target and steals focus.
    if (win && isInteractiveAction(action.type)) {
      log('Hiding panel before interactive action');
      win.hide();
      win.blur();
      await new Promise((r) => setTimeout(r, 400)); // let target window regain focus
    }

    const result = await executeAction(action, { actionsEnabled: config.actionsEnabled, autoGuideEnabled: config.autoGuideEnabled });
    log(`Action result: success=${result.success}${result.error ? ` error=${result.error}` : ""}`);

    if (win && !win.isDestroyed()) {
      win.show();
      win.webContents.send(IPC.ACTION_RESULT, { action, result });
    }
  });

  ipcMain.on(IPC.RETRY_ACTION, async (_e, payload: unknown) => {
    const win = BrowserWindow.getAllWindows()[0];
    const v = validateAction(payload, { actionsEnabled: config.actionsEnabled, autoGuideEnabled: config.autoGuideEnabled });
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
    if (!config.actionsEnabled && isInteractiveAction(action.type)) {
      log(`RETRY_ACTION BLOCKED (read-only): ${action.type}`);
      if (win) {
        win.webContents.send(IPC.ACTION_RESULT, {
          action,
          result: { success: false, error: "Desktop actions are disabled (read-only mode). Toggle 'Allow desktop actions' in settings to enable." },
        });
      }
      return;
    }
    log(`RETRY_ACTION: type=${action.type} selector=${action.selector || ""}`);

    // Hide panel before interactive actions so clicks/paste go to the target
    if (win && isInteractiveAction(action.type)) {
      log('Hiding panel before retry action');
      win.hide();
      win.blur();
      await new Promise((r) => setTimeout(r, 400));
    }

    const result = await executeAction(action, { actionsEnabled: config.actionsEnabled, autoGuideEnabled: config.autoGuideEnabled });
    log(`Retry result: success=${result.success}${result.error ? ` error=${result.error}` : ""}`);

    if (win && !win.isDestroyed()) {
      win.show();
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

    // Area selections already captured the exact region the user drew, so
    // re-capturing the whole screen would throw that away. Re-use it.
    if (isAreaContext && areaImagePath) {
      log(`ATTACH_SCREENSHOT — re-using area image ${areaImagePath.slice(-40)}`);
      attachScreenshotNext = true;
      sendStatus(true, true);
      return;
    }

    // For pointer / no-context, always grab a FRESH full-screen capture
    // with the panel hidden. Reusing the pointer flow's focus crop gave the
    // user a confusing "this isn't what I just selected" experience; a
    // fresh hide → capture → show round-trip matches user expectation.
    log("ATTACH_SCREENSHOT — capturing full screen (fresh, panel hidden)");
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

  ipcMain.on(IPC.REMOVE_SCREENSHOT, () => {
    log("REMOVE_SCREENSHOT — clearing attached image and resetting session");
    // Delete the temp image file if it exists
    if (currentContext?.imagePath) {
      cleanupImage(currentContext.imagePath);
      currentContext.imagePath = undefined;
      currentContext.hasScreenshot = false;
    }
    if (areaImagePath) {
      cleanupImage(areaImagePath);
      areaImagePath = "";
    }
    attachScreenshotNext = false;
    // Reset the session so the old image's context doesn't leak into the next send
    client.resetSession();
    contextNeedsSending = true;
    hasSentFirstMessage = false;
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.SESSION_RESET, { hasImage: false });
    }
  });

  ipcMain.on(IPC.GUIDE_USER_CHOICE, async (_e, option: string) => {
    const m = await import("./guide/guide-controller");
    m.getController().handleUserChoice(option);
  });

  ipcMain.handle(IPC.RESTORE_SESSION, async () => {
    try {
      const opencodeBin = findOpenCodeBinPath();
      if (!opencodeBin) { log("restoreSession: bin not found"); return null; }
      const { execFile } = require("child_process");
      const cwd = config.workingDir || os.homedir();
      const env = buildCleanOpenCodeEnv(process.env, config.apiKeys);
      const listRaw = await new Promise<string>((res, rej) => {
        execFile("node", [opencodeBin, "session", "list", "--format", "json", "-n", "1"], { encoding: "utf-8", timeout: 10000, cwd, env, maxBuffer: 1024*1024 }, (err: any, stdout: string) => err ? rej(err) : res(stdout));
      });
      const sessions = JSON.parse(listRaw);
      if (!Array.isArray(sessions) || sessions.length === 0) { log("restoreSession: no sessions"); return null; }
      const sessionId = sessions[0].id;
      log(`restoreSession: latest=${sessionId.slice(0, 30)}`);
      const exportRaw = await new Promise<string>((res, rej) => {
        execFile("node", [opencodeBin, "export", sessionId], { encoding: "utf-8", timeout: 15000, cwd, env, maxBuffer: 5*1024*1024 }, (err: any, stdout: string) => err ? rej(err) : res(stdout));
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

  // Spin up the guide controller singleton if Auto-Guide is already on at
  // launch. Fire-and-forget — the dynamic imports resolve well before the
  // user can trigger a guide session.
  void initGuideControllerIfNeeded();

  cleanupOldSessions();
}

const MAX_SESSIONS = 5;

function cleanupOldSessions(): void {
  const opencodeBin = findOpenCodeBinPath();
  if (!opencodeBin) return;
  const { execFile } = require("child_process");
  const cwd = appConfig.workingDir || os.homedir();
  const env = buildCleanOpenCodeEnv(process.env, appConfig.apiKeys);

  execFile("node", [opencodeBin, "session", "list", "--format", "json", "-n", "100"], { encoding: "utf-8", timeout: 15000, cwd, env, maxBuffer: 2*1024*1024 }, async (err: any, stdout: string) => {
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
        const delProc = spawn("node", [opencodeBin, "session", "delete", session.id], { cwd, env, stdio: "pipe" });
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
    if (/^playwright_|^browser_|^mcp__|^skill\b|^tool_/.test(trimmed)) return false;
    if (/^\[[\w_]+\]/.test(trimmed) && /playwright|browser|tool|skill/i.test(trimmed)) return false;
    if (/operational mode has changed/i.test(trimmed)) return false;
    if (/no longer in read-only mode/i.test(trimmed)) return false;
    if (/permitted to make file changes/i.test(trimmed)) return false;
    if (/permitted to.*run shell commands/i.test(trimmed)) return false;
    if (/permitted to.*utilize.*tools/i.test(trimmed)) return false;
    return true;
  });
  return filtered.join("\n");
}

// Sanitizes assistant content for session-history replay to the renderer.
// Strips prompt-injection noise (system-reminder / skill blocks) but PRESERVES
// <!--ACTION:...--> markers — those are the model's action trail and belong
// in the conversation. The renderer hides them visually in parseMessageContent
// so they never render as raw text in the UI, but the original OpenCode
// session (and our in-memory history) keeps them intact.
function cleanAssistantContent(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<skill_content[\s\S]*?<\/skill_content>/gi, "")
    .replace(/<skill[\s\S]*?<\/skill>/gi, "")
    .replace(/\[skill\][\s\S]*?\[\/skill\]/gi, "")
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
          // Don't auto-show during an active guide — the panel was likely
          // hidden because the user is interacting with the underlying app
          // for the current step, and re-showing here fires CONTEXT_READY
          // which resets the renderer's chat state, making the user think a
          // new conversation started. The guide controller manages its own
          // visibility expectations via state updates.
          if (guideIsActive()) {
            log("Panel hidden during active guide — skipping auto-show");
          } else {
            log("Panel was hidden — auto-showing with last context");
            showPanelFn?.(lastContext);
          }
        }
        showNotification("Mudrik", "AI response is ready");
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