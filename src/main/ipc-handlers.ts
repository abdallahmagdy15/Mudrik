import { ipcMain, BrowserWindow } from "electron";
import { Config, ContextPayload, IPC, Action } from "../shared/types";
import { OllamaClient } from "./ollama-client";
import { SYSTEM_PROMPT } from "../shared/prompts";
import { executeAction, parseActionsFromResponse } from "./action-executor";

const log = (msg: string) => console.log(`[IPC] ${msg}`);

let ollama: OllamaClient;
let currentContext: ContextPayload | null = null;

export function registerIpcHandlers(
  config: Config,
  showPanel: (context: ContextPayload) => void,
  hidePanel: () => void
): void {
  ollama = new OllamaClient(config);
  log("OllamaClient initialized");

  ipcMain.on(IPC.DISMISS, () => {
    log("DISMISS received");
    hidePanel();
  });

  ipcMain.handle(IPC.GET_CONFIG, () => {
    log(`GET_CONFIG -> ${JSON.stringify(config)}`);
    return config;
  });

  ipcMain.handle(IPC.SET_CONFIG, (_e, newConfig: Partial<Config>) => {
    log(`SET_CONFIG received: ${JSON.stringify(newConfig)}`);
    Object.assign(config, newConfig);
    ollama.updateConfig(config);
    log(`Config updated: ${JSON.stringify(config)}`);
    return config;
  });

  ipcMain.on(IPC.CONTEXT_READY, (_e, context: ContextPayload) => {
    log(`CONTEXT_READY received from renderer: element=${context.element?.type}`);
    currentContext = context;
  });

  ipcMain.on(IPC.SEND_PROMPT, async (_e, prompt: string) => {
    log(`SEND_PROMPT received: "${prompt.slice(0, 80)}..."`);
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) {
      log("ERROR: No window found for SEND_PROMPT");
      return;
    }

    const contextStr = currentContext
      ? `UI Element: ${JSON.stringify(currentContext.element)}\nSurrounding: ${JSON.stringify(currentContext.surrounding)}\nCursor: ${JSON.stringify(currentContext.cursorPos)}`
      : "No context available.";

    log(`Context string length: ${contextStr.length}`);

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: `Context:\n${contextStr}\n\nUser prompt: ${prompt}`,
      },
    ];

    log(`Sending to Ollama, model=${config.model}, ollamaUrl=${config.ollamaUrl}`);
    let fullResponse = "";
    try {
      for await (const token of ollama.chatStream(messages)) {
        fullResponse += token;
        win.webContents.send(IPC.STREAM_TOKEN, token);
      }
      log(`Stream complete, total response length: ${fullResponse.length}`);
      win.webContents.send(IPC.STREAM_DONE);

      const actions = parseActionsFromResponse(fullResponse);
      if (actions.length > 0) {
        log(`Found ${actions.length} actions in response: ${actions.map((a) => a.type).join(", ")}`);
        win.webContents.send(IPC.ACTION_RESULT, {
          pendingActions: actions,
        });
      }
    } catch (err: any) {
      log(`ERROR streaming from Ollama: ${err.message}`);
      win.webContents.send(IPC.STREAM_ERROR, err.message || String(err));
    }
  });

  ipcMain.on(IPC.EXECUTE_ACTION, async (_e, action: Action) => {
    log(`EXECUTE_ACTION received: type=${action.type}, text=${action.text?.slice(0, 50)}...`);
    const win = BrowserWindow.getAllWindows()[0];
    const result = await executeAction(action);
    log(`Action result: success=${result.success}${result.error ? ` error=${result.error}` : ""}`);
    if (win) {
      win.webContents.send(IPC.ACTION_RESULT, result);
    }
  });

  log("All IPC handlers registered");
}