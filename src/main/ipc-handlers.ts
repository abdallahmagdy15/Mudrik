import { ipcMain, BrowserWindow } from "electron";
import { Config, ContextPayload, IPC, Action } from "../shared/types";
import { OllamaClient } from "./ollama-client";
import { SYSTEM_PROMPT } from "../shared/prompts";
import { executeAction, parseActionsFromResponse } from "./action-executor";

let ollama: OllamaClient;
let currentContext: ContextPayload | null = null;

export function registerIpcHandlers(
  config: Config,
  showPanel: (context: ContextPayload) => void,
  hidePanel: () => void
): void {
  ollama = new OllamaClient(config);

  ipcMain.on(IPC.DISMISS, () => {
    hidePanel();
  });

  ipcMain.handle(IPC.GET_CONFIG, () => config);

  ipcMain.handle(IPC.SET_CONFIG, (_e, newConfig: Partial<Config>) => {
    Object.assign(config, newConfig);
    ollama.updateConfig(config);
    return config;
  });

  ipcMain.on(IPC.CONTEXT_READY, (_e, context: ContextPayload) => {
    currentContext = context;
  });

  ipcMain.on(IPC.SEND_PROMPT, async (_e, prompt: string) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    const contextStr = currentContext
      ? `UI Element: ${JSON.stringify(currentContext.element)}\nSurrounding: ${JSON.stringify(currentContext.surrounding)}\nCursor: ${JSON.stringify(currentContext.cursorPos)}`
      : "No context available.";

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: `Context:\n${contextStr}\n\nUser prompt: ${prompt}`,
      },
    ];

    let fullResponse = "";
    try {
      for await (const token of ollama.chatStream(messages)) {
        fullResponse += token;
        win.webContents.send(IPC.STREAM_TOKEN, token);
      }
      win.webContents.send(IPC.STREAM_DONE);

      const actions = parseActionsFromResponse(fullResponse);
      if (actions.length > 0) {
        win.webContents.send(IPC.ACTION_RESULT, {
          pendingActions: actions,
        });
      }
    } catch (err: any) {
      win.webContents.send(IPC.STREAM_ERROR, err.message || String(err));
    }
  });

  ipcMain.on(IPC.EXECUTE_ACTION, async (_e, action: Action) => {
    const win = BrowserWindow.getAllWindows()[0];
    const result = await executeAction(action);
    if (win) {
      win.webContents.send(IPC.ACTION_RESULT, result);
    }
  });
}