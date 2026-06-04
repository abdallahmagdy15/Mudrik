import { exec } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const log = (msg: string) => console.log(`[VISION] ${msg}`);

const CAPTURE_SCRIPT_NAME = "hoverbuddy-capture-v5.ps1";
const RESIZE_SCRIPT_NAME = "hoverbuddy-resize-v3.ps1";
const MAX_IMAGE_BYTES = 200 * 1024;
const HARD_IMAGE_CAP_BYTES = 1024 * 1024;
const MAX_IMAGE_DIM = 1280;
const JPEG_QUALITY = 85;

function getCaptureScriptContent(): string {
  const lines: string[] = [];
  lines.push("param([int]$X1, [int]$Y1, [int]$X2, [int]$Y2, [string]$OutFile, [switch]$NoGrid, [int]$MaxDim = 1280)");
  lines.push("Add-Type @\"");
  lines.push("using System;");
  lines.push("using System.Runtime.InteropServices;");
  lines.push("public class DpiHelper {");
  lines.push("    [DllImport(\"user32.dll\")]");
  lines.push("    public static extern bool SetProcessDPIAware();");
  lines.push("}");
  lines.push("\"@");
  lines.push("[DpiHelper]::SetProcessDPIAware() | Out-Null");
  lines.push("Add-Type -AssemblyName System.Drawing");
  lines.push("");
  lines.push("$w = $X2 - $X1");
  lines.push("$h = $Y2 - $Y1");
  lines.push("if ($w -le 0 -or $h -le 0) {");
  lines.push("    Write-Error 'Invalid area'");
  lines.push("    exit 1");
  lines.push("}");
  lines.push("");
  lines.push("try {");
  lines.push("    $fullBmp = New-Object System.Drawing.Bitmap($w, $h)");
  lines.push("    $g = [System.Drawing.Graphics]::FromImage($fullBmp)");
  lines.push("    $g.CopyFromScreen($X1, $Y1, 0, 0, [System.Drawing.Size]::new($w, $h))");
  lines.push("    $g.Dispose()");
  lines.push("");
  lines.push("    # Downscale if longest side exceeds MaxDim");
  lines.push("    $newW = $w; $newH = $h");
  lines.push("    $maxSide = [Math]::Max($w, $h)");
  lines.push("    if ($maxSide -gt $MaxDim) {");
  lines.push("        $scale = $MaxDim / $maxSide");
  lines.push("        $newW = [int]($w * $scale)");
  lines.push("        $newH = [int]($h * $scale)");
  lines.push("        $bmp = New-Object System.Drawing.Bitmap($newW, $newH)");
  lines.push("        $g2 = [System.Drawing.Graphics]::FromImage($bmp)");
  lines.push("        $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic");
  lines.push("        $g2.DrawImage($fullBmp, 0, 0, $newW, $newH)");
  lines.push("        $g2.Dispose()");
  lines.push("        $fullBmp.Dispose()");
  lines.push("    } else {");
  lines.push("        $bmp = $fullBmp");
  lines.push("    }");
  lines.push("");
  lines.push("    # --- Coordinate ruler overlay on final (possibly downscaled) bitmap ---");
  lines.push("    if (-not $NoGrid) {");
  lines.push("        $g3 = [System.Drawing.Graphics]::FromImage($bmp)");
  lines.push("        $cellW = [Math]::Max(60, [int][Math]::Round($newW / 25))");
  lines.push("        $cellH = [Math]::Max(60, [int][Math]::Round($newH / 25))");
  lines.push("        $gridPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(50, 180, 180, 180), 1)");
  lines.push("        for ($x = $cellW; $x -lt $newW; $x += $cellW) { $g3.DrawLine($gridPen, $x, 0, $x, $newH) }");
  lines.push("        for ($y = $cellH; $y -lt $newH; $y += $cellH) { $g3.DrawLine($gridPen, 0, $y, $newW, $y) }");
  lines.push("        $gridPen.Dispose()");
  lines.push("");
  lines.push("        $font = New-Object System.Drawing.Font('Consolas', 10, [System.Drawing.FontStyle]::Bold)");
  lines.push("        $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(140, 0, 0, 0))");
  lines.push("        $fg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(210, 255, 255, 255))");
  lines.push("");
  lines.push("        $col = 0");
  lines.push("        for ($x = 0; $x -lt $newW; $x += $cellW) {");
  lines.push("            $label = \"$col\"");
  lines.push("            $sz = $g3.MeasureString($label, $font)");
  lines.push("            $cx = $x + ($cellW - $sz.Width) / 2");
  lines.push("            $cy = 2");
  lines.push("            $g3.FillRectangle($bg, $cx - 2, $cy, $sz.Width + 4, $sz.Height + 2)");
  lines.push("            $g3.DrawString($label, $font, $fg, $cx, $cy)");
  lines.push("            $col++");
  lines.push("        }");
  lines.push("");
  lines.push("        $row = 0");
  lines.push("        for ($y = 0; $y -lt $newH; $y += $cellH) {");
  lines.push("            $label = \"$row\"");
  lines.push("            $sz = $g3.MeasureString($label, $font)");
  lines.push("            $cx = 2");
  lines.push("            $cy = $y + ($cellH - $sz.Height) / 2");
  lines.push("            $g3.FillRectangle($bg, $cx, $cy - 2, $sz.Width + 4, $sz.Height + 4)");
  lines.push("            $g3.DrawString($label, $font, $fg, $cx, $cy)");
  lines.push("            $row++");
  lines.push("        }");
  lines.push("        $font.Dispose(); $bg.Dispose(); $fg.Dispose(); $g3.Dispose()");
  lines.push("    }");
  lines.push("");
  lines.push("    $jpgCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1");
  lines.push("    $encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)");
  lines.push("    $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]" + JPEG_QUALITY + ")");
  lines.push("    $bmp.Save($OutFile, $jpgCodec, $encParams)");
  lines.push("    $bmp.Dispose()");
  lines.push("    Write-Output 'OK'");
  lines.push("} catch {");
  lines.push("    Write-Error $_.Exception.Message");
  lines.push("    exit 1");
  lines.push("}");
  return lines.join("\n");
}

