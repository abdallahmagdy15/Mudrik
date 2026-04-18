import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("hoverbuddy", {
  onContext: (cb: (data: any) => void) =>
    ipcRenderer.on("context-ready", (_e, data) => cb(data)),
  sendPrompt: (prompt: string) =>
    ipcRenderer.send("send-prompt", prompt),
  onStreamToken: (cb: (token: string) => void) =>
    ipcRenderer.on("stream-token", (_e, token) => cb(token)),
  onStreamDone: (cb: () => void) =>
    ipcRenderer.on("stream-done", () => cb()),
  onStreamError: (cb: (err: string) => void) =>
    ipcRenderer.on("stream-error", (_e, err) => cb(err)),
  onToolUse: (cb: (event: any) => void) =>
    ipcRenderer.on("tool-use", (_e, event) => cb(event)),
  onSessionReset: (cb: () => void) =>
    ipcRenderer.on("session-reset", () => cb()),
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
  onScreenshotAttached: (cb: (data: { attached: boolean; hasImage: boolean }) => void) =>
    ipcRenderer.on("attach-screenshot", (_e, data) => cb(data)),
  getConfig: () => ipcRenderer.invoke("get-config"),
  setConfig: (config: any) => ipcRenderer.invoke("set-config", config),
  restoreSession: () => ipcRenderer.invoke("restore-session"),
  onSessionHistory: (cb: (messages: any[]) => void) =>
    ipcRenderer.on("session-history", (_e, messages) => cb(messages)),
  stopResponse: () => ipcRenderer.send("stop-response"),
});