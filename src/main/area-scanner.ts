import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { UIElement } from "../shared/types";
import { captureAndOptimize } from "./vision";
import { runPowerShell } from "./powershell-runner";

const log = (msg: string) => console.log(`[AREA-SCANNER] ${msg}`);

const SCRIPT_NAME = "hoverbuddy-area-scan-v3.ps1";

function getScriptContent(): string {
  const lines: string[] = [];
  lines.push('param([int]$X1, [int]$Y1, [int]$X2, [int]$Y2, [string]$OutputFile)');
  lines.push('Add-Type -AssemblyName PresentationCore');
  lines.push('Add-Type -AssemblyName UIAutomationClient');
  lines.push('$ErrorActionPreference = "Stop"');
  lines.push('');
  lines.push('$selW = $X2 - $X1');
  lines.push('$selH = $Y2 - $Y1');
  lines.push('$selArea = $selW * $selH');
  lines.push('');
  lines.push('function ElementToDict($el) {');
  lines.push('    $dict = @{}');
  lines.push('    try { $dict["name"] = $el.Current.Name } catch { $dict["name"] = "" }');
  lines.push('    try { $dict["type"] = $el.Current.ControlType.ProgrammaticName } catch { $dict["type"] = "Unknown" }');
  lines.push('    try {');
  lines.push('        $val = $null');
  lines.push('        $ok = $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$val)');
  lines.push('        if ($ok -and $val) { $dict["value"] = $val.Current.Value }');
  lines.push('        else {');
  lines.push('            $txt = $null');
  lines.push('            $ok2 = $el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$txt)');
  lines.push('            if ($ok2 -and $txt) {');
  lines.push('                try { $dict["value"] = $txt.DocumentRange.GetText(500) } catch { $dict["value"] = "" }');
  lines.push('            }');
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
  lines.push('');
  lines.push('    $contained = $false');
  lines.push('    try {');
  lines.push('        $r = $el.Current.BoundingRectangle');
  lines.push('        if ($r.X -ge $X1 -and $r.Y -ge $Y1 -and ($r.X + $r.Width) -le $X2 -and ($r.Y + $r.Height) -le $Y2) {');
  lines.push('            $contained = $true');
  lines.push('        }');
  lines.push('    } catch {}');
  lines.push('    $dict["isContained"] = $contained');
  lines.push('    $dict["hasMatchingChildren"] = $false');
  lines.push('    $dict["depth"] = 0');
  lines.push('    $children = @()');
  lines.push('    $dict["children"] = $children');
  lines.push('    $dict');
  lines.push('}');
  lines.push('');
  lines.push('$script:allElements = @()');
  lines.push('');
  lines.push('function RectsOverlap($r) {');
  lines.push('    if ($r.Width -le 0 -or $r.Height -le 0) { return $false }');
  lines.push('    if ($r.X -ge $X2) { return $false }');
  lines.push('    if ($r.Y -ge $Y2) { return $false }');
  lines.push('    if (($r.X + $r.Width) -le $X1) { return $false }');
  lines.push('    if (($r.Y + $r.Height) -le $Y1) { return $false }');
  lines.push('    return $true');
  lines.push('}');
  lines.push('');
  lines.push('function IsTooBig($r) {');
  lines.push('    $elArea = $r.Width * $r.Height');
  lines.push('    if ($elArea -gt $selArea * 4) { return $true }');
  lines.push('    if ($r.Width -gt $selW * 3 -and $r.Height -gt $selH * 3) { return $true }');
  lines.push('    return $false');
  lines.push('}');
  lines.push('');
  lines.push('$containerTypes = @("ControlType.Window", "ControlType.Pane", "ControlType.Group", "ControlType.Custom")');
  lines.push('');
  lines.push('function IsContainerType($t) {');
  lines.push('    foreach ($ct in $containerTypes) {');
  lines.push('        if ($t -eq $ct) { return $true }');
  lines.push('    }');
  lines.push('    return $false');
  lines.push('}');
  lines.push('');
  lines.push('function ScanElements($root, $depth, $maxDepth) {');
  lines.push('    if ($depth -gt $maxDepth) { return }');
  lines.push('    if ($script:allElements.Count -ge 120) { return }');
  lines.push('    try {');
  lines.push('        $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)');
  lines.push('        foreach ($child in $children) {');
  lines.push('            try {');
  lines.push('                $r = $child.Current.BoundingRectangle');
  lines.push('                if (-not (RectsOverlap $r)) { continue }');
  lines.push('                if (IsTooBig $r) {');
  lines.push('                    ScanElements $child ($depth+1) $maxDepth');
  lines.push('                    continue');
  lines.push('                }');
  lines.push('                $d = ElementToDict $child');
  lines.push('                $d["depth"] = $depth');
  lines.push('');
  lines.push('                $hasName = [bool]$d["name"]');
  lines.push('                $hasValue = [bool]$d["value"]');
  lines.push('                $hasAutoId = [bool]$d["autoId"]');
  lines.push('                $isContainer = IsContainerType $d["type"]');
  lines.push('');
  lines.push('                if ($isContainer -and -not $hasName -and -not $hasValue) {');
  lines.push('                    ScanElements $child ($depth+1) $maxDepth');
  lines.push('                    continue');
  lines.push('                }');
  lines.push('');
  lines.push('                if ($hasName -or $hasValue -or $hasAutoId) {');
  lines.push('                    $script:allElements += $d');
  lines.push('                }');
  lines.push('');
  lines.push('                ScanElements $child ($depth+1) $maxDepth');
  lines.push('            } catch {}');
  lines.push('        }');
  lines.push('    } catch {}');
  lines.push('}');
  lines.push('');
  lines.push('try {');
  lines.push('    $root = [System.Windows.Automation.AutomationElement]::RootElement');
  lines.push('    ScanElements $root 0 15');
  lines.push('');
  lines.push('    $seen = @{}');
  lines.push('    $deduped = @()');
  lines.push('    foreach ($el in $script:allElements) {');
  lines.push('        $key = "$($el.type)|$($el.name)|$($el.bounds.x)|$($el.bounds.y)|$($el.bounds.width)|$($el.bounds.height)"');
  lines.push('        if (-not $seen.ContainsKey($key)) {');
  lines.push('            $seen[$key] = $true');
  lines.push('            $deduped += $el');
  lines.push('        }');
  lines.push('    }');
  lines.push('');
  lines.push('    $sorted = $deduped | Sort-Object { $_.depth }, { $_.bounds.y }, { $_.bounds.x }');
  lines.push('');
  lines.push('    $final = @()');
  lines.push('    foreach ($el in $sorted) {');
  lines.push('        $keep = $true');
  lines.push('        if ((IsContainerType $el.type) -and $sorted.Count -gt 3) {');
  lines.push('            $parentBounds = $el.bounds');
  lines.push('            $childCount = 0');
  lines.push('            foreach ($other in $sorted) {');
  lines.push('                if ($other -eq $el) { continue }');
  lines.push('                if ($other.depth -gt $el.depth) {');
  lines.push('                    $ob = $other.bounds');
  lines.push('                    if ($ob.x -ge $parentBounds.x -and $ob.y -ge $parentBounds.y -and ($ob.x + $ob.width) -le ($parentBounds.x + $parentBounds.width) -and ($ob.y + $ob.height) -le ($parentBounds.y + $parentBounds.height)) {');
  lines.push('                        $childCount++');
  lines.push('                    }');
  lines.push('                }');
  lines.push('            }');
  lines.push('            if ($childCount -ge 2) { $keep = $false }');
  lines.push('        }');
  lines.push('        if ($keep) { $final += $el }');
  lines.push('    }');
  lines.push('');
  lines.push('    if ($final.Count -gt 60) {');
  lines.push('        $final = $final | Sort-Object { $_.depth }, { $_.bounds.y }, { $_.bounds.x } | Select-Object -First 60');
  lines.push('    }');
  lines.push('');
  lines.push('    @{ elements=$final; count=$final.Count; totalScanned=$script:allElements.Count; rect=@{ x1=$X1; y1=$Y1; x2=$X2; y2=$Y2 } } | ConvertTo-Json -Depth 4 -Compress | Out-File -FilePath $OutputFile -Encoding utf8');
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
  log(`Area scan script written to: ${scriptPath}`);
  return scriptPath;
}

