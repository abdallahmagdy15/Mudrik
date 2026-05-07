// src/main/guide/mouse-hook.ts
//
// Windows global low-level mouse hook bridge. Spawns a PowerShell process
// that registers WH_MOUSE_LL via SetWindowsHookEx and emits one JSON line
// per mouse-down event on stdout. Used by the guide controller to detect
// when the user clicked at the highlighted spot during STEP_ACTIVE.
//
// Captures position + button only — no keystrokes, no screen recording.
// The hook only runs while a guide step is active; the controller stops it
// on every transition out of STEP_ACTIVE.
//
// PowerShell script status:
//   The embedded script is a real WH_MOUSE_LL implementation. It has not yet
//   been exercised end-to-end on Windows — Task 6.2 is responsible for the
//   manual smoke test (alt-tab to a real app, click, observe Mudrik responding).
//   If the script needs tweaks (e.g. the message-pump approach has to switch
//   from PowerShell's `Wait-Event` loop to a P/Invoke `GetMessage` pump for
//   reliable delivery), bump the script-version constant below — that forces
//   already-installed users to get the new file the next time the hook runs.
//
// The TypeScript bridge below (parsing, scoping, lifecycle) is unit-tested
// via mocked `spawn`, independent of the PS script's runtime behaviour.

import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { log } from "../logger";

const HOOK_SCRIPT_NAME = "hoverbuddy-mouse-hook-v1.ps1";

// Real WH_MOUSE_LL implementation. Uses Add-Type once to compile a small
// C# helper that owns the hook delegate, the message pump, and a thread-safe
// queue of pending click events. PowerShell drains the queue and writes a
// JSON line per event to stdout. This split keeps the .NET delegate strongly
// rooted (a common pitfall: PS-only delegates get GC'd while still hooked).
const HOOK_SCRIPT_CONTENT = `# hoverbuddy-mouse-hook-v1.ps1
# Global low-level mouse hook (WH_MOUSE_LL). Emits one JSON line per
# mouse-down event to stdout, of the form:
#   {"x":N,"y":N,"button":"left|right|middle","hwnd":N}
# where hwnd is the top-level window under the cursor at click time.
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Threading;

public static class MudrikMouseHook
{
    public delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int x; public int y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSLLHOOKSTRUCT
    {
        public POINT pt;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr WindowFromPoint(POINT pt);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr GetModuleHandle(string lpModuleName);

    public const int WH_MOUSE_LL = 14;
    public const int HC_ACTION = 0;
    public const int WM_LBUTTONDOWN = 0x0201;
    public const int WM_RBUTTONDOWN = 0x0204;
    public const int WM_MBUTTONDOWN = 0x0207;
    public const uint GA_ROOT = 2;

    public class ClickEvent
    {
        public int X;
        public int Y;
        public string Button;
        public long Hwnd;
    }

    public static ConcurrentQueue<ClickEvent> Queue = new ConcurrentQueue<ClickEvent>();
    private static IntPtr _hook = IntPtr.Zero;
    private static LowLevelMouseProc _proc;

    public static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (nCode == HC_ACTION)
            {
                int msg = wParam.ToInt32();
                string btn = null;
                if (msg == WM_LBUTTONDOWN) btn = "left";
                else if (msg == WM_RBUTTONDOWN) btn = "right";
                else if (msg == WM_MBUTTONDOWN) btn = "middle";
                if (btn != null)
                {
                    MSLLHOOKSTRUCT hook = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                    POINT pt = hook.pt;
                    IntPtr child = WindowFromPoint(pt);
                    IntPtr root = GetAncestor(child, GA_ROOT);
                    Queue.Enqueue(new ClickEvent {
                        X = pt.x,
                        Y = pt.y,
                        Button = btn,
                        Hwnd = root.ToInt64()
                    });
                }
            }
        }
        catch { /* swallow — the hook must never throw back into the system */ }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    public static void Install()
    {
        _proc = new LowLevelMouseProc(HookCallback);
        IntPtr hMod = GetModuleHandle(null);
        _hook = SetWindowsHookEx(WH_MOUSE_LL, _proc, hMod, 0);
        if (_hook == IntPtr.Zero)
        {
            int err = Marshal.GetLastWin32Error();
            throw new System.ComponentModel.Win32Exception(err, "SetWindowsHookEx failed: " + err);
        }
    }

    public static void Uninstall()
    {
        if (_hook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hook);
            _hook = IntPtr.Zero;
        }
    }
}
"@

# Install the hook on this thread; SetWindowsHookEx requires the calling
# thread to pump messages, which the rest of this script does via Application.DoEvents().
[MudrikMouseHook]::Install()

# Tell the parent we're alive (helps debugging if the hook silently fails).
[Console]::Error.WriteLine("mouse-hook: WH_MOUSE_LL installed, pumping messages")

Add-Type -AssemblyName System.Windows.Forms

try {
    while ($true) {
        # Pump native window messages so the low-level hook callback fires.
        [System.Windows.Forms.Application]::DoEvents()

        # Drain the click queue into stdout, one JSON line per event.
        $evt = $null
        $hasEvent = [MudrikMouseHook]::Queue.TryDequeue([ref]$evt)
        while ($hasEvent) {
            $line = '{"x":' + $evt.X + ',"y":' + $evt.Y + ',"button":"' + $evt.Button + '","hwnd":' + $evt.Hwnd + '}'
            [Console]::Out.WriteLine($line)
            [Console]::Out.Flush()
            $hasEvent = [MudrikMouseHook]::Queue.TryDequeue([ref]$evt)
        }

        # Yield — 5ms is fast enough that the user-perceived latency is sub-frame.
        Start-Sleep -Milliseconds 5
    }
}
finally {
    [MudrikMouseHook]::Uninstall()
    [Console]::Error.WriteLine("mouse-hook: uninstalled")
}
`;

