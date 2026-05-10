// src/main/actions/action-executor-heavy.ts
//
// Heavy action execution code (UIA, robotjs, find-element, paste/click/type/etc.).
// Lazy-loaded by action-executor.ts the first time a non-copy action arrives.
// Not loaded at all when actionsEnabled === false in config.
//
// Note: this module is one level deeper than the dispatcher, so all imports
// climb an extra "..".

import robot from "robotjs";
import { exec } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { Action } from "../../shared/types";
import { runPowerShell } from "../powershell-runner";
import { log } from "../logger";

const FIND_SCRIPT_NAME = "hoverbuddy-find-element-v9.ps1";
const UIA_SCRIPT_NAME = "hoverbuddy-uia-action-v4.ps1";

export interface ActionResult {
  success: boolean;
  error?: string;
  output?: string;
  matchedElement?: string;
}

/** Per-call context the dispatcher forwards to the heavy module. Mirrors the
 *  fields the in-process `lastContextElement` cache used to provide. */
export interface HeavyExecContext {
  automationId?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  name?: string;
  type?: string;
}

// Map LLM/user friendly names to the names robotjs uses in `keyTap`. robotjs
// uses `SendInput` under the hood, which is far more reliable than the old
// WinForms `SendKeys::SendWait` for modified key chords — SendKeys frequently
// dropped the Ctrl/Alt/Shift modifier when the target window wasn't fully
// focused yet, causing the modifier-less key to go through as a plain
// character (typing "v" instead of firing Ctrl+V for paste).
const ROBOT_KEY_MAP: Record<string, string> = {
  ctrl: "control",
  control: "control",
  cmd: "command",
  command: "command",
  win: "command",
  windows: "command",
  meta: "command",
  alt: "alt",
  option: "alt",
  shift: "shift",
  enter: "enter",
  return: "enter",
  tab: "tab",
  escape: "escape",
  esc: "escape",
  backspace: "backspace",
  delete: "delete",
  del: "delete",
  space: "space",
  spacebar: "space",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  home: "home",
  end: "end",
  pageup: "pageup",
  pagedown: "pagedown",
  insert: "insert",
  f1: "f1", f2: "f2", f3: "f3", f4: "f4",
  f5: "f5", f6: "f6", f7: "f7", f8: "f8",
  f9: "f9", f10: "f10", f11: "f11", f12: "f12",
};

const MODIFIERS = new Set(["control", "alt", "shift", "command"]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function moveCursorTo(bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
  const cx = Math.round(bounds.x + bounds.width / 2);
  const cy = Math.round(bounds.y + bounds.height / 2);
  log(`moveCursorTo: moving cursor to (${cx}, ${cy})`);
  robot.moveMouse(cx, cy);
  await sleep(80);
}

async function smoothMoveCursorTo(targetX: number, targetY: number, durationMs: number = 500): Promise<void> {
  const startX = robot.getMousePos().x;
  const startY = robot.getMousePos().y;
  const steps = 20;
  const stepDelay = Math.max(10, Math.round(durationMs / steps));
  log(`smoothMoveCursor: (${startX},${startY}) -> (${targetX},${targetY}) over ${durationMs}ms`);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = 1 - Math.pow(1 - t, 3);
    const x = Math.round(startX + (targetX - startX) * eased);
    const y = Math.round(startY + (targetY - startY) * eased);
    robot.moveMouse(x, y);
    await sleep(stepDelay);
  }
}

async function clickAtBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<boolean> {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    log(`clickAtBounds: invalid bounds ${JSON.stringify(bounds)}`);
    return false;
  }
  await moveCursorTo(bounds);
  robot.mouseClick();
  return true;
}

async function typeStringRaw(text: string): Promise<void> {
  log(`typeText: length=${text.length}, preview="${text.slice(0, 50)}"`);
  robot.typeString(text);
  await sleep(text.length * 10);
}

async function bringWindowToFront(bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
  log(`bringWindowToFront: moving cursor to window at (${bounds.x},${bounds.y}) size=${bounds.width}x${bounds.height}`);
  await moveCursorTo(bounds);
  robot.mouseClick();
  await sleep(100);
}

async function pasteText(text: string): Promise<boolean> {
  log(`pasteText: length=${text.length}`);
  try {
    const { clipboard } = require("electron");
    clipboard.writeText(text);
    // Give the clipboard + the target window a beat. Without this the
    // Ctrl+V chord can fire before the clipboard contents are published
    // OR before the focus click/setValue has fully settled, and the paste
    // either inserts stale clipboard or gets dropped.
    await sleep(120);
    // Primary path: koffi-based keybd_event from this process. Replaces
    // the old robotjs.keyTap("v")-then-PowerShell-fallback chain that had
    // two compounding production bugs:
    //   1. robotjs 0.7.0 throws "Invalid key code specified" on newer
    //      Node versions (25.5+) — every paste fell through to fallback.
    //   2. The PowerShell fallback spawned PS which briefly took
    //      foreground, so its keybd_event went to the PS window instead
    //      of the user's app. Paste reported success while Excel got
    //      nothing.
    // koffi keybd_event runs INSIDE the Mudrik process — no spawn, no
    // foreground steal — so the synthesized Ctrl+V hits whatever's
    // foreground when it fires (which is the user's app after the
    // preceding clickElement). robotjs mouse clicks still work fine and
    // are used elsewhere; only keyboard input was broken.
    const { sendCtrlV } = await import("../guide/active-window");
    const ok = await sendCtrlV();
    if (!ok) {
      log("pasteText FAILED: koffi keybd_event returned false");
      return false;
    }
    await sleep(120);
    log("pasteText: completed via koffi keybd_event");
    return true;
  } catch (err: any) {
    log(`pasteText FAILED: ${err.message}`);
    return false;
  }
}

