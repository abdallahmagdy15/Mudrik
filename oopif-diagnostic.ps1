# Mudrik OOPIF Diagnostic — run this in PowerShell to test whether
# Chromium child/iframe HWNDs exist and are accessible via UIA.
#
# Usage: powershell -ExecutionPolicy Bypass -File oopif-diagnostic.ps1
#
# 1. Bring the target Chromium window (e.g. OpenCode desktop) to the foreground.
# 2. Run this script.
# 3. It reports:
#    - Main window class, HWND, PID
#    - UIA element count BEFORE wake
#    - UIA element count AFTER wake
#    - Any child HWNDs belonging to the same PID
#    - Additional Document elements found inside those child HWNDs

Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinApi {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeoutMs, out IntPtr lResult);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

$WM_GETOBJECT = 0x003D
$UiaRootObjectId = [IntPtr](-25)
$OBJID_CLIENT = [IntPtr](-4)

function Wake($hwnd) {
    $r = [IntPtr]::Zero
    [WinApi]::SendMessageTimeout($hwnd, $WM_GETOBJECT, [IntPtr]::Zero, $UiaRootObjectId, 0x0002, 200, [ref]$r) | Out-Null
    [WinApi]::SendMessageTimeout($hwnd, $WM_GETOBJECT, [IntPtr]::Zero, $OBJID_CLIENT, 0x0002, 200, [ref]$r) | Out-Null
}

function CountElements($root) {
    try {
        $kids = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
        $sum = $kids.Count
        foreach ($k in $kids) {
            try { $sum += $k.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition).Count } catch {}
        }
        return $sum
    } catch { return 0 }
}

function HasDocument($root) {
    try {
        $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElementIdentifiers]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
        $found = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
        return ($found -ne $null)
    } catch { return $false }
}

$fgHwnd = [WinApi]::GetForegroundWindow()
$sbCls = New-Object System.Text.StringBuilder 256
[WinApi]::GetClassName($fgHwnd, $sbCls, 256) | Out-Null
$cls = $sbCls.ToString()
$targetPid = 0
[WinApi]::GetWindowThreadProcessId($fgHwnd, [ref]$targetPid) | Out-Null

Write-Host "========================================"
Write-Host "Foreground HWND : $fgHwnd"
Write-Host "Window class   : $cls"
Write-Host "PID            : $targetPid" -ForegroundColor Cyan

# Register UIA focus handler so Chromium sees AT client
$focusHandler = [System.Windows.Automation.AutomationFocusChangedEventHandler]{ param($s, $e) }
try { [System.Windows.Automation.Automation]::AddAutomationFocusChangedEventHandler($focusHandler) } catch {}

$mainRoot = $null
try { $mainRoot = [System.Windows.Automation.AutomationElement]::FromHandle($fgHwnd) } catch {}
if (-not $mainRoot) {
    Write-Host "Could not get UIA root for foreground window." -ForegroundColor Red
    exit 1
}

$preCount = CountElements $mainRoot
$preDoc = HasDocument $mainRoot
Write-Host "Pre-wake  count=$preCount hasDocument=$preDoc"

Wake $fgHwnd
Start-Sleep -Milliseconds 1000
$postCount = CountElements $mainRoot
$postDoc = HasDocument $mainRoot
Write-Host "Post-wake count=$postCount hasDocument=$postDoc"

# Enumerate all visible top-level windows with same PID
$childHwnds = New-Object System.Collections.ArrayList
$enumCallback = [WinApi+EnumWindowsProc] {
    param([IntPtr]$hwnd, [IntPtr]$lParam)
    try {
        if (-not [WinApi]::IsWindowVisible($hwnd)) { return $true }
        $r = New-Object WinApi+RECT
        if (-not [WinApi]::GetWindowRect($hwnd, [ref]$r)) { return $true }
        if (($r.Right - $r.Left) -le 0 -or ($r.Bottom - $r.Top) -le 0) { return $true }
        $pid = 0
        [WinApi]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
        if ($pid -eq $targetPid -and $hwnd -ne $fgHwnd) {
            [void]$childHwnds.Add(@{ hwnd = $hwnd; rect = $r })
        }
    } catch {}
    return $true
}
[WinApi]::EnumWindows($enumCallback, [IntPtr]::Zero) | Out-Null

Write-Host ""
Write-Host "Child HWNDs found for same PID: $($childHwnds.Count)" -ForegroundColor Yellow

$totalExtra = 0
$totalExtraDocs = 0

foreach ($ch in $childHwnds) {
    $h = $ch.hwnd
    $r = $ch.rect
    Wake $h
    try {
        $cr = [System.Windows.Automation.AutomationElement]::FromHandle($h)
        if ($cr -and $cr.Current.ControlType.ProgrammaticName -eq "ControlType.Window") {
            $c = CountElements $cr
            $d = HasDocument $cr
            Write-Host "  HWND=$h rect=($($r.Left),$($r.Top) $($r.Right-$r.Left)x$($r.Bottom-$r.Top)) elements=$c hasDocument=$d"
            if ($c -gt 0) { $totalExtra += $c }
            if ($d) { $totalExtraDocs++ }
        } else {
            Write-Host "  HWND=$h — not a UIA Window root (skipped)"
        }
    } catch {
        Write-Host "  HWND=$h — UIA error (skipped)"
    }
}

Write-Host ""
Write-Host "Summary: main=$postCount extraElements=$totalExtra extraDocuments=$totalExtraDocs" -ForegroundColor Green
