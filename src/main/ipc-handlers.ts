import { ipcMain, BrowserWindow } from "electron";
import { Config, ContextPayload, IPC, Action } from "../shared/types";
import { OpenCodeClient, OpenCodeEvent } from "./opencode-client";
import { SYSTEM_PROMPT } from "../shared/prompts";
import { executeAction, parseActionsFromResponse, ActionResult, setLastContextElement } from "./action-executor";
import { showNotification } from "./tray";
import { cleanupImage } from "./vision";

import { log } from "./logger";

function computeContextHash(context: ContextPayload | null, isArea: boolean, areaEls: any[]): string {
  if (!context) return "";
  const el = context.element;
  const imageLen = context.imagePath ? 1 : 0;
  const areaCount = areaEls.length;
  return `${isArea}:${el.type}:${el.name}:${el.value?.slice(0, 50)}:${imageLen}:${areaCount}`;
}

let client: OpenCodeClient;
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
let promptCountSinceContextChange: number = 0;
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
    promptCountSinceContextChange = 0;
    log(`setContext: same element context, keeping session (hash=${newHash})`);
  } else {
    promptCountSinceContextChange = 0;
    lastContextHash = newHash;
    client.resetSession();
    log(`setContext: new context, resetting session (hash=${newHash})`);
  }

  setLastContextElement({
    automationId: context.element?.automationId,
    bounds: context.element?.bounds,
    name: context.element?.name,
    type: context.element?.type,
  });
  log(`setContext: element type="${context.element?.type}" name="${context.element?.name}" automationId="${context.element?.automationId || ""}"`);
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !isSameContext) {
    win.webContents.send(IPC.SESSION_RESET);
  }
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
  promptCountSinceContextChange = 0;
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

