// src/main/guide/active-window.ts
//
// Tiny koffi-based helper that returns the foreground window's HWND as a
// number. Used by the guide controller to scope the mouse hook to the user's
// active app (so clicks inside the panel don't fire the hook).
//
// Following the koffi loading pattern from src/main/area-selector.ts.
//
// Implementation note: we declare the return type as `void*` rather than
// `intptr_t` so that the koffi opaque-handle pattern matches the rest of
// the codebase. koffi returns an External pointer object for `void*`, and
// `koffi.address(ptr)` gives us the underlying integer as a BigInt — which
// we coerce to a JS number. HWND values fit comfortably in 53 bits on
// practical Windows configs.

import * as koffi from "koffi";

const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");
const _GetForegroundWindow = user32.func("void* __stdcall GetForegroundWindow()");
const _SetForegroundWindow = user32.func("bool __stdcall SetForegroundWindow(void*)");
const _ShowWindow = user32.func("bool __stdcall ShowWindow(void*, int)");
const _IsIconic = user32.func("bool __stdcall IsIconic(void*)");
const _BringWindowToTop = user32.func("bool __stdcall BringWindowToTop(void*)");
const _SetActiveWindow = user32.func("void* __stdcall SetActiveWindow(void*)");
const _SetFocus = user32.func("void* __stdcall SetFocus(void*)");
const _AttachThreadInput = user32.func("bool __stdcall AttachThreadInput(uint32, uint32, bool)");
const _GetWindowThreadProcessId = user32.func("uint32 __stdcall GetWindowThreadProcessId(void*, void*)");
const _GetCurrentThreadId = kernel32.func("uint32 __stdcall GetCurrentThreadId()");
// keybd_event for synthesized keyboard input. Sends to whatever window
// has foreground at the time of the call — so Mudrik must guarantee the
// target app is foreground when synthesizing Ctrl+V (handled by the
// pasteText caller via setForegroundHwnd + clickElement before this).
const _keybd_event = user32.func("void __stdcall keybd_event(uint8, uint8, uint32, uintptr_t)");
const VK_CONTROL = 0x11;
const VK_V = 0x56;
const KEYEVENTF_KEYUP = 0x0002;

const _sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Synthesizes a Ctrl+V keystroke directly from this process via
// user32!keybd_event. Replaces the previous robotjs-keyTap-then-PowerShell-
// fallback chain that had two compounding bugs:
//   1. robot.keyTap("v") throws "Invalid key code specified" on
//      robotjs 0.7.0 with newer Node versions (25.5+) — failure is 100%
//      reproducible in production logs.
//   2. The PowerShell fallback (sendCtrlVViaPowerShell) spawned PS which
//      briefly took foreground itself, so the keybd_event chord went to
//      the PS window instead of the user's target app. Result: paste
//      reported success but no text actually pasted (the AI then tried
//      set_value which had a similar problem with foreground state).
// keybd_event from this process targets the current foreground at call
// time — which IS the user's app after the preceding click via robotjs
// mouseClick (mouse clicks via robotjs work; only keyboard keyTap is
// broken). No PS spawn, no foreground steal, paste lands on Excel.
export async function sendCtrlV(): Promise<boolean> {
  try {
    _keybd_event(VK_CONTROL, 0, 0, 0n);
    await _sleep(20);
    _keybd_event(VK_V, 0, 0, 0n);
    await _sleep(20);
    _keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0n);
    await _sleep(20);
    _keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0n);
    return true;
  } catch {
    // Defensive: if keybd_event itself errored, also release modifiers
    // so we don't leave Ctrl stuck down.
    try { _keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0n); } catch {}
    return false;
  }
}

