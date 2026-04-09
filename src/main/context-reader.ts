import { exec } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { UIElement } from "../shared/types";

const log = (msg: string) => console.log(`[CTX-READER] ${msg}`);

const SCRIPT_NAME = "hoverbuddy-read-context.ps1";

function getScriptContent(): string {
  return `
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName UIAutomationClient
$ErrorActionPreference = "Stop"

$x = [int]$args[0]
$y = [int]$args[1]

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
): Promise<{ element: UIElement; surrounding: UIElement[] }> {
  log(`readContextAtPoint called: x=${x}, y=${y}`);
  const startTime = Date.now();

  try {
    const script = ensureScriptFile();
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" ${x} ${y}`;

    log(`Spawning PowerShell: ${cmd}`);

    const result = await new Promise<string>((resolve, reject) => {
      exec(
        cmd,
        { maxBuffer: 1024 * 1024, timeout: 8000 },
        (err: any, stdout: string, stderr: string) => {
          const elapsed = Date.now() - startTime;
          if (err) {
            log(`PowerShell error after ${elapsed}ms: ${err.message}`);
            log(`PowerShell stderr: ${stderr.slice(0, 500)}`);
            reject(new Error(stderr || err.message));
            return;
          }
          log(`PowerShell completed in ${elapsed}ms, output length=${stdout.length}`);
          if (stderr) {
            log(`PowerShell stderr (non-fatal): ${stderr.slice(0, 200)}`);
          }
          resolve(stdout.trim());
        }
      );
    });

    if (!result) {
      log("ERROR: Empty response from PowerShell");
      return makeError(x, y, "Empty response from PowerShell");
    }

    log(`Parsing JSON response (${result.length} bytes)`);
    let parsed: any;
    try {
      parsed = JSON.parse(result);
    } catch (parseErr: any) {
      log(`JSON parse error: ${parseErr.message}`);
      log(`Raw response (first 500 chars): ${result.slice(0, 500)}`);
      return makeError(x, y, `JSON parse error: ${parseErr.message}`);
    }

    const element = dotNetToUIElement(parsed.element);
    const surrounding: UIElement[] = (parsed.surrounding || []).map(
      (s: any, i: number) => {
        log(`  surrounding[${i}]: type=${s?.type} name="${s?.name}"`);
        return dotNetToUIElement(s);
      }
    );

    log(`Context read success: element type="${element.type}" name="${element.name}" value="${String(element.value).slice(0, 80)}", ${surrounding.length} surrounding elements`);
    return { element, surrounding };
  } catch (err: any) {
    log(`readContextAtPoint FAILED: ${err.message}`);
    return makeError(x, y, err.message || String(err));
  }
}

function dotNetToUIElement(d: any): UIElement {
  return {
    name: d?.name || "",
    type: d?.type || "unknown",
    value: typeof d?.value === "string" ? d.value : "",
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