export function registerIpcHandlers(
  config: Config,
  showPanel: (context: ContextPayload) => void,
  hidePanel: () => void
): void {
  hidePanelFn = hidePanel;
  showPanelFn = showPanel;
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

  ipcMain.on(IPC.WINDOW_MOVE, (_e, deltaX: number, deltaY: number) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      const [x, y] = win.getPosition();
      win.setPosition(x + deltaX, y + deltaY);
    }
  });

  ipcMain.handle(IPC.GET_CONFIG, () => {
    log(`GET_CONFIG -> ${JSON.stringify(config)}`);
    return config;
  });

  ipcMain.handle(IPC.SET_CONFIG, (_e, newConfig: Partial<Config>) => {
    log(`SET_CONFIG received: ${JSON.stringify(newConfig)}`);
    Object.assign(config, newConfig);
    if (newConfig.model) {
      client.updateModel(newConfig.model);
    }
    if (newConfig.workingDir) {
      client = new OpenCodeClient(config.model, config.workingDir);
    }
    log(`Config updated: ${JSON.stringify(config)}`);
    return config;
  });

  ipcMain.on(IPC.NEW_SESSION, () => {
    log("NEW_SESSION: resetting OpenCode session");
    client.resetSession();
    promptCountSinceContextChange = 0;
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send(IPC.SESSION_RESET);
    }
  });

  ipcMain.on(IPC.SEND_PROMPT, async (_e, prompt: string) => {
    log(`SEND_PROMPT: "${prompt.slice(0, 80)}..."`);
    log(`hasSession=${client.hasSession()}, promptCount=${promptCountSinceContextChange}, isAreaContext=${isAreaContext}`);
    log(`currentContext is ${currentContext ? `set: element="${currentContext.element?.name}" type="${currentContext.element?.type}" area=${isAreaContext} image=${currentContext.imagePath ? currentContext.imagePath.slice(-40) : "none"}` : "NULL"}`);
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) {
      log("ERROR: No window found for SEND_PROMPT");
      return;
    }

    fullResponseText = "";

    const isFollowUp = client.hasSession() && promptCountSinceContextChange > 0;
    log(`isFollowUp=${isFollowUp} (hasSession=${client.hasSession()}, promptCount=${promptCountSinceContextChange})`);
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
          contextBlock += `\n\nNEARBY ELEMENTS:`;
          for (const sib of currentContext.surrounding.slice(0, 15)) {
            contextBlock += `\n  - ${sib.type}`;
            if (sib.name) contextBlock += ` "${sib.name}"`;
            if (sib.value) {
              const sv = sib.value.length > 80 ? sib.value.slice(0, 80) + "..." : sib.value;
              contextBlock += ` value="${sv}"`;
            }
            if (sib.automationId) contextBlock += ` autoId=${sib.automationId}`;
            if (sib.distance !== undefined && sib.direction) {
              contextBlock += ` (${sib.distance}px ${sib.direction})`;
            }
          }
        }

        contextBlock += `\n\nCURSOR POSITION: ${currentContext.cursorPos.x}, ${currentContext.cursorPos.y}`;
        if (attachScreenshotNext && (currentContext.imagePath || areaImagePath)) {
          contextBlock += `\n\n[A screenshot showing what you pointed at is attached as an image]`;
        }
        contextBlock += `\n--- END CONTEXT ---\n`;
      }

      const systemPrefix = `${SYSTEM_PROMPT}\n\n`;
      fullPrompt = systemPrefix + contextBlock + `\n--- USER MESSAGE ---\n${prompt}\n--- END MESSAGE ---\n`;
    }

    promptCountSinceContextChange++;

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

    try {
      await client.sendMessage(fullPrompt, (event: OpenCodeEvent) => {
        handleOpenCodeEvent(event, win);
      }, imageFiles.length > 0 ? imageFiles : undefined);
      log("OpenCode session completed");

      const actions = parseActionsFromResponse(fullResponseText);
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

          if (action.type === "run_command") {
            const outputMsg = result.success
              ? `\n\n**Command:** \`${action.command}\`\n**Output:**\n\`\`\`\n${result.output || "(no output)"}\n\`\`\``
              : `\n\n**Command:** \`${action.command}\`\n**Error:**\n\`\`\`\n${result.error || "unknown error"}\n\`\`\``;
            win.webContents.send(IPC.STREAM_TOKEN, outputMsg);
          }
        }
      }
      win.webContents.send(IPC.STREAM_DONE);
    } catch (err: any) {
      log(`ERROR from OpenCode: ${err.message}`);
      win.webContents.send(IPC.STREAM_ERROR, err.message || String(err));
    }
  });

  ipcMain.on(IPC.EXECUTE_ACTION, async (_e, action: Action) => {
    log(`EXECUTE_ACTION: type=${action.type}`);
    const win = BrowserWindow.getAllWindows()[0];
    const result = await executeAction(action);
    log(`Action result: success=${result.success}${result.error ? ` error=${result.error}` : ""}`);
    if (win) {
      win.webContents.send(IPC.ACTION_RESULT, { action, result });
    }
  });

  ipcMain.on(IPC.RETRY_ACTION, async (_e, action: Action) => {
    log(`RETRY_ACTION: type=${action.type} selector=${action.selector || ""}`);
    const win = BrowserWindow.getAllWindows()[0];
    const result = await executeAction(action);
    log(`Retry result: success=${result.success}${result.error ? ` error=${result.error}` : ""}`);
    if (win) {
      win.webContents.send(IPC.ACTION_RESULT, { action, result });
    }
  });

  ipcMain.on(IPC.ATTACH_SCREENSHOT, () => {
    const hasImage = !!(currentContext?.imagePath || areaImagePath);
    log(`ATTACH_SCREENSHOT received — hasImage=${hasImage} (context=${!!currentContext?.imagePath}, area=${!!areaImagePath}), will include with next prompt`);
    if (hasImage) {
      attachScreenshotNext = true;
    }
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send(IPC.ATTACH_SCREENSHOT, { attached: hasImage, hasImage });
    }
  });

  log("All IPC handlers registered");
}

function handleOpenCodeEvent(event: OpenCodeEvent, win: BrowserWindow): void {
  switch (event.type) {
    case "step_start":
      log("step_start");
      break;

    case "text":
      if (event.part?.text) {
        const text = event.part.text;
        fullResponseText += text;
        log(`text: "${text.slice(0, 60)}..."`);
        win.webContents.send(IPC.STREAM_TOKEN, text);
      }
      break;

    case "tool_use":
      if (event.part) {
        const toolName = event.part.tool || "unknown";
        const status = event.part.state?.status || "unknown";
        const input = event.part.state?.input;
        const output = event.part.state?.output;
        log(`tool_use: ${toolName} status=${status}`);

        const toolEvent = {
          tool: toolName,
          status,
          input,
          output: output ? output.slice(0, 500) : undefined,
        };
        win.webContents.send(IPC.TOOL_USE, toolEvent);

        if (status === "completed" && input && toolName === "bash") {
          const cmd = input.command || input.description || "";
          const outText = output || "(no output)";
          const formatted = `\n> \`${cmd}\`\n\`\`\`\n${outText.slice(0, 2000)}\n\`\`\`\n`;
          win.webContents.send(IPC.STREAM_TOKEN, formatted);
          fullResponseText += formatted;
        } else if (status === "completed" && output) {
          const formatted = `\n[${toolName}]\n\`\`\`\n${output.slice(0, 500)}\n\`\`\`\n`;
          win.webContents.send(IPC.STREAM_TOKEN, formatted);
          fullResponseText += formatted;
        }
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