function getResizeScriptContent(): string {
  const lines: string[] = [];
  lines.push("param([string]$InFile, [string]$OutFile, [int]$MaxBytes)");
  lines.push("Add-Type -AssemblyName System.Drawing");
  lines.push("");
  lines.push("try {");
  lines.push("    $img = [System.Drawing.Image]::FromFile($InFile)");
  lines.push("    $quality = 80");
  lines.push("    $tmpFile = $InFile + '.tmp.jpg'");
  lines.push("");
  lines.push("    for ($i = 0; $i -lt 7; $i++) {");
  lines.push("        $encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)");
  lines.push("        $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$quality)");
  lines.push("        $jpgCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1");
  lines.push("        $img.Save($tmpFile, $jpgCodec, $encParams)");
  lines.push("        $size = (Get-Item $tmpFile).Length");
  lines.push("        if ($size -le $MaxBytes) {");
  lines.push("            Copy-Item $tmpFile $OutFile -Force");
  lines.push("            Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue");
  lines.push("            $img.Dispose()");
  lines.push("            Write-Output \"OK q=$quality size=$size\"");
  lines.push("            exit 0");
  lines.push("        }");
  lines.push("        $quality = [Math]::Max(15, $quality - 10)");
  lines.push("        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue");
  lines.push("    }");
  lines.push("");
  lines.push("    $scale = 0.85");
  lines.push("    for ($i = 0; $i -lt 8; $i++) {");
  lines.push("        $newW = [int]($img.Width * $scale)");
  lines.push("        $newH = [int]($img.Height * $scale)");
  lines.push("        if ($newW -lt 200 -or $newH -lt 200) { break }");
  lines.push("        $small = New-Object System.Drawing.Bitmap($newW, $newH)");
  lines.push("        $sg = [System.Drawing.Graphics]::FromImage($small)");
  lines.push("        $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic");
  lines.push("        $sg.DrawImage($img, 0, 0, $newW, $newH)");
  lines.push("        $sg.Dispose()");
  lines.push("        $q = [Math]::Max(40, [int](60 + (0.85 - $scale) * 200))");
  lines.push("        $encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)");
  lines.push("        $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$q)");
  lines.push("        $jpgCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1");
  lines.push("        $small.Save($tmpFile, $jpgCodec, $encParams)");
  lines.push("        $size = (Get-Item $tmpFile).Length");
  lines.push("        if ($size -le $MaxBytes) {");
  lines.push("            Copy-Item $tmpFile $OutFile -Force");
  lines.push("            Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue");
  lines.push("            $small.Dispose()");
  lines.push("            $img.Dispose()");
  lines.push("            Write-Output \"OK scale=$scale q=$q size=$size\"");
  lines.push("            exit 0");
  lines.push("        }");
  lines.push("        $small.Dispose()");
  lines.push("        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue");
  lines.push("        $scale = [Math]::Max(0.25, $scale - 0.08)");
  lines.push("    }");
  lines.push("");
  lines.push("    $fallbackW = [Math]::Max(200, [int]($img.Width * 0.2))");
  lines.push("    $fallbackH = [Math]::Max(200, [int]($img.Height * 0.2))");
  lines.push("    $fallbackImg = New-Object System.Drawing.Bitmap($fallbackW, $fallbackH)");
  lines.push("    $fg = [System.Drawing.Graphics]::FromImage($fallbackImg)");
  lines.push("    $fg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic");
  lines.push("    $fg.DrawImage($img, 0, 0, $fallbackW, $fallbackH)");
  lines.push("    $fg.Dispose()");
  lines.push("    $encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)");
  lines.push("    $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]15)");
  lines.push("    $jpgCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1");
  lines.push("    $fallbackImg.Save($OutFile, $jpgCodec, $encParams)");
  lines.push("    $fallbackImg.Dispose()");
  lines.push("    $img.Dispose()");
  lines.push("    Write-Output 'FALLBACK'");
  lines.push("} catch {");
  lines.push("    Write-Error $_.Exception.Message");
  lines.push("    exit 1");
  lines.push("}");
  return lines.join("\n");
}