async function pressKeys(combination: string): Promise<void> {
  log(`pressKeys: ${combination}`);
  const tokens = combination.split("+").map((k) => k.trim().toLowerCase()).filter(Boolean);

  const modifiers: string[] = [];
  let finalKey = "";
  for (const tok of tokens) {
    const mapped = ROBOT_KEY_MAP[tok] || tok;
    if (MODIFIERS.has(mapped)) {
      if (!modifiers.includes(mapped)) modifiers.push(mapped);
    } else {
      finalKey = mapped;
    }
  }

  if (!finalKey) {
    log(`  pressKeys: no non-modifier key in "${combination}" — skipping`);
    return;
  }

  // Single-character keys must be lowercased for robotjs. Shift is expressed
  // as a modifier, not as uppercase (e.g. "shift+a" → keyTap("a", ["shift"])).
  const keyArg = finalKey.length === 1 ? finalKey.toLowerCase() : finalKey;

  try {
    log(`  keyToggle(${modifiers.join("+")} down) + keyTap("${keyArg}")`);
    // See pasteText for why the array-modifier form is avoided: robotjs 0.7.0
    // throws "Invalid key code specified" on `keyTap(key, [modifiers])`. Press
    // each modifier individually, tap the key, then release modifiers in
    // reverse order (standard Win32 chord sequence).
    for (const mod of modifiers) robot.keyToggle(mod, "down");
    try {
      robot.keyTap(keyArg);
    } finally {
      for (const mod of [...modifiers].reverse()) robot.keyToggle(mod, "up");
    }
    await sleep(50);
  } catch (err: any) {
    log(`  robot.keyTap FAILED: ${err.message} — falling back to SendKeys`);
    // Fallback for any key robotjs rejects (rare — mostly exotic keys).
    const sendKeysCharMap: Record<string, string> = {
      enter: "{ENTER}", tab: "{TAB}", escape: "{ESC}", backspace: "{BS}",
      delete: "{DEL}", space: " ", up: "{UP}", down: "{DOWN}",
      left: "{LEFT}", right: "{RIGHT}", home: "{HOME}", end: "{END}",
      pageup: "{PGUP}", pagedown: "{PGDN}", insert: "{INS}",
      f1: "{F1}", f2: "{F2}", f3: "{F3}", f4: "{F4}",
      f5: "{F5}", f6: "{F6}", f7: "{F7}", f8: "{F8}",
      f9: "{F9}", f10: "{F10}", f11: "{F11}", f12: "{F12}",
    };
    let sendStr = "";
    if (modifiers.includes("control")) sendStr += "^";
    if (modifiers.includes("alt")) sendStr += "%";
    if (modifiers.includes("shift")) sendStr += "+";
    sendStr += sendKeysCharMap[finalKey] || finalKey;
    const scriptContent = `Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait('${sendStr.replace(/'/g, "''")}')`;
    const scriptPath = path.join(os.tmpdir(), "hoverbuddy", `sendkey-${Date.now()}.ps1`);
    fs.writeFileSync(scriptPath, scriptContent);
    try {
      await new Promise<void>((resolve, reject) => {
        exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, { timeout: 5000 }, (e) => {
          if (e) reject(e); else resolve();
        });
      });
    } finally {
      try { fs.unlinkSync(scriptPath); } catch {}
    }
    await sleep(50);
  }
}

