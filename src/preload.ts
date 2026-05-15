import { contextBridge, ipcRenderer } from "electron";

// Buffer for context-ready messages that arrive before the renderer has
// registered its onContext callback. This happens on first-ever panel show:
// main sends CONTEXT_READY on `did-finish-load`, but React hasn't mounted
// yet so `ipcRenderer.on(...)` isn't hooked up. Without buffering, the very
// first area-selection silently drops its context and nothing renders.
let bufferedContext: any = null;
let contextCallback: ((data: any) => void) | null = null;
ipcRenderer.on("context-ready", (_e, data) => {
  if (contextCallback) {
    contextCallback(data);
  } else {
    bufferedContext = data;
  }
});

contextBridge.exposeInMainWorld("hoverbuddy", {
  onContext: (cb: (data: any) => void) => {
    contextCallback = cb;
    if (bufferedContext) {
      const pending = bufferedContext;
      bufferedContext = null;
      cb(pending);
    }
  },
  sendPrompt: (prompt: string) =>
    ipcRenderer.send("send-prompt", prompt),
  onStreamToken: (cb: (token: string) => void) =>
    ipcRenderer.on("stream-token", (_e, token) => cb(token)),
  onStreamTextReset: (cb: () => void) =>
    ipcRenderer.on("stream-text-reset", () => cb()),
  onStreamDone: (cb: () => void) =>
    ipcRenderer.on("stream-done", () => cb()),
  onStreamError: (cb: (err: string) => void) =>
    ipcRenderer.on("stream-error", (_e, err) => cb(err)),
  onToolUse: (cb: (event: any) => void) =>
    ipcRenderer.on("tool-use", (_e, event) => cb(event)),
  onSessionReset: (cb: (data?: { hasImage?: boolean }) => void) =>
    ipcRenderer.on("session-reset", (_e, data) => cb(data)),
  executeAction: (action: any) =>
    ipcRenderer.send("execute-action", action),
  onActionResult: (cb: (result: any) => void) =>
    ipcRenderer.on("action-result", (_e, result) => cb(result)),
  retryAction: (action: any) =>
    ipcRenderer.send("retry-action", action),
  dismiss: () => ipcRenderer.send("dismiss"),
  minimize: () => ipcRenderer.send("minimize"),
  windowMove: (deltaX: number, deltaY: number) => ipcRenderer.send("window-move", deltaX, deltaY),
  newSession: () => ipcRenderer.send("new-session"),
  onFocusInput: (cb: () => void) =>
    ipcRenderer.on("focus-input", () => cb()),
  attachScreenshot: () => ipcRenderer.send("attach-screenshot"),
  removeScreenshot: () => ipcRenderer.send("remove-screenshot"),
  onScreenshotAttached: (cb: (data: { attached: boolean; hasImage: boolean }) => void) =>
    ipcRenderer.on("attach-screenshot", (_e, data) => cb(data)),
  getConfig: () => ipcRenderer.invoke("get-config"),
  setConfig: (config: any) => ipcRenderer.invoke("set-config", config),
  restoreSession: () => ipcRenderer.invoke("restore-session"),
  onSessionHistory: (cb: (messages: any[]) => void) =>
    ipcRenderer.on("session-history", (_e, messages) => cb(messages)),
  stopResponse: () => ipcRenderer.send("stop-response"),
  validateModel: (model: string) => ipcRenderer.invoke("validate-model", model),
  saveApiKey: (provider: string, key: string) =>
    ipcRenderer.invoke("save-api-key", provider, key),
  removeModel: (modelId: string) => ipcRenderer.invoke("remove-model", modelId),
  onCursorPos: (cb: (pos: { x: number; y: number }) => void) =>
    ipcRenderer.on("cursor-pos", (_e, pos) => cb(pos)),
  guideUserChoice: (option: string) =>
    ipcRenderer.send("guide-user-choice", option),
  hidePanel: () => ipcRenderer.send("dismiss"),
  onContextLoading: (cb: (loading: boolean) => void) =>
    ipcRenderer.on("context-loading", (_e, loading) => cb(loading)),
  onGuideStateUpdate: (cb: (state: any) => void) =>
    ipcRenderer.on("guide-state-update", (_e, state) => cb(state)),
});