import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("areaSelection", {
  complete: (x1: number, y1: number, x2: number, y2: number) =>
    ipcRenderer.send("area-selection-complete", x1, y1, x2, y2),
  cancel: () =>
    ipcRenderer.send("area-selection-cancel"),
});