import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("calibrate", {
  capture: (hideWaitMs: number) => ipcRenderer.invoke("calibrate-capture", { hideWaitMs }),
  testTarget: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke("calibrate-test-target", bounds),
  getCursorPos: () => ipcRenderer.invoke("calibrate-get-cursor-pos") as Promise<{ x: number; y: number }>,
  getTimings: () => ipcRenderer.invoke("calibrate-get-timings") as Promise<Array<{
    label: string; totalMs: number;
    marks: Array<{ label: string; ms: number }>;
    timestamp: number;
  }>>,
  clearTimings: () => ipcRenderer.invoke("calibrate-clear-timings") as Promise<{ ok: boolean }>,
});