function getFindScriptContent(): string {
  const lines: string[] = [];
  // $TargetHwnd lets the Node caller pin the foreground window before
  // PowerShell can steal it. Same fix as context-reader v17 — without it,
  // GetForegroundWindow inside the script returns PowerShell's own HWND
  // when the target is Chromium/Electron, breaking element-find on
  // Chrome / Claude Desktop / Slack / VS Code / Discord etc.
  lines.push('param([string]$SelectorFile, [string]$OutputFile, [int]$TargetHwnd = 0)');
  lines.push('Add-Type -AssemblyName PresentationCore');
  lines.push('Add-Type -AssemblyName UIAutomationClient');
  lines.push('Add-Type -AssemblyName UIAutomationTypes');
  lines.push('$ErrorActionPreference = "Stop"');
  lines.push('Add-Type @"');
  lines.push('using System;');
  lines.push('using System.Runtime.InteropServices;');
  lines.push('public class Dpi {');
  lines.push('    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();');
  lines.push('    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();');
  lines.push('    [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeoutMs, out IntPtr result);');
  lines.push('}');
  lines.push('"@');
  lines.push('[Dpi]::SetProcessDPIAware() | Out-Null');
  // Wake Chromium accessibility (same approach as context-reader v17).
  // Adaptive: probe the tree first; only wake+sleep if empty.
  lines.push('function WakeAccessibility($hwnd) {');
  lines.push('    if ($hwnd -eq [IntPtr]::Zero) { return }');
  lines.push('    $WM_GETOBJECT = 0x003D');
  lines.push('    $r = [IntPtr]::Zero');
  lines.push('    [Dpi]::SendMessageTimeout($hwnd, $WM_GETOBJECT, [IntPtr]::Zero, [IntPtr](-25), 0x0002, 200, [ref]$r) | Out-Null');
  lines.push('    [Dpi]::SendMessageTimeout($hwnd, $WM_GETOBJECT, [IntPtr]::Zero, [IntPtr](-4), 0x0002, 200, [ref]$r) | Out-Null');
  lines.push('}');
  lines.push('try { [System.Windows.Automation.Automation]::AddAutomationFocusChangedEventHandler([System.Windows.Automation.AutomationFocusChangedEventHandler]{ param($s,$e) }) } catch {}');
  lines.push('');
  lines.push('$raw = (Get-Content -Path $SelectorFile -Raw -Encoding utf8).Trim()');
  lines.push('$action = $raw | ConvertFrom-Json');
  lines.push('$selector = $action.selector');
  lines.push('$automationId = $action.automationId');
  lines.push('$boundsHint = $action.boundsHint');
  lines.push('$filterType = $null');
  lines.push('$filterName = $selector');
  lines.push('');
  lines.push('if ($selector -match "^([^:]+):(.+)$") {');
  lines.push('    $filterType = $Matches[1]');
  lines.push('    $filterName = $Matches[2]');
  lines.push('}');
  lines.push('');
  lines.push('$filterNameLower = $filterName.ToLower()');
  lines.push('$filterWords = @()');
  lines.push('if ($filterName) {');
  lines.push('    $filterWords = $filterName -split "[\\\\/\\s\\-_]+" | Where-Object { $_.Length -ge 3 }');
  lines.push('}');
  lines.push('');
  lines.push('function MatchName($name) {');
  lines.push('    if (-not $filterName) { return $true }');
  lines.push('    if (-not $name) { return $false }');
  lines.push('    $nameLower = $name.ToLower()');
  lines.push('    if ($nameLower -eq $filterNameLower) { return $true }');
  lines.push('    if ($nameLower.Contains($filterNameLower)) { return $true }');
  lines.push('    if ($filterNameLower.Contains($nameLower) -and $name.Length -ge 3) { return $true }');
  lines.push('    $matchedWords = 0');
  lines.push('    foreach ($word in $filterWords) {');
  lines.push('        if ($nameLower.Contains($word.ToLower())) { $matchedWords++ }');
  lines.push('    }');
  lines.push('    if ($filterWords.Count -gt 0 -and $matchedWords -ge [Math]::Max(1, [Math]::Floor($filterWords.Count * 0.5))) { return $true }');
  lines.push('    return $false');
  lines.push('}');
  lines.push('');
  lines.push('function MatchType($ctrlType) {');
  lines.push('    if (-not $filterType) { return $true }');
  lines.push('    if ($ctrlType -eq $filterType) { return $true }');
  lines.push('    if ($filterType -eq "Hyperlink" -and $ctrlType -eq "Custom") { return $true }');
  lines.push('    if ($filterType -eq "Button" -and ($ctrlType -eq "Button" -or $ctrlType -eq "SplitButton")) { return $true }');
  lines.push('    return $false');
  lines.push('}');
  lines.push('');
  lines.push('function DistanceSquared($r1, $r2) {');
  lines.push('    $cx1 = $r1.X + $r1.Width / 2');
  lines.push('    $cy1 = $r1.Y + $r1.Height / 2');
  lines.push('    $cx2 = $r2.X + $r2.Width / 2');
  lines.push('    $cy2 = $r2.Y + $r2.Height / 2');
  lines.push('    return [Math]::Pow($cx1 - $cx2, 2) + [Math]::Pow($cy1 - $cy2, 2)');
  lines.push('}');
  lines.push('');
  lines.push('$script:found = @()');
  lines.push('');
  lines.push('function FindElement($root, $depth, $maxDepth) {');
  lines.push('    if ($depth -gt $maxDepth) { return }');
  lines.push('    try {');
  lines.push('        $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)');
  lines.push('        foreach ($child in $children) {');
  lines.push('            try {');
  lines.push('                $name = $child.Current.Name');
  lines.push('                $ctrlType = $child.Current.ControlType.ProgrammaticName');
  lines.push('                $autoId = ""');
  lines.push('                try { $autoId = $child.Current.AutomationId } catch {}');
  lines.push('                $value = ""');
  lines.push('                try {');
  lines.push('                    $vp = $null');
  lines.push('                    $ok = $child.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)');
  lines.push('                    if ($ok -and $vp) { $value = $vp.Current.Value }');
  lines.push('                } catch {}');
  lines.push('');
  lines.push('                $r = $child.Current.BoundingRectangle');
  lines.push('                if ($r.Width -le 0 -or $r.Height -le 0) { continue }');
  lines.push('');
  lines.push('                $score = 0');
  lines.push('                $nameLower = if ($name) { $name.ToLower() } else { "" }');
  lines.push('');
  lines.push('                # Exact-match-only for AutomationId. Substring matching used to');
  lines.push('                # bite hard on cell-grid IDs ("A1" silently matched A10..A19).');
  lines.push('                # If the AI gives an automationId, it must hit exactly or fall');
  lines.push('                # through to name matching at lower scores.');
  lines.push('                if ($automationId -and $autoId -eq $automationId) {');
  lines.push('                    $score = 200');
  lines.push('                }');
  lines.push('');
  // Selector-as-automationId fallback. Excel cells (and many data grids)
  // expose AutomationId="C4" with Name="" or Name=cell-value. The AI often
  // emits selector="C4" without a separate automationId field — if we only
  // matched on Name, those clicks fail (the cell IS in the tree but its
  // Name doesn't equal "C4"). When no explicit automationId is supplied,
  // also score an exact AutomationId hit. Score 180 < 200 so an explicit
  // automationId match still wins, but well above name-substring matches.
  lines.push('                if ($score -eq 0 -and -not $automationId -and $autoId -and $filterName -and $autoId -eq $filterName) {');
  lines.push('                    $score = 180');
  lines.push('                }');
  lines.push('');
  lines.push('                if ($score -eq 0) {');
  lines.push('                    if (MatchName $name -and MatchType $ctrlType) {');
  lines.push('                        if ($nameLower -eq $filterNameLower) { $score = 100 }');
  lines.push('                        elseif ($nameLower.Contains($filterNameLower)) { $score = 80 }');
  lines.push('                        else { $score = 50 }');
  lines.push('                    } elseif (MatchName $value -and MatchType $ctrlType) {');
  lines.push('                        $score = 40');
  lines.push('                    }');
  lines.push('                }');
  lines.push('');
  lines.push('                if ($score -gt 0 -and $boundsHint) {');
  lines.push('                    $hintRect = @{ X = $boundsHint.x; Y = $boundsHint.y; Width = $boundsHint.width; Height = $boundsHint.height }');
  lines.push('                    $dist = DistanceSquared $r $hintRect');
  lines.push('                    if ($dist -lt 10000) { $score += 30 }');
  lines.push('                    elseif ($dist -lt 100000) { $score += 15 }');
  lines.push('                }');
  lines.push('');
  lines.push('                if ($score -gt 0) {');
  lines.push('                    $script:found += @{ name=$name; type=$ctrlType; autoId=$autoId; value=$value; score=$score; bounds=@{ x=[int]$r.X; y=[int]$r.Y; width=[int]$r.Width; height=[int]$r.Height } }');
  lines.push('                }');
  lines.push('');
  lines.push('                FindElement $child ($depth+1) $maxDepth');
  lines.push('            } catch {}');
  lines.push('        }');
  lines.push('    } catch {}');
  lines.push('}');
  lines.push('');
  // Virtualized-item realize pass. Excel (and any large grid/list using UIA
  // virtualization) only enumerates cells in the visible viewport. If the
  // target scrolled offscreen between context capture and action execution,
  // a plain FindAll-based traversal won't see it. ItemContainerPattern +
  // VirtualizedItemPattern is the supported way to materialize an item by
  // AutomationId — once Realized, it shows up in the tree and FindElement
  // can score it normally.
  lines.push('$script:realized = $false');
  lines.push('');
  lines.push('function TryRealizeVirtualized($node, $autoIdToFind, $depth, $maxDepth) {');
  lines.push('    if ($script:realized) { return }');
  lines.push('    if (-not $autoIdToFind -or $depth -gt $maxDepth) { return }');
  lines.push('    try {');
  lines.push('        $icPattern = $null');
  lines.push('        $hasIC = $false');
  lines.push('        try {');
  lines.push('            $hasIC = $node.TryGetCurrentPattern([System.Windows.Automation.ItemContainerPattern]::Pattern, [ref]$icPattern)');
  lines.push('        } catch {}');
  lines.push('        if ($hasIC -and $icPattern) {');
  lines.push('            try {');
  lines.push('                $item = $icPattern.FindItemByProperty($null, [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $autoIdToFind)');
  lines.push('                if ($item) {');
  lines.push('                    $vip = $null');
  lines.push('                    try {');
  lines.push('                        $hasVip = $item.TryGetCurrentPattern([System.Windows.Automation.VirtualizedItemPattern]::Pattern, [ref]$vip)');
  lines.push('                        if ($hasVip -and $vip) { $vip.Realize() }');
  lines.push('                    } catch {}');
  lines.push('                    $script:realized = $true');
  lines.push('                    return');
  lines.push('                }');
  lines.push('            } catch {}');
  lines.push('        }');
  lines.push('        try {');
  lines.push('            $children = $node.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)');
  lines.push('            foreach ($c in $children) {');
  lines.push('                if ($script:realized) { return }');
  lines.push('                TryRealizeVirtualized $c $autoIdToFind ($depth+1) $maxDepth');
  lines.push('            }');
  lines.push('        } catch {}');
  lines.push('    } catch {}');
  lines.push('}');
  lines.push('');
  lines.push('try {');
  // Scope: caller-supplied $TargetHwnd > GetForegroundWindow > RootElement.
  // The first option avoids the PowerShell-foreground steal that broke
  // element-find on Chromium/Electron apps before this fix.
  lines.push('    $fgHwnd = if ($TargetHwnd -gt 0) { [IntPtr]$TargetHwnd } else { [Dpi]::GetForegroundWindow() }');
  lines.push('    if ($fgHwnd -ne [IntPtr]::Zero) {');
  lines.push('        $root = [System.Windows.Automation.AutomationElement]::FromHandle($fgHwnd)');
  lines.push('    } else {');
  lines.push('        $root = [System.Windows.Automation.AutomationElement]::RootElement');
  lines.push('    }');
  // Poll-until-stable Chromium wake-up. Same adaptive algorithm as
  // context-reader v18: initial depth-2 ShallowCount probe — if the
  // tree's already populated, skip wake entirely (native apps).
  // Otherwise send WM_GETOBJECT and poll every 100ms until count
  // stabilizes (two consecutive same non-zero polls), capped at 2000ms.
  // Saves 500ms+ on simple pages, gives heavy renderers up to ~2s
  // instead of timing out at half-empty.
  lines.push('    function ShallowCount($node) {');
  lines.push('        try {');
  lines.push('            $kids = $node.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)');
  lines.push('            $sum = $kids.Count');
  lines.push('            foreach ($k in $kids) { try { $sum += $k.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition).Count } catch {} }');
  lines.push('            return $sum');
  lines.push('        } catch { return 0 }');
  lines.push('    }');
  lines.push('    $POPULATED_THRESHOLD = 10');
  lines.push('    $initialCount = ShallowCount $root');
  lines.push('    if ($initialCount -le $POPULATED_THRESHOLD) {');
  lines.push('        WakeAccessibility $fgHwnd');
  lines.push('        $lastCount = $initialCount');
  lines.push('        $elapsed = 0');
  lines.push('        while ($elapsed -lt 2000) {');
  lines.push('            Start-Sleep -Milliseconds 100');
  lines.push('            $elapsed += 100');
  lines.push('            $current = ShallowCount $root');
  lines.push('            if ($current -gt $POPULATED_THRESHOLD -and $current -eq $lastCount) { break }');
  lines.push('            $lastCount = $current');
  lines.push('        }');
  lines.push('        try { $root = [System.Windows.Automation.AutomationElement]::FromHandle($fgHwnd) } catch {}');
  lines.push('    }');
  lines.push('');
  lines.push('    # Try to materialize a virtualized item (e.g. an Excel cell scrolled out');
  lines.push('    # of view) BEFORE walking the tree. If found, give Excel a moment to');
  lines.push('    # update its UIA tree before FindElement enumerates. Falls back to');
  lines.push('    # using the selector itself as the automationId-to-find when the AI');
  lines.push('    # did not supply an explicit one — Excel cells "C4" / "AB12" etc. are');
  lines.push('    # the common case where the cell address IS the AutomationId.');
  lines.push('    $idForRealize = if ($automationId) { $automationId } else { $filterName }');
  lines.push('    if ($idForRealize) {');
  lines.push('        TryRealizeVirtualized $root $idForRealize 0 8');
  lines.push('        if ($script:realized) { Start-Sleep -Milliseconds 150 }');
  lines.push('    }');
  lines.push('');
  lines.push('    FindElement $root 0 20');
  lines.push('');
  // Spatial fallback. When the AI's selector/automationId don't match the
  // live UIA tree (common with screenshot-eyeball selectors like "File"
  // when the real UIA name is "MenuBarItem 0" or similar) AND the AI
  // provided a boundsHint, walk the tree again and pick the clickable
  // element whose center is closest to the AI's bounds center. This
  // turns a "near but not accurate" AI guess into a pixel-perfect lookup
  // for the auto-guide owl pointer.
  lines.push('    function FindClosestSpatial($node, $hint, $depth, $maxDepth) {');
  lines.push('        if ($depth -gt $maxDepth) { return }');
  lines.push('        try {');
  lines.push('            $children = $node.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)');
  lines.push('            foreach ($child in $children) {');
  lines.push('                try {');
  lines.push('                    $r = $child.Current.BoundingRectangle');
  lines.push('                    if ($r.Width -le 0 -or $r.Height -le 0) { FindClosestSpatial $child $hint ($depth+1) $maxDepth; continue }');
  lines.push('                    # Only consider elements that are interactable enough to point at —');
  lines.push('                    # filtering out giant container Panes / Groups that would always win');
  lines.push('                    # by virtue of containing the cursor.');
  lines.push('                    $ct = "" ; try { $ct = $child.Current.LocalizedControlType } catch {}');
  lines.push('                    $invokable = $false');
  lines.push('                    try { $tmp = $null; $invokable = $child.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$tmp) } catch {}');
  lines.push('                    $isClickable = $invokable -or ($ct -match "button|menu item|list item|tab|hyperlink|check|radio|edit|combo|tree item|header")');
  lines.push('                    if ($isClickable) {');
  lines.push('                        $cx = $r.X + $r.Width / 2');
  lines.push('                        $cy = $r.Y + $r.Height / 2');
  lines.push('                        $hcx = $hint.x + $hint.width / 2');
  lines.push('                        $hcy = $hint.y + $hint.height / 2');
  lines.push('                        $dx = $cx - $hcx; $dy = $cy - $hcy');
  lines.push('                        $dist = [Math]::Sqrt($dx*$dx + $dy*$dy)');
  lines.push('                        $cName = "" ; try { $cName = $child.Current.Name } catch {}');
  lines.push('                        $cAuto = "" ; try { $cAuto = $child.Current.AutomationId } catch {}');
  lines.push('                        $script:spatial += @{ name=$cName; type=$ctrlTypeName.Invoke($child); autoId=$cAuto; dist=$dist; bounds=@{ x=[int]$r.X; y=[int]$r.Y; width=[int]$r.Width; height=[int]$r.Height } }');
  lines.push('                    }');
  lines.push('                } catch {}');
  lines.push('                FindClosestSpatial $child $hint ($depth+1) $maxDepth');
  lines.push('            }');
  lines.push('        } catch {}');
  lines.push('    }');
  lines.push('');
  lines.push('    if ($script:found.Count -eq 0 -and $boundsHint) {');
  lines.push('        $script:spatial = @()');
  lines.push('        $ctrlTypeName = { param($n) try { return $n.Current.LocalizedControlType } catch { return "" } }');
  lines.push('        FindClosestSpatial $root $boundsHint 0 20');
  lines.push('        if ($script:spatial.Count -gt 0) {');
  lines.push('            $best = $script:spatial | Sort-Object -Property dist | Select-Object -First 1');
  lines.push('            # Score 60 to indicate "spatial fallback won, no name match"');
  lines.push('            $script:found += @{ name=$best.name; type=$best.type; autoId=$best.autoId; value=""; score=60; bounds=$best.bounds }');
  lines.push('        }');
  lines.push('    }');
  lines.push('');
  lines.push('    if ($script:found.Count -eq 0) {');
  lines.push('        @{ error="No element found matching selector: $selector"; selector=$selector } | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('    } else {');
  lines.push('        $sorted = $script:found | Sort-Object -Property score -Descending | Select-Object -First 5');
  lines.push('        @{ matches=$sorted; totalFound=$script:found.Count } | ConvertTo-Json -Depth 4 -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('    }');
  lines.push('} catch {');
  lines.push('    @{ error=$_.Exception.Message } | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('}');
  return lines.join("\n");
}

let findScriptPath: string | null = null;

function ensureFindScript(): string {
  if (findScriptPath && fs.existsSync(findScriptPath)) {
    return findScriptPath;
  }
  const tmpDir = path.join(os.tmpdir(), "hoverbuddy");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  findScriptPath = path.join(tmpDir, FIND_SCRIPT_NAME);
  fs.writeFileSync(findScriptPath, getFindScriptContent(), "utf-8");
  log(`Find-element script written to: ${findScriptPath}`);
  return findScriptPath;
}

export async function findElementBounds(selector: string, automationId?: string, boundsHint?: { x: number; y: number; width: number; height: number }): Promise<{ x: number; y: number; width: number; height: number; name: string; type: string; score: number } | null> {
  log(`findElementBounds: selector="${selector}" automationId="${automationId || ""}" boundsHint=${boundsHint ? JSON.stringify(boundsHint) : "none"}`);
  const script = ensureFindScript();

  const selectorData: any = { selector };
  if (automationId) selectorData.automationId = automationId;
  if (boundsHint) selectorData.boundsHint = boundsHint;

  const selectorFile = path.join(os.tmpdir(), "hoverbuddy", "selector-" + Date.now() + ".json");
  fs.writeFileSync(selectorFile, JSON.stringify(selectorData), "utf-8");

  // Resolve target HWND. Priority order:
  //   1. lastUserAppHwnd — the HWND captured at the most recent Alt+Space.
  //      This is the RIGHT one to use most of the time: when an action
  //      runs, Mudrik's panel has just received the user's prompt and is
  //      itself foreground, so a getActiveHwnd() call here returns
  //      MUDRIK's HWND. The PS script would then walk Mudrik's tree
  //      (no Excel cells / no Chrome elements) and fail with
  //      "could not find UI element". This was the bug behind every
  //      "click_element: C10 FAIL but paste_text: C10 OK" report — paste's
  //      bringWindowToFront() preliminary click incidentally fixed
  //      foreground before its internal clickElement, masking the issue.
  //   2. getActiveHwnd() fallback if no cache yet (e.g. very first action
  //      before any Alt+Space — shouldn't happen in normal flow).
  let targetHwnd = 0;
  try {
    const { getLastUserAppHwnd, getActiveHwnd, setForegroundHwnd } = await import("../guide/active-window");
    targetHwnd = getLastUserAppHwnd();
    if (!targetHwnd) targetHwnd = await getActiveHwnd();
    // Restore foreground to the user's app BEFORE the find runs. UIA
    // FromHandle() doesn't actually require foreground (it walks the
    // tree of any HWND), but the subsequent click via robotjs DOES
    // need the target window to be active to receive input. Doing this
    // before the script also helps wake up Chromium-based apps that
    // gate accessibility on focus.
    if (targetHwnd) {
      try { await setForegroundHwnd(targetHwnd); } catch { /* best-effort */ }
    }
  } catch (err: any) {
    log(`findElementBounds: HWND resolution failed (${err?.message || err}) — script will fall back to GetForegroundWindow`);
  }
  log(`findElementBounds: using targetHwnd=${targetHwnd}`);

  try {
    const { output, stderr, exitCode } = await runPowerShell(
      script,
      [selectorFile, "-TargetHwnd", String(targetHwnd)],
      { timeout: 15000 },
    );

    try { fs.unlinkSync(selectorFile); } catch {}

    if (stderr) {
      log(`findElementBounds stderr (non-fatal): ${stderr.slice(0, 200)}`);
    }

    if (!output) {
      log(`findElementBounds: empty output`);
      return null;
    }
    try {
      log(`findElementBounds output length=${output.length}, preview="${output.slice(0, 300)}"`);
      const parsed = JSON.parse(output);
      if (parsed.error) {
        log(`findElementBounds: ${parsed.error}`);
        return null;
      }
      const matches = parsed.matcheses || parsed.matches;
      const matchList = Array.isArray(matches) ? matches : matches ? [matches] : [];
      if (matchList.length === 0) {
        log(`findElementBounds: no matches found (totalFound=${parsed.totalFound ?? "n/a"})`);
        return null;
      }
      const best = matchList[0];
      log(`findElementBounds: best match name="${best.name}" type="${best.type}" score=${best.score} totalFound=${parsed.totalFound ?? "n/a"}`);
      return { ...best.bounds, name: best.name, type: best.type, score: best.score };
    } catch (parseErr: any) {
      log(`findElementBounds JSON parse error: ${parseErr.message}`);
      return null;
    }
  } catch (err: any) {
    try { fs.unlinkSync(selectorFile); } catch {}
    log(`findElementBounds FAILED: ${err.message}`);
    return null;
  }
}

function getUIAScriptContent(): string {
  const lines: string[] = [];
  lines.push('param([string]$ActionFile, [string]$OutputFile)');
  lines.push('Add-Type -AssemblyName PresentationCore');
  lines.push('Add-Type -AssemblyName UIAutomationClient');
  lines.push('$ErrorActionPreference = "Stop"');
  lines.push('Add-Type @"');
  lines.push('using System;');
  lines.push('using System.Runtime.InteropServices;');
  lines.push('public class Dpi2 { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }');
  lines.push('"@');
  lines.push('[Dpi2]::SetProcessDPIAware() | Out-Null');
  lines.push('');
  lines.push('$action = (Get-Content -Path $ActionFile -Raw -Encoding utf8 | ConvertFrom-Json)');
  lines.push('$op = $action.op');
  lines.push('$selector = $action.selector');
  lines.push('$value = $action.value');
  lines.push('$automationId = $action.automationId');
  lines.push('$boundsHint = $action.boundsHint');
  lines.push('');
  lines.push('$filterName = $selector');
  lines.push('$filterNameLower = $selector.ToLower()');
  lines.push('$filterWords = $selector -split "[\\\\/\\s\\-_]+" | Where-Object { $_.Length -ge 2 }');
  lines.push('');
  lines.push('function MatchName($name) {');
  lines.push('    if (-not $name) { return $false }');
  lines.push('    $nameLower = $name.ToLower()');
  lines.push('    if ($nameLower -eq $filterNameLower) { return $true }');
  lines.push('    if ($nameLower.Contains($filterNameLower)) { return $true }');
  lines.push('    $matchedWords = 0');
  lines.push('    foreach ($word in $filterWords) {');
  lines.push('        if ($nameLower.Contains($word.ToLower())) { $matchedWords++ }');
  lines.push('    }');
  lines.push('    if ($filterWords.Count -gt 0 -and $matchedWords -ge [Math]::Max(1, [Math]::Floor($filterWords.Count * 0.5))) { return $true }');
  lines.push('    return $false');
  lines.push('}');
  lines.push('');
  lines.push('function MatchAutoId($id) {');
  lines.push('    if (-not $automationId) { return $false }');
  lines.push('    if (-not $id) { return $false }');
  lines.push('    if ($id -eq $automationId) { return $true }');
  lines.push('    if ($id.ToLower().Contains($automationId.ToLower())) { return $true }');
  lines.push('    return $false');
  lines.push('}');
  lines.push('');
  lines.push('function DistanceSquared($r1, $r2) {');
  lines.push('    $cx1 = $r1.X + $r1.Width / 2');
  lines.push('    $cy1 = $r1.Y + $r1.Height / 2');
  lines.push('    $cx2 = $r2.X + $r2.Width / 2');
  lines.push('    $cy2 = $r2.Y + $r2.Height / 2');
  lines.push('    return [Math]::Pow($cx1 - $cx2, 2) + [Math]::Pow($cy1 - $cy2, 2)');
  lines.push('}');
  lines.push('');
  lines.push('$script:bestTarget = $null');
  lines.push('$script:bestScore = 0');
  lines.push('');
  lines.push('function FindTarget($root, $depth, $maxDepth) {');
  lines.push('    if ($depth -gt $maxDepth) { return }');
  lines.push('    try {');
  lines.push('        $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)');
  lines.push('        foreach ($child in $children) {');
  lines.push('            try {');
  lines.push('                $name = $child.Current.Name');
  lines.push('                $autoId = ""');
  lines.push('                try { $autoId = $child.Current.AutomationId } catch {}');
  lines.push('                $type = ""');
  lines.push('                try { $type = $child.Current.ControlType.ProgrammaticName } catch {}');
  lines.push('                $score = 0');
  lines.push('');
  lines.push('                if ($automationId -and (MatchAutoId $autoId)) {');
  lines.push('                    $score = 200');
  lines.push('                } else {');
  lines.push('                    if (MatchName $name) { $score = 100 }');
  lines.push('                    else {');
  lines.push('                        $val = ""');
  lines.push('                        try {');
  lines.push('                            $vp = $null');
  lines.push('                            $ok = $child.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)');
  lines.push('                            if ($ok -and $vp) { $val = $vp.Current.Value }');
  lines.push('                        } catch {}');
  lines.push('                        if ($val -and (MatchName $val)) { $score = 40 }');
  lines.push('                    }');
  lines.push('                }');
  lines.push('');
  lines.push('                if ($score -gt 0) {');
  lines.push('                    if ($op -eq "set_value" -and $type -eq "ControlType.Edit") { $score += 50 }');
  lines.push('                    if ($op -eq "invoke" -and $type -eq "ControlType.Button") { $score += 30 }');
  lines.push('                }');
  lines.push('');
  lines.push('                if ($score -gt 0 -and $boundsHint) {');
  lines.push('                    $r = $child.Current.BoundingRectangle');
  lines.push('                    $hintRect = @{ X = $boundsHint.x; Y = $boundsHint.y; Width = $boundsHint.width; Height = $boundsHint.height }');
  lines.push('                    $dist = DistanceSquared $r $hintRect');
  lines.push('                    if ($dist -lt 10000) { $score += 30 }');
  lines.push('                    elseif ($dist -lt 100000) { $score += 15 }');
  lines.push('                }');
  lines.push('');
  lines.push('                if ($score -gt $script:bestScore) {');
  lines.push('                    $script:bestTarget = $child');
  lines.push('                    $script:bestScore = $score');
  lines.push('                }');
  lines.push('');
  lines.push('                FindTarget $child ($depth+1) $maxDepth');
  lines.push('            } catch {}');
  lines.push('        }');
  lines.push('    } catch {}');
  lines.push('}');
  lines.push('');
  lines.push('try {');
  lines.push('    $foundByPoint = $false');
  lines.push('    if ($boundsHint -and $boundsHint.x -gt 0 -and $boundsHint.y -gt 0) {');
  lines.push('        $cx = [int]($boundsHint.x + $boundsHint.width / 2)');
  lines.push('        $cy = [int]($boundsHint.y + $boundsHint.height / 2)');
  lines.push('        Write-Host "Trying FromPoint at ($cx, $cy)"');
  lines.push('        try {');
  lines.push('            $pointElement = [System.Windows.Automation.AutomationElement]::FromPoint([System.Windows.Point]::new($cx, $cy))');
  lines.push('            if ($pointElement) {');
  lines.push('                $pname = ""');
  lines.push('                try { $pname = $pointElement.Current.Name } catch {}');
  lines.push('                $paid = ""');
  lines.push('                try { $paid = $pointElement.Current.AutomationId } catch {}');
  lines.push('                $ptype = ""');
  lines.push('                try { $ptype = $pointElement.Current.ControlType.ProgrammaticName } catch {}');
  lines.push('                Write-Host "FromPoint found: type=$ptype name=\'$pname\' autoId=\'$paid\'"');
  lines.push('                if (($automationId -and (MatchAutoId $paid)) -or (MatchName $pname)) {');
  lines.push('                    $script:bestTarget = $pointElement');
  lines.push('                    $script:bestScore = 250');
  lines.push('                    $foundByPoint = $true');
  lines.push('                    Write-Host "FromPoint matched selector! Using this element."');
  lines.push('                }');
  lines.push('            }');
  lines.push('        } catch {');
  lines.push('            Write-Host "FromPoint failed: $($_.Exception.Message)"');
  lines.push('        }');
  lines.push('    }');
  lines.push('');
  lines.push('    if (-not $foundByPoint) {');
  lines.push('        # Scope to foreground window for accuracy, fallback to desktop root.');
  lines.push('        Add-Type @"');
  lines.push('        using System;');
  lines.push('        using System.Runtime.InteropServices;');
  lines.push('        public class Win32UIA { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }');
  lines.push('"@');
  lines.push('        $fgHwnd = [Win32UIA]::GetForegroundWindow()');
  lines.push('        if ($fgHwnd -ne [IntPtr]::Zero) {');
  lines.push('            $root = [System.Windows.Automation.AutomationElement]::FromHandle($fgHwnd)');
  lines.push('        } else {');
  lines.push('            $root = [System.Windows.Automation.AutomationElement]::RootElement');
  lines.push('        }');
  lines.push('        FindTarget $root 0 20');
  lines.push('    }');
  lines.push('');
  lines.push('    if (-not $script:bestTarget) {');
  lines.push('        @{ success=$false; error="Element not found: $selector"; selector=$selector } | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('        exit 0');
  lines.push('    }');
  lines.push('');
  lines.push('    $target = $script:bestTarget');
  lines.push('    $targetName = ""');
  lines.push('    try { $targetName = $target.Current.Name } catch {}');
  lines.push('');
  lines.push('    if ($op -eq "set_value") {');
  lines.push('        try {');
  lines.push('            $target.SetFocus()');
  lines.push('            Start-Sleep -Milliseconds 100');
  lines.push('            $vp = $null');
  lines.push('            $ok = $target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)');
  lines.push('            if ($ok -and $vp) {');
  lines.push('                $vp.SetValue($value)');
  lines.push('                @{ success=$true; action="set_value"; selector=$selector; value=$value; matchedElement=$targetName } | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('            } else {');
  lines.push('                $target.SetFocus()');
  lines.push('                Start-Sleep -Milliseconds 100');
  lines.push('                try {');
  lines.push('                    Add-Type -AssemblyName System.Windows.Forms');
  lines.push('                    [System.Windows.Forms.SendKeys]::SendWait($value)');
  lines.push('                    @{ success=$true; action="set_value_fallback"; selector=$selector; matchedElement=$targetName } | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('                } catch {');
  lines.push('                    @{ success=$false; error="Element does not support ValuePattern and SendKeys failed: $($_.Exception.Message)"; selector=$selector; matchedElement=$targetName } | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('                }');
  lines.push('            }');
  lines.push('        } catch {');
  lines.push('            @{ success=$false; error=$_.Exception.Message; selector=$selector; matchedElement=$targetName } | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('        }');
  lines.push('    } elseif ($op -eq "invoke") {');
  lines.push('        try {');
  lines.push('            $ip = $null');
  lines.push('            $ok = $target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$ip)');
  lines.push('            if ($ok -and $ip) {');
  lines.push('                $ip.Invoke()');
  lines.push('                @{ success=$true; action="invoke"; selector=$selector; matchedElement=$targetName } | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('            } else {');
  lines.push('                $r = $target.Current.BoundingRectangle');
  lines.push('                Add-Type -AssemblyName System.Windows.Forms');
  lines.push('                [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point([int]($r.X + $r.Width/2), [int]($r.Y + $r.Height/2))');
  lines.push('                Start-Sleep -Milliseconds 50');
  lines.push('                [System.Windows.Forms.Mouse]::Click([System.Windows.Forms.MouseButtons]::Left)');
  lines.push('                @{ success=$true; action="invoke_fallback_click"; selector=$selector; matchedElement=$targetName } | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('            }');
  lines.push('        } catch {');
  lines.push('            @{ success=$false; error=$_.Exception.Message; selector=$selector; matchedElement=$targetName } | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('        }');
  lines.push('    } else {');
  lines.push('        @{ success=$false; error="Unknown op: $op" } | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('    }');
  lines.push('} catch {');
  lines.push('    @{ error=$_.Exception.Message } | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('}');
  return lines.join("\n");
}

let uiaScriptPath: string | null = null;

function ensureUIAScript(): string {
  if (uiaScriptPath && fs.existsSync(uiaScriptPath)) {
    return uiaScriptPath;
  }
  const tmpDir = path.join(os.tmpdir(), "hoverbuddy");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  uiaScriptPath = path.join(tmpDir, UIA_SCRIPT_NAME);
  fs.writeFileSync(uiaScriptPath, getUIAScriptContent(), "utf-8");
  log(`UIA script written to: ${uiaScriptPath}`);
  return uiaScriptPath;
}

async function uiaAction(op: string, selector: string, value?: string, automationId?: string, boundsHint?: { x: number; y: number; width: number; height: number }): Promise<ActionResult> {
  log(`uiaAction: op=${op} selector="${selector}" automationId="${automationId || ""}" value="${value?.slice(0, 50) || ""}"`);
  const script = ensureUIAScript();
  const tmpDir = path.join(os.tmpdir(), "hoverbuddy");
  const actionFile = path.join(tmpDir, `uia-action-${Date.now()}.json`);
  const actionData: any = { op, selector, value: value || "" };
  if (automationId) actionData.automationId = automationId;
  if (boundsHint) actionData.boundsHint = boundsHint;
  fs.writeFileSync(actionFile, JSON.stringify(actionData), "utf-8");

  try {
    const { output, stderr } = await runPowerShell(script, [actionFile], { timeout: 15000 });
    try { fs.unlinkSync(actionFile); } catch {}

    if (stderr) log(`uiaAction stderr (non-fatal): ${stderr.slice(0, 200)}`);

    if (!output) {
      log(`uiaAction: empty output`);
      return { success: false, error: "No output from PowerShell" };
    }
    try {
      const parsed = JSON.parse(output);
      log(`uiaAction result: ${JSON.stringify(parsed)}`);
      return parsed;
    } catch (parseErr: any) {
      log(`uiaAction JSON parse error: ${parseErr.message}`);
      return { success: false, error: parseErr.message };
    }
  } catch (err: any) {
    try { fs.unlinkSync(actionFile); } catch {}
    log(`uiaAction FAILED: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function resolveElementBounds(
  selector?: string,
  automationId?: string,
  boundsHint?: { x: number; y: number; width: number; height: number }
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  if (!selector) return boundsHint || null;
  const selectorNorm = selector.normalize("NFC").trim();
  const candidates = [selectorNorm];
  const colonIdx = selectorNorm.indexOf(":");
  if (colonIdx > 0) candidates.push(selectorNorm.substring(colonIdx + 1));
  const slashIdx = selectorNorm.lastIndexOf("/");
  if (slashIdx > 0 && slashIdx < selectorNorm.length - 1) candidates.push(selectorNorm.substring(slashIdx + 1));
  for (const sel of [...new Set(candidates)]) {
    const match = await findElementBounds(sel, automationId, boundsHint);
    if (match && match.width > 0 && match.height > 0) {
      return { x: match.x, y: match.y, width: match.width, height: match.height };
    }
  }
  return null;
}

async function showPulseHighlight(bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
  const { screen: electronScreen, BrowserWindow } = require("electron");
  const sf = electronScreen.getPrimaryDisplay().scaleFactor;
  const pulseWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
  });
  pulseWin.setIgnoreMouseEvents(true);
  pulseWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html><html><body style="margin:0;padding:0;overflow:hidden;background:transparent"><div style="width:100%;height:100%;border:3px solid rgba(124,140,248,0.8);border-radius:8px;box-shadow:0 0 20px rgba(124,140,248,0.4),inset 0 0 20px rgba(124,140,248,0.1);animation:pulse 0.8s ease-in-out 3;opacity:0;animation-fill-mode:forwards;animation-delay:0.1s"></div><style>@keyframes pulse{0%{opacity:0;transform:scale(0.95)}50%{opacity:1;transform:scale(1.05)}100%{opacity:0;transform:scale(1)}}</style></body></html>`)}`);
  setTimeout(() => {
    try { pulseWin.close(); } catch {}
  }, 3000);
}

async function clickElement(selector: string, automationId?: string, boundsHint?: { x: number; y: number; width: number; height: number }): Promise<ActionResult> {
  log(`clickElement: selector="${selector}" automationId="${automationId || ""}"`);

  const selectorNorm = selector.normalize("NFC").trim();

  const candidates = [selectorNorm];

  const colonIdx = selectorNorm.indexOf(":");
  if (colonIdx > 0) {
    const nameOnly = selectorNorm.substring(colonIdx + 1);
    candidates.push(nameOnly);
  }

  const slashIdx = selectorNorm.lastIndexOf("/");
  if (slashIdx > 0 && slashIdx < selectorNorm.length - 1) {
    candidates.push(selectorNorm.substring(slashIdx + 1));
  }

  const uniq = [...new Set(candidates)];
  log(`clickElement: trying selectors: ${JSON.stringify(uniq)}`);

  for (const sel of uniq) {
    const match = await findElementBounds(sel, automationId, boundsHint);
    if (match && match.width > 0 && match.height > 0) {
      const cx = Math.round(match.x + match.width / 2);
      const cy = Math.round(match.y + match.height / 2);
      log(`clickElement: matched "${sel}" -> name="${match.name}" type="${match.type}" score=${match.score}, moving cursor to (${cx}, ${cy}) then clicking`);
      robot.moveMouse(cx, cy);
      await sleep(80);
      robot.mouseClick();
      log(`clickElement: clicked at (${cx}, ${cy})`);
      return { success: true };
    }
  }

  log(`clickElement: all selectors failed for "${selector}"`);
  return { success: false, error: `Could not find UI element: "${selector}". It may not be visible or active. Click on the element and retry.` };
}

/** Execute any action type EXCEPT copy_to_clipboard (which is handled inline
 *  in action-executor.ts to avoid loading this module in read-only mode).
 *
 *  `ctx` carries the in-process "last context element" the dispatcher caches
 *  via setLastContextElement — used as a fallback selector source when the
 *  Action itself doesn't carry an automationId/boundsHint. */
export async function executeHeavyAction(action: Action, ctx: HeavyExecContext): Promise<ActionResult> {
  log(`executeHeavyAction: type=${action.type}, selector=${action.selector || "(none)"}, text=${action.text?.slice(0, 50) || "(none)"}`);

  const autoId = action.automationId || ctx.automationId;
  const boundsHint = action.boundsHint || ctx.bounds;
  const storedBounds = ctx.bounds;

  try {
    switch (action.type) {
      case "type_text":
        if (!action.text) return { success: false, error: "No text provided" };
        if (action.selector) {
          const result = await uiaAction("set_value", action.selector, action.text, autoId, boundsHint);
          if (!result.success) {
            if (storedBounds) await bringWindowToFront(storedBounds);
            const clickResult = await clickElement(action.selector, autoId, boundsHint);
            if (!clickResult.success) return clickResult;
            await sleep(150);
            await typeStringRaw(action.text);
          }
          return result;
        } else if (storedBounds) {
          await bringWindowToFront(storedBounds);
          if (!clickAtBounds(storedBounds)) return { success: false, error: "Invalid stored bounds for click" };
          await sleep(150);
          await typeStringRaw(action.text);
          return { success: true };
        }
        return { success: false, error: "No selector and no stored bounds" };

      case "paste_text": {
        // paste_text uses the clipboard + Ctrl+V, NOT ValuePattern.SetValue.
        // This is critical for apps like Excel that interpret tab/newline in
        // pasted plain text as cell separators. SetValue would dump everything
        // into a single cell as raw text.
        const textToPaste = action.text ?? "";
        if (action.selector) {
          // Focus the target element first, then paste via clipboard.
          if (storedBounds) await bringWindowToFront(storedBounds);
          const clickResult = await clickElement(action.selector, autoId, boundsHint);
          if (!clickResult.success) return clickResult;
          await sleep(150);
          const pasted = await pasteText(textToPaste);
          return pasted
            ? { success: true }
            : { success: false, error: "Paste failed" };
        } else if (storedBounds) {
          await bringWindowToFront(storedBounds);
          if (!clickAtBounds(storedBounds)) return { success: false, error: "Invalid stored bounds for click" };
          await sleep(150);
          const pasted = await pasteText(textToPaste);
          return pasted
            ? { success: true }
            : { success: false, error: "Paste failed" };
        }
        return { success: false, error: "No selector and no stored bounds" };
      }

      case "set_value": {
        if (!action.selector) return { success: false, error: "No selector" };
        const textToSet = action.text ?? "";
        const setResult = await uiaAction("set_value", action.selector, textToSet, autoId, boundsHint);
        if (setResult.success) return setResult;
        log(`set_value UIA failed (${setResult.error}), falling back to click+paste`);
        if (textToSet === "") {
          log("set_value: empty value — using select-all + delete fallback");
          if (storedBounds) await bringWindowToFront(storedBounds);
          const clickOk = storedBounds
            ? clickAtBounds(storedBounds)
            : (await clickElement(action.selector, autoId, boundsHint)).success;
          if (!clickOk) return { success: false, error: `Click failed for clear: ${setResult.error}` };
          await sleep(150);
          await pressKeys("ctrl+a");
          await sleep(50);
          await pressKeys("delete");
          return { success: true };
        }
        if (storedBounds) {
          await bringWindowToFront(storedBounds);
          if (!clickAtBounds(storedBounds)) {
            const clickResult = await clickElement(action.selector, autoId, boundsHint);
            if (!clickResult.success) return { success: false, error: `UIA failed and click failed: ${setResult.error}` };
          }
          await sleep(150);
          const pasted = await pasteText(action.text || "");
          return pasted
            ? { success: true }
            : { success: false, error: `UIA failed and paste failed: ${setResult.error}` };
        }
        const clickResult = await clickElement(action.selector, autoId, boundsHint);
        if (!clickResult.success) return { success: false, error: `UIA failed and click failed: ${setResult.error}` };
        await sleep(150);
        const pasted2 = await pasteText(action.text || "");
        return pasted2
          ? { success: true }
          : { success: false, error: `UIA failed and paste failed: ${setResult.error}` };
      }

      case "invoke_element":
        if (action.selector) {
          return await uiaAction("invoke", action.selector, undefined, autoId, boundsHint);
        } else if (storedBounds) {
          if (!clickAtBounds(storedBounds)) return { success: false, error: "Invalid stored bounds" };
          await sleep(100);
          return { success: true };
        }
        return { success: false, error: "No selector and no stored bounds" };

      case "click_element":
        if (action.selector) {
          return await clickElement(action.selector, autoId, boundsHint);
        } else if (storedBounds) {
          if (!clickAtBounds(storedBounds)) return { success: false, error: "Invalid stored bounds" };
          return { success: true };
        }
        return { success: false, error: "No selector and no stored bounds" };

      case "press_keys":
        if (!action.combination)
          return { success: false, error: "No combination" };
        await pressKeys(action.combination);
        return { success: true };

      case "guide_to": {
        const guideBounds = await resolveElementBounds(action.selector, autoId, boundsHint);
        if (!guideBounds) {
          if (storedBounds) {
            const cx = Math.round(storedBounds.x + storedBounds.width / 2);
            const cy = Math.round(storedBounds.y + storedBounds.height / 2);
            await smoothMoveCursorTo(cx, cy);
            if (!action.autoClick) {
              await showPulseHighlight(storedBounds);
            } else {
              robot.mouseClick();
            }
            return { success: true };
          }
          return { success: false, error: "Could not find element to guide to" };
        }
        const cx = Math.round(guideBounds.x + guideBounds.width / 2);
        const cy = Math.round(guideBounds.y + guideBounds.height / 2);
        await smoothMoveCursorTo(cx, cy);
        if (action.autoClick) {
          robot.mouseClick();
        } else {
          await showPulseHighlight(guideBounds);
        }
        return { success: true };
      }

      default:
        return { success: false, error: `executeHeavyAction: unsupported type ${action.type}` };
    }
  } catch (err: any) {
    log(`executeHeavyAction FAILED: ${err.message}`);
    return { success: false, error: err.message || String(err) };
  }
}
