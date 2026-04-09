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
  executeAction: (action: any) =>
    ipcRenderer.send("execute-action", action),
  onActionResult: (cb: (result: any) => void) =>
    ipcRenderer.on("action-result", (_e, result) => cb(result)),
  dismiss: () => ipcRenderer.send("dismiss"),
  getConfig: () => ipcRenderer.invoke("get-config"),
  setConfig: (config: any) => ipcRenderer.invoke("set-config", config),
});