export async function scanArea(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Promise<{ elements: UIElement[]; rect: { x1: number; y1: number; x2: number; y2: number }; imagePath?: string }> {
  log(`scanArea: (${x1},${y1}) to (${x2},${y2})`);
  const startTime = Date.now();

  const [uiaResult, imagePath] = await Promise.all([
    scanAreaUIA(x1, y1, x2, y2),
    captureAndOptimize(x1, y1, x2, y2).catch((err: Error) => {
      log(`Image capture failed (non-fatal): ${err.message}`);
      return null;
    }),
  ]);

  log(`scanArea total: ${uiaResult.elements.length} UIA elements, image=${imagePath ? "captured" : "none"}, took ${Date.now() - startTime}ms`);
  return { ...uiaResult, imagePath: imagePath || undefined };
}

async function scanAreaUIA(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Promise<{ elements: UIElement[]; rect: { x1: number; y1: number; x2: number; y2: number } }> {
  log(`scanAreaUIA: (${x1},${y1}) to (${x2},${y2})`);
  const startTime = Date.now();

  try {
    const script = ensureScriptFile();
    const { output, stderr, exitCode } = await runPowerShell(script, [String(x1), String(y1), String(x2), String(y2)], { timeout: 15000 });

    const elapsed = Date.now() - startTime;
    log(`Area scan completed in ${elapsed}ms, output length=${output.length}, exitCode=${exitCode}`);
    if (stderr) log(`Area scan stderr (non-fatal): ${stderr.slice(0, 200)}`);

    if (!output) {
      return { elements: [], rect: { x1, y1, x2, y2 } };
    }

    const parsed = JSON.parse(output);
    if (parsed.error) {
      log(`Area scan script error: ${parsed.error}`);
      return { elements: [], rect: { x1, y1, x2, y2 } };
    }

    const rawElements = Array.isArray(parsed.elements) ? parsed.elements : parsed.elements ? [parsed.elements] : [];

    const elements: UIElement[] = rawElements.map((e: any) => ({
      name: e?.name || "",
      type: e?.type || "unknown",
      value: typeof e?.value === "string" ? e.value : "",
      bounds: e?.bounds || { x: 0, y: 0, width: 0, height: 0 },
      children: [],
      automationId: e?.autoId || "",
      className: e?.className || "",
      isOffscreen: e?.isOffscreen || false,
    }));

    log(`Area scan found ${elements.length} elements (total scanned: ${parsed.totalScanned ?? "n/a"})`);
    for (let i = 0; i < Math.min(elements.length, 15); i++) {
      const el = elements[i];
      log(`  [${i}] type=${el.type} name="${el.name}" value="${el.value.slice(0, 60)}" bounds=(${el.bounds.x},${el.bounds.y} ${el.bounds.width}x${el.bounds.height})`);
    }
    return { elements, rect: { x1, y1, x2, y2 } };
  } catch (err: any) {
    log(`scanArea FAILED: ${err.message}`);
    return { elements: [], rect: { x1, y1, x2, y2 } };
  }
}