import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import * as childProcess from "node:child_process";

// Mock spawn to inject a fake process we control.
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof childProcess>("node:child_process");
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

// Mock the logger so tests don't try to write to the real log file.
vi.mock("../logger", () => ({
  log: vi.fn(),
}));

import { startMouseHook, stopMouseHook } from "./mouse-hook";

describe("mouse-hook", () => {
  let fakeProc: any;

  beforeEach(() => {
    fakeProc = new EventEmitter();
    fakeProc.stdout = new Readable({ read() {} });
    fakeProc.stderr = new Readable({ read() {} });
    fakeProc.kill = vi.fn();
    (childProcess.spawn as any).mockReturnValue(fakeProc);
  });

  afterEach(() => {
    stopMouseHook();
    vi.clearAllMocks();
  });

  it("invokes the click handler when the PS process emits a JSON line for the scoped HWND", async () => {
    const handler = vi.fn();
    await startMouseHook({ scopeHwnd: 1234, onClick: handler });
    fakeProc.stdout.push(
      JSON.stringify({ x: 100, y: 200, button: "left", hwnd: 1234 }) + "\n"
    );
    // Let the listener flush
    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledWith({ x: 100, y: 200, button: "left" });
  });

  it("ignores clicks outside the scoped HWND", async () => {
    const handler = vi.fn();
    await startMouseHook({ scopeHwnd: 1234, onClick: handler });
    fakeProc.stdout.push(
      JSON.stringify({ x: 100, y: 200, button: "left", hwnd: 9999 }) + "\n"
    );
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
  });

  it("buffers partial JSON lines until the newline arrives", async () => {
    const handler = vi.fn();
    await startMouseHook({ scopeHwnd: 1234, onClick: handler });
    // Write half the JSON, then the rest with newline
    const payload = JSON.stringify({ x: 50, y: 60, button: "right", hwnd: 1234 });
    fakeProc.stdout.push(payload.slice(0, 10));
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
    fakeProc.stdout.push(payload.slice(10) + "\n");
    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledWith({ x: 50, y: 60, button: "right" });
  });

  it("stopMouseHook kills the active process", async () => {
    await startMouseHook({ scopeHwnd: 1234, onClick: vi.fn() });
    stopMouseHook();
    expect(fakeProc.kill).toHaveBeenCalled();
  });

  it("startMouseHook called twice replaces the previous hook", async () => {
    const fakeProc1 = fakeProc;
    await startMouseHook({ scopeHwnd: 1, onClick: vi.fn() });

    // Set up a second fake process for the second call
    const fakeProc2: any = new EventEmitter();
    fakeProc2.stdout = new Readable({ read() {} });
    fakeProc2.stderr = new Readable({ read() {} });
    fakeProc2.kill = vi.fn();
    (childProcess.spawn as any).mockReturnValueOnce(fakeProc2);

    await startMouseHook({ scopeHwnd: 2, onClick: vi.fn() });

    expect(fakeProc1.kill).toHaveBeenCalled();
  });

  it("ignores malformed JSON lines without crashing", async () => {
    const handler = vi.fn();
    await startMouseHook({ scopeHwnd: 1234, onClick: handler });
    fakeProc.stdout.push("not json\n");
    fakeProc.stdout.push(
      JSON.stringify({ x: 1, y: 2, button: "left", hwnd: 1234 }) + "\n"
    );
    await new Promise((r) => setImmediate(r));
    // Garbage line ignored; valid line still fires
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ x: 1, y: 2, button: "left" });
  });
});