// Activates an HWND as the foreground window. Used by the guide-mode
// follow-up flow to re-foreground the user's target app (Excel, Chrome,
// etc.) AFTER Mudrik's panel hides, before capturing the next screenshot
// + UIA tree. Without this, Windows' default foreground transition picks
// whichever window is next in Z-order — frequently the Shell/Taskbar,
// not the user's actual app. Symptom: AI sees "active window != Excel"
// (or "unknown" with Taskbar candidates) and keeps telling the user to
// click on Excel in the taskbar instead of progressing the guide.
//
// Plain SetForegroundWindow often fails silently because Windows blocks
// foreground changes from processes that don't have "recent input"
// rights. The reliable workaround is AttachThreadInput — temporarily
// attach our thread to the current-foreground and target threads so
// Windows treats us as having input rights for both, set foreground,
// detach. This is the canonical pattern used by app launchers and IME
// switchers.
//
// Returns true if SetForegroundWindow returned non-zero. Failures are
// non-fatal — capture still happens, just without the explicit hint.
export async function setForegroundHwnd(hwnd: number): Promise<boolean> {
  if (!hwnd || hwnd === 0) return false;
  let curFgThread = 0;
  let targetThread = 0;
  let myThread = 0;
  try {
    myThread = _GetCurrentThreadId();
    const curFg = _GetForegroundWindow();
    if (curFg) curFgThread = _GetWindowThreadProcessId(curFg as any, null as any);
    targetThread = _GetWindowThreadProcessId(hwnd as any, null as any);
  } catch { /* best-effort — proceed without thread attach */ }

  let attachedFg = false;
  let attachedTarget = false;
  if (myThread && curFgThread && curFgThread !== myThread) {
    try { attachedFg = Boolean(_AttachThreadInput(myThread, curFgThread, true)); } catch {}
  }
  if (myThread && targetThread && targetThread !== myThread && targetThread !== curFgThread) {
    try { attachedTarget = Boolean(_AttachThreadInput(myThread, targetThread, true)); } catch {}
  }

  // Un-minimize ONLY if actually minimized. SW_RESTORE on a MAXIMIZED
  // window un-maximizes it — which is exactly what we don't want
  // (production bug: Excel was fullscreen, this call took it out of
  // fullscreen and the user perceived it as "Mudrik minimized my Excel").
  // IsIconic is the standard "is the window minimized" check.
  try {
    if (_IsIconic(hwnd as any)) {
      _ShowWindow(hwnd as any, 9); // SW_RESTORE
    }
  } catch {}
  let result = false;
  try {
    result = Boolean(_SetForegroundWindow(hwnd as any));
    // Belt-and-suspenders — these don't hurt if SetForegroundWindow
    // already worked, and they help when it didn't.
    try { _BringWindowToTop(hwnd as any); } catch {}
    try { _SetActiveWindow(hwnd as any); } catch {}
    try { _SetFocus(hwnd as any); } catch {}
  } catch { /* fall through */ }

  if (attachedFg) { try { _AttachThreadInput(myThread, curFgThread, false); } catch {} }
  if (attachedTarget) { try { _AttachThreadInput(myThread, targetThread, false); } catch {} }

  return result;
}

// Cache of the user's last-known target-app HWND. Set from ipc-handlers
// every time setContext runs (i.e. on every Alt+Space / Ctrl+Space) using
// the HWND that context-reader captured BEFORE Mudrik's panel showed.
//
// Action handlers (findElementBounds in action-executor-heavy) read this
// instead of calling getActiveHwnd() at execution time — at the moment an
// action runs, Mudrik's panel has just received the user's prompt and is
// itself the foreground window, so a fresh getActiveHwnd() returns
// MUDRIK's HWND, not the user's app. The PS find-element script then
// walks Mudrik's own tree (no Excel cells in there) and the action fails
// with "could not find UI element". The cached HWND is the user's actual
// target app — capture-time is the right time to ask "which window does
// this user mean?".
let lastUserAppHwnd: number = 0;

export function setLastUserAppHwnd(hwnd: number): void {
  if (hwnd && hwnd > 0) lastUserAppHwnd = hwnd;
}

export function getLastUserAppHwnd(): number {
  return lastUserAppHwnd;
}

export async function getActiveHwnd(): Promise<number> {
  const ptr = _GetForegroundWindow();
  // Fast paths for koffi versions that return a primitive directly.
  if (typeof ptr === "number") return ptr;
  if (typeof ptr === "bigint") return Number(ptr);
  // Buffer fallback (older koffi releases sometimes returned IntPtr as a Buffer).
  if (ptr && typeof (ptr as any).readBigUInt64LE === "function") {
    return Number((ptr as Buffer).readBigUInt64LE(0));
  }
  // koffi 2.x: void* returns an External object — use koffi.address() to read
  // the underlying integer (returned as BigInt).
  try {
    const addr = (koffi as any).address(ptr);
    if (typeof addr === "bigint") return Number(addr);
    if (typeof addr === "number") return addr;
  } catch {
    // fall through
  }
  // Last resort — can't read it, but the mouse hook will tolerate hwnd=0
  // (means "all windows", less ideal but functional).
  return 0;
}
