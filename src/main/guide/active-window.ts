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
const _GetForegroundWindow = user32.func("void* __stdcall GetForegroundWindow()");

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