let captureScriptPath: string | null = null;
let resizeScriptPath: string | null = null;

function ensureCaptureScript(): string {
  if (captureScriptPath && fs.existsSync(captureScriptPath)) {
    return captureScriptPath;
  }
  const tmpDir = path.join(os.tmpdir(), "hoverbuddy");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  captureScriptPath = path.join(tmpDir, CAPTURE_SCRIPT_NAME);
  fs.writeFileSync(captureScriptPath, getCaptureScriptContent(), "utf-8");
  return captureScriptPath;
}

function ensureResizeScript(): string {
  if (resizeScriptPath && fs.existsSync(resizeScriptPath)) {
    return resizeScriptPath;
  }
  const tmpDir = path.join(os.tmpdir(), "hoverbuddy");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  resizeScriptPath = path.join(tmpDir, RESIZE_SCRIPT_NAME);
  fs.writeFileSync(resizeScriptPath, getResizeScriptContent(), "utf-8");
  return resizeScriptPath;
}

function captureRegion(x1: number, y1: number, x2: number, y2: number, opts?: { noGrid?: boolean }): Promise<string> {
  const tmpDir = path.join(os.tmpdir(), "hoverbuddy");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const outFile = path.join(tmpDir, `capture-${Date.now()}.jpg`);

  return new Promise((resolve, reject) => {
    const script = ensureCaptureScript();
    const noGridFlag = opts?.noGrid ? " -NoGrid" : "";
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" ${x1} ${y1} ${x2} ${y2} "${outFile}"${noGridFlag}`;
    log(`Capturing region (${x1},${y1})-(${x2},${y2})${opts?.noGrid ? " [no-grid]" : ""}`);

    exec(cmd, { timeout: 10000 }, (err: any, _stdout: string, stderr: string) => {
      if (err) {
        log(`Capture failed: ${err.message}`);
        reject(new Error(stderr || err.message));
        return;
      }
      if (!fs.existsSync(outFile)) {
        reject(new Error("Screenshot file not created"));
        return;
      }
      log(`Screenshot saved: ${outFile} (${fs.statSync(outFile).size} bytes)`);
      resolve(outFile);
    });
  });
}

