import { exec } from "child_process";
import { UIElement } from "../shared/types";

const POWERSHELL_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient
$ErrorActionPreference = "Stop"

$x = [int]$env:HOVERBUDDY_X
$y = [int]$env:HOVERBUDDY_Y

function ElementToDict($el) {
    $dict = @{}
    try { $dict["name"] = $el.Current.Name } catch { $dict["name"] = "" }
    try { $dict["type"] = $el.Current.ControlType.ProgrammaticName } catch { $dict["type"] = "Unknown" }
    try {
        $val = $null
        $ok = $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$val)
        if ($ok -and $val) { $dict["value"] = $val.Current.Value }
        else {
            $txt = $null
            $ok2 = $el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$txt)
            if ($ok2 -and $txt) { $dict["value"] = $txt.DocumentRange.GetText(-1) }
            else { $dict["value"] = "" }
        }
    } catch { $dict["value"] = "" }
    try {
        $r = $el.Current.BoundingRectangle
        $dict["bounds"] = @{ x = [int]$r.X; y = [int]$r.Y; width = [int]$r.Width; height = [int]$r.Height }
    } catch { $dict["bounds"] = @{ x = 0; y = 0; width = 0; height = 0 } }

    $children = @()
    try {
        $childEls = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
        $max = [Math]::Min($childEls.Count, 5)
        for ($i = 0; $i -lt $max; $i++) {
            try { $children += ElementToDict $childEls[$i] } catch {}
        }
    } catch {}
    $dict["children"] = $children
    $dict
}

try {
    $point = New-Object System.Windows.Point($x, $y)
    $element = [System.Windows.Automation.AutomationElement]::FromPoint($point)

    $result = @{}
    $result["element"] = ElementToDict $element

    $surrounding = @()
    try {
        $parent = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($element)
        if ($parent) {
            $siblings = $parent.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
            $max = [Math]::Min($siblings.Count, 10)
            for ($i = 0; $i -lt $max; $i++) {
                try {
                    $sib = ElementToDict $siblings[$i]
                    if ($sib["name"] -or $sib["value"]) { $surrounding += $sib }
                } catch {}
            }
        }
    } catch {}

    $result["surrounding"] = $surrounding
    $result | ConvertTo-Json -Depth 5 -Compress
} catch {
    write-error $_.Exception.Message
    exit 1
}
`;

export function getCursorPos(): { x: number; y: number } {
  const robot = require("robotjs");
  const pos = robot.getMousePos();
  return { x: pos.x, y: pos.y };
}

export async function readContextAtPoint(
  x: number,
  y: number
): Promise<{ element: UIElement; surrounding: UIElement[] }> {
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const proc = require("child_process").exec(
        `powershell -NoProfile -Command "& { $env:HOVERBUDDY_X='${x}'; $env:HOVERBUDDY_Y='${y}'; ${POWERSHELL_SCRIPT.replace(/'/g, "''")} }"`,
        { maxBuffer: 1024 * 1024, timeout: 5000 },
        (err: any, stdout: string, stderr: string) => {
          if (err) {
            reject(new Error(stderr || err.message));
            return;
          }
          resolve(stdout.trim());
        }
      );
    });

    if (!result) {
      return makeError(x, y, "Empty response from PowerShell");
    }

    const parsed = JSON.parse(result);
    return {
      element: dotNetToUIElement(parsed.element),
      surrounding: (parsed.surrounding || []).map(dotNetToUIElement),
    };
  } catch (err: any) {
    return makeError(x, y, err.message || String(err));
  }
}

function dotNetToUIElement(d: any): UIElement {
  return {
    name: d?.name || "",
    type: d?.type || "unknown",
    value: d?.value || "",
    bounds: d?.bounds || { x: 0, y: 0, width: 0, height: 0 },
    children: (d?.children || []).map(dotNetToUIElement),
  };
}

function makeError(
  x: number,
  y: number,
  msg: string
): { element: UIElement; surrounding: UIElement[] } {
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