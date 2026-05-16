// Preload for the guide overlay BrowserWindow. Bridges IPC events from
// the main process into the renderer (which has nodeIntegration:false).

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("guideOverlay", {
  onShow: (handler: (payload: { target: any; fromCursor: any }) => void) => {
    ipcRenderer.on("guide-overlay-show", (_event, payload) => handler(payload));
  },
  onHide: (handler: () => void) => {
    ipcRenderer.on("guide-overlay-hide", () => handler());
  },
  onLoadingShow: (handler: (payload: { text?: string }) => void) => {
    ipcRenderer.on("guide-overlay-loading-show", (_event, payload) => handler(payload || {}));
  },
  onLoadingHide: (handler: () => void) => {
    ipcRenderer.on("guide-overlay-loading-hide", () => handler());
  },
});