export interface ClickEvent {
  x: number;
  y: number;
  button: "left" | "right" | "middle";
}

export interface HookOptions {
  scopeHwnd: number;
  onClick: (event: ClickEvent) => void;
}

let activeProc: ChildProcess | null = null;

function ensureHookScript(): string {
  const tmpDir = path.join(os.tmpdir(), "hoverbuddy");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const scriptPath = path.join(tmpDir, HOOK_SCRIPT_NAME);
  fs.writeFileSync(scriptPath, HOOK_SCRIPT_CONTENT, "utf-8");
  return scriptPath;
}

export async function startMouseHook(opts: HookOptions): Promise<void> {
  if (activeProc) {
    log("startMouseHook: hook already running, stopping first");
    stopMouseHook();
  }
  const scriptPath = ensureHookScript();
  log(`startMouseHook: spawning ${scriptPath} scopeHwnd=${opts.scopeHwnd}`);
  const proc = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  activeProc = proc;

  let buffer = "";
  proc.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const evt = JSON.parse(line);
        if (typeof evt.hwnd === "number" && evt.hwnd === opts.scopeHwnd) {
          opts.onClick({ x: evt.x, y: evt.y, button: evt.button });
        }
      } catch (err) {
        log(`mouse-hook stdout parse error: ${(err as Error).message}, line=${line.slice(0, 100)}`);
      }
    }
  });

  proc.stderr!.on("data", (chunk: Buffer) => {
    log(`mouse-hook stderr: ${chunk.toString("utf-8").slice(0, 200)}`);
  });

  proc.on("close", (code) => {
    log(`mouse-hook exited with code ${code}`);
    if (activeProc === proc) activeProc = null;
  });
}

export function stopMouseHook(): void {
  if (!activeProc) return;
  log("stopMouseHook: killing PS process");
  try {
    activeProc.kill();
  } catch (err) {
    log(`stopMouseHook kill error: ${(err as Error).message}`);
  }
  activeProc = null;
}