async function optimizeImage(imagePath: string): Promise<string> {
  const size = fs.statSync(imagePath).size;
  if (size <= MAX_IMAGE_BYTES) {
    log(`Image already under limit: ${(size / 1024).toFixed(0)}kb`);
    return imagePath;
  }

  log(`Image too large (${(size / 1024).toFixed(0)}kb), optimizing to ~200kb...`);
  const tmpDir = path.join(os.tmpdir(), "hoverbuddy");
  const outFile = path.join(tmpDir, `optimized-${Date.now()}.jpg`);
  const script = ensureResizeScript();

  return new Promise((resolve) => {
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" "${imagePath}" "${outFile}" ${MAX_IMAGE_BYTES}`;
    exec(cmd, { timeout: 15000 }, (err: any, stdout: string, stderr: string) => {
      if (err) {
        log(`Resize failed: ${err.message}`);
        const fsize = fs.existsSync(imagePath) ? fs.statSync(imagePath).size : 0;
        if (fsize > HARD_IMAGE_CAP_BYTES) {
          log(`Image too large after resize failure (${(fsize / 1024).toFixed(0)}kb), discarding`);
          try { fs.unlinkSync(imagePath); } catch { /* ignore */ }
          resolve("");
        } else {
          resolve(imagePath);
        }
        return;
      }
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
        const newSize = fs.statSync(outFile).size;
        log(`Optimized: ${(size / 1024).toFixed(0)}kb -> ${(newSize / 1024).toFixed(0)}kb (${stdout.trim()})`);
        try { fs.unlinkSync(imagePath); } catch { /* ignore */ }
        resolve(outFile);
      } else {
        log(`Resize output missing`);
        const fsize = fs.existsSync(imagePath) ? fs.statSync(imagePath).size : 0;
        if (fsize > HARD_IMAGE_CAP_BYTES) {
          log(`Image too large after resize output missing (${(fsize / 1024).toFixed(0)}kb), discarding`);
          try { fs.unlinkSync(imagePath); } catch { /* ignore */ }
          resolve("");
        } else {
          resolve(imagePath);
        }
      }
    });
  });
}

const MAX_FOCUS_DIM = 500;

export function computeFocusRegion(
  _bounds: { x: number; y: number; width: number; height: number },
  _cursorPos: { x: number; y: number }
): { x1: number; y1: number; x2: number; y2: number } {
  const electronScreen = require("electron").screen;
  const primary = electronScreen.getPrimaryDisplay();
  const sf = primary.scaleFactor;
  const b = primary.bounds;
  return {
    x1: Math.round(b.x * sf),
    y1: Math.round(b.y * sf),
    x2: Math.round((b.x + b.width) * sf),
    y2: Math.round((b.y + b.height) * sf),
  };
}

export async function captureAndOptimize(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts?: { noGrid?: boolean },
): Promise<string | null> {
  log(`captureAndOptimize: (${x1},${y1}) to (${x2},${y2})${opts?.noGrid ? " [no-grid]" : ""}`);
  try {
    let imagePath: string;
    try {
      imagePath = await captureRegion(x1, y1, x2, y2, opts);
    } catch (err: any) {
      log(`Screenshot capture failed: ${err.message}`);
      return null;
    }

    try {
      const result = await optimizeImage(imagePath);
      if (!result) {
        log(`Image too large, discarded`);
        return null;
      }
      return result;
    } catch (err: any) {
      log(`Image optimization failed: ${err.message}`);
      const fsize = fs.statSync(imagePath).size;
      if (fsize > HARD_IMAGE_CAP_BYTES) {
        log(`Image too large after optimization failure (${(fsize / 1024).toFixed(0)}kb), discarding`);
        try { fs.unlinkSync(imagePath); } catch { /* ignore */ }
        return null;
      }
      return imagePath;
    }
  } catch (err: any) {
    log(`captureAndOptimize FAILED: ${err.message}`);
    return null;
  }
}

export function cleanupImage(imagePath: string): void {
  try {
    if (imagePath && fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
  } catch { /* ignore */ }
}