import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { UIElement, VisibleWindow } from "../shared/types";
import { runPowerShell } from "./powershell-runner";

const log = (msg: string) => console.log(`[CTX-READER] ${msg}`);

const SCRIPT_NAME = "hoverbuddy-read-context-v13.ps1";

function getScriptContent(): string {
  const lines: string[] = [];
  lines.push('param([int]$X, [int]$Y, [string]$OutputFile)');
  lines.push('Add-Type -AssemblyName PresentationCore');
  lines.push('Add-Type -AssemblyName UIAutomationClient');
  lines.push('Add-Type -TypeDefinition @"');
  lines.push('using System;');
  lines.push('using System.Runtime.InteropServices;');
  lines.push('public class DpiHelper {');
  lines.push('    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();');
  lines.push('}');
  lines.push('"@');
  lines.push('[DpiHelper]::SetProcessDPIAware() | Out-Null');
  lines.push('$ErrorActionPreference = "Stop"');
  lines.push('');
  lines.push('function ElDict($el) {');
  lines.push('    $dict = @{}');
  lines.push('    try { $dict["name"] = $el.Current.Name } catch { $dict["name"] = "" }');
  lines.push('    try { $dict["type"] = $el.Current.ControlType.ProgrammaticName } catch { $dict["type"] = "Unknown" }');
  lines.push('    try {');
  lines.push('        $val = $null');
  lines.push('        $ok = $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$val)');
  lines.push('        if ($ok -and $val) {');
  lines.push('            $dict["value"] = $val.Current.Value');
  lines.push('        }');
  lines.push('        else {');
  lines.push('            $txt = $null');
  lines.push('            $ok2 = $el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$txt)');
  lines.push('            if ($ok2 -and $txt) { try { $dict["value"] = $txt.DocumentRange.GetText(500) } catch { $dict["value"] = "" } }');
  lines.push('            else { $dict["value"] = "" }');
  lines.push('        }');
  lines.push('    } catch { $dict["value"] = "" }');
  lines.push('    try {');
  lines.push('        $r = $el.Current.BoundingRectangle');
  lines.push('        $dict["bounds"] = @{ x = [int]$r.X; y = [int]$r.Y; width = [int]$r.Width; height = [int]$r.Height }');
  lines.push('    } catch { $dict["bounds"] = @{ x = 0; y = 0; width = 0; height = 0 } }');
  lines.push('    try { $dict["autoId"] = $el.Current.AutomationId } catch { $dict["autoId"] = "" }');
  lines.push('    try { $dict["className"] = $el.Current.ClassName } catch { $dict["className"] = "" }');
  lines.push('    try { $dict["isOffscreen"] = $el.Current.IsOffscreen } catch { $dict["isOffscreen"] = $false }');
  lines.push('    $dict');
  lines.push('}');
  lines.push('');
  lines.push('$containerTypes = @("ControlType.Window", "ControlType.Pane", "ControlType.Group", "ControlType.Custom")');
  lines.push('');
  lines.push('function IsBoringContainer($el) {');
  lines.push('    $type = ""');
  lines.push('    try { $type = $el.Current.ControlType.ProgrammaticName } catch {}');
  lines.push('    $isContainer = $false');
  lines.push('    foreach ($ct in $containerTypes) { if ($type -eq $ct) { $isContainer = $true; break } }');
  lines.push('    if (-not $isContainer) { return $false }');
  lines.push('    $name = ""');
  lines.push('    try { $name = $el.Current.Name } catch {}');
  lines.push('    $val = ""');
  lines.push('    try {');
  lines.push('        $vp = $null');
  lines.push('        $ok = $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)');
  lines.push('        if ($ok -and $vp) { $val = $vp.Current.Value }');
  lines.push('    } catch {}');
  lines.push('    if ($name -or $val) { return $false }');
  lines.push('    return $true');
  lines.push('}');
  lines.push('');
  lines.push('$preferredTypes = @("ControlType.Edit", "ControlType.Text", "ControlType.Button", "ControlType.Hyperlink", "ControlType.CheckBox", "ControlType.RadioButton", "ControlType.ListItem", "ControlType.DataItem", "ControlType.TreeItem", "ControlType.MenuItem", "ControlType.ComboBox", "ControlType.Slider", "ControlType.Spinner")');
  lines.push('');
  lines.push('function IsPreferredType($el) {');
  lines.push('    $type = ""');
  lines.push('    try { $type = $el.Current.ControlType.ProgrammaticName } catch { return $false }');
  lines.push('    foreach ($pt in $preferredTypes) { if ($type -eq $pt) { return $true } }');
  lines.push('    return $false');
  lines.push('}');
  lines.push('');
  lines.push('function FindDeepestElement($el, $x, $y, $depth) {');
  lines.push('    if ($depth -gt 15) { return $el }');
  lines.push('    $isBoring = IsBoringContainer $el');
  lines.push('    if (-not $isBoring) {');
  lines.push('        $type = ""');
  lines.push('        try { $type = $el.Current.ControlType.ProgrammaticName } catch {}');
  lines.push('        foreach ($ct in $containerTypes) { if ($type -eq $ct) { $isBoring = $true; break } }');
  lines.push('        if (-not $isBoring) { return $el }');
  lines.push('    }');
  lines.push('    try {');
  lines.push('        $children = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)');
  lines.push('        $bestChild = $null');
  lines.push('        $bestScore = [double]::MaxValue');
  lines.push('        foreach ($child in $children) {');
  lines.push('            try {');
  lines.push('                $r = $child.Current.BoundingRectangle');
  lines.push('                if ($r.Width -le 0 -or $r.Height -le 0) { continue }');
  lines.push('                if (-not ($x -ge $r.X -and $x -le ($r.X + $r.Width) -and $y -ge $r.Y -and $y -le ($r.Y + $r.Height))) { continue }');
  lines.push('                $area = [int]($r.Width * $r.Height)');
  lines.push('                $cx = $r.X + $r.Width / 2');
  lines.push('                $cy = $r.Y + $r.Height / 2');
  lines.push('                $dist = [Math]::Sqrt(([Math]::Pow($cx - $x, 2) + [Math]::Pow($cy - $y, 2)))');
  lines.push('                $score = $area + $dist * 2');
  lines.push('                if (IsPreferredType $child) { $score = $score * 0.1 }');
  lines.push('                if ($score -lt $bestScore) {');
  lines.push('                    $bestScore = $score');
  lines.push('                    $bestChild = $child');
  lines.push('                }');
  lines.push('            } catch {}');
  lines.push('        }');
  lines.push('        if ($bestChild) { return FindDeepestElement $bestChild $x $y ($depth + 1) }');
  lines.push('    } catch {}');
  lines.push('    return $el');
  lines.push('}');
  lines.push('');
  lines.push('function GetParentChain($el) {');
  lines.push('    $chain = @()');
  lines.push('    $current = $el');
  lines.push('    for ($i = 0; $i -lt 10; $i++) {');
  lines.push('        try {');
  lines.push('            $parent = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($current)');
  lines.push('            if (-not $parent -or $parent -eq $current) { break }');
  lines.push('            $parentName = ""');
  lines.push('            try { $parentName = $parent.Current.Name } catch {}');
  lines.push('            $parentType = ""');
  lines.push('            try { $parentType = $parent.Current.ControlType.ProgrammaticName } catch {}');
  lines.push('            if ($parentName -or $parentType) {');
  lines.push('                $chain = @(@{ name = $parentName; type = $parentType }) + $chain');
  lines.push('            }');
  lines.push('            if ($parentType -eq "ControlType.Window") { break }');
  lines.push('            $current = $parent');
  lines.push('        } catch { break }');
  lines.push('    }');
  lines.push('    $chain');
  lines.push('}');
  lines.push('');
  lines.push('function GetWindowTitle($el) {');
  lines.push('    $current = $el');
  lines.push('    for ($i = 0; $i -lt 15; $i++) {');
  lines.push('        try {');
  lines.push('            $parent = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($current)');
  lines.push('            if (-not $parent -or $parent -eq $current) { break }');
  lines.push('            $pType = ""');
  lines.push('            try { $pType = $parent.Current.ControlType.ProgrammaticName } catch {}');
  lines.push('            if ($pType -eq "ControlType.Window") {');
  lines.push('                try { return $parent.Current.Name } catch { return "" }');
  lines.push('            }');
  lines.push('            $current = $parent');
  lines.push('        } catch { break }');
  lines.push('    }');
  lines.push('    return ""');
  lines.push('}');
  lines.push('');
  lines.push('function GetAncestorWindow($el) {');
  lines.push('    $current = $el');
  lines.push('    for ($i = 0; $i -lt 20; $i++) {');
  lines.push('        try {');
  lines.push('            $type = $current.Current.ControlType.ProgrammaticName');
  lines.push('            if ($type -eq "ControlType.Window") { return $current }');
  lines.push('            $parent = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($current)');
  lines.push('            if (-not $parent -or $parent -eq $current) { break }');
  lines.push('            $current = $parent');
  lines.push('        } catch { break }');
  lines.push('    }');
  lines.push('    return $null');
  lines.push('}');
  lines.push('');
  lines.push('$script:treeElements = @()');
  lines.push('');
  lines.push('function CollectWindowTree($root, $depth, $maxDepth, $targetEl) {');
  lines.push('    if ($depth -gt $maxDepth) { return }');
  lines.push('    if ($script:treeElements.Count -ge 500) { return }');
  lines.push('    try {');
  lines.push('        $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)');
  lines.push('        foreach ($child in $children) {');
  lines.push('            try {');
  lines.push('                $r = $child.Current.BoundingRectangle');
  lines.push('                if ($r.Width -le 0 -or $r.Height -le 0) { continue }');
  lines.push('                try { if ($child.Current.IsOffscreen) { continue } } catch {}');
  lines.push('                $d = ElDict $child');
  lines.push('                $d["depth"] = $depth');
  lines.push('                if ($child -eq $targetEl) { $d["isTarget"] = $true }');
  lines.push('                $script:treeElements += $d');
  lines.push('                CollectWindowTree $child ($depth + 1) $maxDepth $targetEl');
  lines.push('            } catch {}');
  lines.push('        }');
  lines.push('    } catch {}');
  lines.push('}');
  lines.push('');
  lines.push('function GetVisibleWindows() {');
  lines.push('    $result = @()');
  lines.push('    try {');
  lines.push('        $root = [System.Windows.Automation.AutomationElement]::RootElement');
  lines.push('        $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)');
  lines.push('        foreach ($win in $children) {');
  lines.push('            try {');
  lines.push('                $r = $win.Current.BoundingRectangle');
  lines.push('                if ($r.Width -le 0 -or $r.Height -le 0) { continue }');
  lines.push('                try { if ($win.Current.IsOffscreen) { continue } } catch {}');
  lines.push('                $wType = ""');
  lines.push('                try { $wType = $win.Current.ControlType.ProgrammaticName } catch {}');
  lines.push('                if ($wType -ne "ControlType.Window") { continue }');
  lines.push('                $wName = ""');
  lines.push('                try { $wName = $win.Current.Name } catch {}');
  lines.push('                $wAutoId = ""');
  lines.push('                try { $wAutoId = $win.Current.AutomationId } catch {}');
  lines.push('                $wClass = ""');
  lines.push('                try { $wClass = $win.Current.ClassName } catch {}');
  lines.push('                $isMin = $false');
  lines.push('                try { $isMin = $win.Current.IsOffscreen } catch {}');
  lines.push('                $wDict = @{}');
  lines.push('                $wDict["name"] = $wName');
  lines.push('                $wDict["type"] = $wType');
  lines.push('                $wDict["bounds"] = @{ x = [int]$r.X; y = [int]$r.Y; width = [int]$r.Width; height = [int]$r.Height }');
  lines.push('                $wDict["autoId"] = $wAutoId');
  lines.push('                $wDict["className"] = $wClass');
  lines.push('                $wDict["isOffscreen"] = $isMin');
  lines.push('                $result += $wDict');
  lines.push('            } catch {}');
  lines.push('        }');
  lines.push('    } catch {}');
  lines.push('    $result');
  lines.push('}');
  lines.push('');
  lines.push('');
  lines.push('try {');
  lines.push('    $rawElement = [System.Windows.Automation.AutomationElement]::FromPoint([System.Windows.Point]::new($X, $Y))');
  lines.push('    $element = FindDeepestElement $rawElement $X $Y 0');
  lines.push('');
  lines.push('    $result = @{}');
  lines.push('    $result["element"] = ElDict $element');
  lines.push('    if ($element -ne $rawElement) {');
  lines.push('        $result["element"]["_drilledFromContainer"] = $true');
  lines.push('        $containerDict = ElDict $rawElement');
  lines.push('        $result["element"]["containerType"] = $containerDict["type"]');
  lines.push('        $result["element"]["containerName"] = $containerDict["name"]');
  lines.push('    }');
  lines.push('');
  lines.push('    $parentChain = GetParentChain $element');
  lines.push('    $result["element"]["parentChain"] = $parentChain');
  lines.push('');
  lines.push('    $windowTitle = GetWindowTitle $element');
  lines.push('    $result["element"]["windowTitle"] = $windowTitle');
  lines.push('');
  lines.push('    $winEl = GetAncestorWindow $element');
  lines.push('    if ($winEl) {');
  lines.push('        CollectWindowTree $winEl 0 15 $element');
  lines.push('    }');
  lines.push('    $result["windowTree"] = $script:treeElements');
  lines.push('');
  lines.push('    $result["visibleWindows"] = GetVisibleWindows');
  lines.push('');
  lines.push('    $result | ConvertTo-Json -Depth 5 -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('} catch {');
  lines.push('    @{ error = $_.Exception.Message } | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
  lines.push('}');
  return lines.join("\n");
}

let scriptPath: string | null = null;

function ensureScriptFile(): string {
  if (scriptPath && fs.existsSync(scriptPath)) {
    return scriptPath;
  }

  const tmpDir = path.join(os.tmpdir(), "hoverbuddy");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  scriptPath = path.join(tmpDir, SCRIPT_NAME);
  fs.writeFileSync(scriptPath, getScriptContent(), "utf-8");
  log(`Script file written to: ${scriptPath}`);
  return scriptPath;
}

export function getCursorPos(): { x: number; y: number } {
  const robot = require("robotjs");
  const pos = robot.getMousePos();
  return { x: pos.x, y: pos.y };
}

export async function readContextAtPoint(
  x: number,
  y: number
): Promise<{ element: UIElement; surrounding: UIElement[]; windowInfo?: { title: string; processName: string; processPath: string }; windowTree?: UIElement[]; visibleWindows?: VisibleWindow[] }> {
  log(`readContextAtPoint called: x=${x}, y=${y}`);

  try {
    const [ctxResult, winResult] = await Promise.all([
      readElementAtPoint(x, y),
      readForegroundWindow(),
    ]);

    const { element, surrounding, windowTree, visibleWindows } = ctxResult;
    log(`Context read: element type="${element.type}" name="${element.name}" process="${winResult?.processName || ""}" title="${winResult?.title || ""}"`);
    return { element, surrounding, windowInfo: winResult || undefined, windowTree, visibleWindows };
  } catch (err: any) {
    log(`readContextAtPoint FAILED: ${err.message}`);
    const { element, surrounding } = makeError(x, y, err.message || String(err));
    return { element, surrounding };
  }
}

async function readElementAtPoint(x: number, y: number): Promise<{ element: UIElement; surrounding: UIElement[]; windowTree?: UIElement[]; visibleWindows?: VisibleWindow[] }> {
  const startTime = Date.now();
  try {
    const script = ensureScriptFile();
    const { output, stderr, exitCode } = await runPowerShell(script, [String(x), String(y)], { timeout: 15000 });

    const elapsed = Date.now() - startTime;
    log(`PowerShell completed in ${elapsed}ms, output length=${output.length}, exitCode=${exitCode}`);

    if (stderr) {
      log(`PowerShell stderr (non-fatal): ${stderr.slice(0, 200)}`);
    }

    if (!output) {
      log("ERROR: Empty response from PowerShell");
      return makeError(x, y, "Empty response from PowerShell");
    }

    let parsed: any;
    try {
      parsed = JSON.parse(output);
    } catch (parseErr: any) {
      log(`JSON parse error: ${parseErr.message}`);
      log(`Raw response (first 500 chars): ${output.slice(0, 500)}`);
      return makeError(x, y, `JSON parse error: ${parseErr.message}`);
    }

    if (parsed.error) {
      log(`PowerShell script error: ${parsed.error}`);
      return makeError(x, y, parsed.error);
    }

const element = dotNetToUIElement(parsed.element);
    const rawSurrounding: any[] = [];

    const windowTree: UIElement[] = Array.isArray(parsed.windowTree)
      ? parsed.windowTree
          .map((s: any) => dotNetToUIElement(s))
          .filter((el: UIElement) => !el.isOffscreen)
      : [];

    const visibleWindows: VisibleWindow[] = Array.isArray(parsed.visibleWindows)
      ? parsed.visibleWindows.map((w: any) => ({
          name: w?.name || "",
          type: w?.type || "",
          bounds: w?.bounds || { x: 0, y: 0, width: 0, height: 0 },
          processName: w?.processName || "",
          isActive: w?.isActive || false,
          isMinimized: w?.isMinimized || false,
        })).filter((w: VisibleWindow) => !w.isMinimized && w.bounds.width > 0 && w.bounds.height > 0)
      : [];

    log(`Context read success: element type="${element.type}" name="${element.name}" value="${String(element.value).slice(0, 80)}", drilled=${!!parsed.element?._drilledFromContainer}, windowTree=${windowTree.length} elements, visibleWindows=${visibleWindows.length}, automationId="${element.automationId || ""}", windowTitle="${element.windowTitle || ""}"`);
    return { element, surrounding: rawSurrounding, windowTree, visibleWindows };
  } catch (err: any) {
    log(`readElementAtPoint FAILED: ${err.message}`);
    return makeError(x, y, err.message || String(err));
  }
}

const WINDOW_SCRIPT_NAME = "hoverbuddy-foreground-window-v1.ps1";

function getWindowScriptContent(): string {
  return `param([string]$OutputFile)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FGWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [FGWin]::GetForegroundWindow()
$titleBuf = New-Object System.Text.StringBuilder 512
[FGWin]::GetWindowText($hwnd, $titleBuf, 512) | Out-Null
$title = $titleBuf.ToString()
$pid = [uint32]0
[FGWin]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
$pname = ""
$ppath = ""
try { $proc = Get-Process -Id $pid -ErrorAction Stop; $pname = $proc.ProcessName; try { $ppath = $proc.MainModule.FileName } catch {} } catch {}
@{ title=$title; processName=$pname; processPath=$ppath } | ConvertTo-Json -Compress | Out-File -FilePath $OutputFile -Encoding utf8`;
}

let windowScriptPath: string | null = null;

function ensureWindowScriptFile(): string {
  if (windowScriptPath && fs.existsSync(windowScriptPath)) {
    return windowScriptPath;
  }
  const tmpDir = path.join(os.tmpdir(), "hoverbuddy");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  windowScriptPath = path.join(tmpDir, WINDOW_SCRIPT_NAME);
  fs.writeFileSync(windowScriptPath, getWindowScriptContent(), "utf-8");
  return windowScriptPath;
}

async function readForegroundWindow(): Promise<{ title: string; processName: string; processPath: string } | null> {
  try {
    const script = ensureWindowScriptFile();
    const { output, stderr } = await runPowerShell(script, [], { timeout: 5000 });
    if (stderr) log(`Window script stderr (non-fatal): ${stderr.slice(0, 200)}`);
    if (!output) return null;

    const parsed = JSON.parse(output);
    const info = {
      title: parsed.title || "",
      processName: parsed.processName || "",
      processPath: parsed.processPath || "",
    };
    log(`Foreground window: title="${info.title}" process="${info.processName}" path="${info.processPath}"`);
    return info;
  } catch (err: any) {
    log(`readForegroundWindow failed (non-fatal): ${err.message}`);
    return null;
  }
}

function dotNetToUIElement(d: any): UIElement {
  const rawChildren = Array.isArray(d?.children) ? d.children : d?.children ? [d.children] : [];
  const parentChain = Array.isArray(d?.parentChain) ? d.parentChain.map((p: any) => {
    const name = (p?.name || "").trim();
    const type = (p?.type || "").replace("ControlType.", "");
    return name ? (type ? `${type}: ${name}` : name) : (type || "");
  }).filter(Boolean) : [];
  return {
    name: d?.name || "",
    type: d?.type || "unknown",
    value: typeof d?.value === "string" ? d.value : "",
    bounds: d?.bounds || { x: 0, y: 0, width: 0, height: 0 },
    children: rawChildren.map(dotNetToUIElement),
    automationId: d?.autoId || d?.automationId || "",
    className: d?.className || "",
    isOffscreen: d?.isOffscreen || false,
    parentChain: parentChain.length > 0 ? parentChain : undefined,
    windowTitle: d?.windowTitle || undefined,
  };
}

function makeError(
  x: number,
  y: number,
  msg: string
): { element: UIElement; surrounding: UIElement[]; windowTree?: UIElement[]; visibleWindows?: VisibleWindow[] } {
  return {
    element: {
      name: "Error",
      type: "error",
      value: msg,
      bounds: { x, y, width: 0, height: 0 },
      children: [],
    },
    surrounding: [],
  };
}