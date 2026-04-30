import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("areaSelection", {
  cancel: () =>
    ipcRenderer.send("area-selection-cancel"),
  on: (channel: string, ...args: any[]) =>
    ipcRenderer.on(channel, (_event, ...a: any[]) => args[0](...a)),
});

ipcRenderer.send("area-selection-ready");
