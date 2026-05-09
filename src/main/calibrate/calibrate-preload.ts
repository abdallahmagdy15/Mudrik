import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("calibrate", {
  capture: (hideWaitMs: number) => ipcRenderer.invoke("calibrate-capture", { hideWaitMs }),
  testTarget: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke("calibrate-test-target", bounds),
});
