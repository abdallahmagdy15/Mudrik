import { exec } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const log = (msg: string) => console.log(`[VISION] ${msg}`);

const CAPTURE_SCRIPT_NAME = "hoverbuddy-capture-v2.ps1";
const RESIZE_SCRIPT_NAME = "hoverbuddy-resize-v1.ps1";
const MAX_IMAGE_BYTES = 200 * 1024;

function getCaptureScriptContent(): string {
  const lines: string[] = [];
  lines.push("param([int]$X1, [int]$Y1, [int]$X2, [int]$Y2, [string]$OutFile)");
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
  lines.push("    $bmp = New-Object System.Drawing.Bitmap($w, $h)");
  lines.push("    $g = [System.Drawing.Graphics]::FromImage($bmp)");
  lines.push("    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic");
  lines.push("    $g.CopyFromScreen($X1, $Y1, 0, 0, [System.Drawing.Size]::new($w, $h))");
  lines.push("    $g.Dispose()");
  lines.push("    $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)");
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
  lines.push("    $quality = 85");
  lines.push("    $tmpFile = $InFile + '.tmp.jpg'");
  lines.push("");
  lines.push("    for ($i = 0; $i -lt 8; $i++) {");
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
  lines.push("        $quality = [Math]::Max(10, $quality - 10)");
  lines.push("        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue");
  lines.push("    }");
  lines.push("");
  lines.push("    $scale = 0.75");
  lines.push("    for ($i = 0; $i -lt 6; $i++) {");
  lines.push("        $newW = [int]($img.Width * $scale)");
  lines.push("        $newH = [int]($img.Height * $scale)");
  lines.push("        $small = New-Object System.Drawing.Bitmap($newW, $newH)");
  lines.push("        $sg = [System.Drawing.Graphics]::FromImage($small)");
  lines.push("        $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic");
  lines.push("        $sg.DrawImage($img, 0, 0, $newW, $newH)");
  lines.push("        $sg.Dispose()");
  lines.push("        $encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)");
  lines.push("        $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]60)");
  lines.push("        $jpgCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1");
  lines.push("        $small.Save($tmpFile, $jpgCodec, $encParams)");
  lines.push("        $size = (Get-Item $tmpFile).Length");
  lines.push("        if ($size -le $MaxBytes) {");
  lines.push("            Copy-Item $tmpFile $OutFile -Force");
  lines.push("            Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue");
  lines.push("            $small.Dispose()");
  lines.push("            $img.Dispose()");
  lines.push("            Write-Output \"OK scale=$scale q=60 size=$size\"");
  lines.push("            exit 0");
  lines.push("        }");
  lines.push("        $small.Dispose()");
  lines.push("        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue");
  lines.push("        $scale = [Math]::Max(0.2, $scale - 0.1)");
  lines.push("    }");
  lines.push("");
  lines.push("    Copy-Item $InFile $OutFile -Force");
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

function captureRegion(x1: number, y1: number, x2: number, y2: number): Promise<string> {
  const tmpDir = path.join(os.tmpdir(), "hoverbuddy");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const outFile = path.join(tmpDir, `capture-${Date.now()}.png`);

  return new Promise((resolve, reject) => {
    const script = ensureCaptureScript();
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" ${x1} ${y1} ${x2} ${y2} "${outFile}"`;
    log(`Capturing region (${x1},${y1})-(${x2},${y2})`);

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
        log(`Resize failed: ${err.message}, using original`);
        resolve(imagePath);
        return;
      }
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
        const newSize = fs.statSync(outFile).size;
        log(`Optimized: ${(size / 1024).toFixed(0)}kb -> ${(newSize / 1024).toFixed(0)}kb (${stdout.trim()})`);
        try { fs.unlinkSync(imagePath); } catch { /* ignore */ }
        resolve(outFile);
      } else {
        log(`Resize output missing, using original`);
        resolve(imagePath);
      }
    });
  });
}

const MAX_FOCUS_DIM = 500;

export function computeFocusRegion(
  bounds: { x: number; y: number; width: number; height: number },
  cursorPos: { x: number; y: number }
): { x1: number; y1: number; x2: number; y2: number } {
  const area = bounds.width * bounds.height;
  if (area <= MAX_FOCUS_DIM * MAX_FOCUS_DIM * 2) {
    const pad = 40;
    return {
      x1: Math.max(0, bounds.x - pad),
      y1: Math.max(0, bounds.y - pad),
      x2: bounds.x + bounds.width + pad,
      y2: bounds.y + bounds.height + pad,
    };
  }
  const half = MAX_FOCUS_DIM / 2;
  return {
    x1: Math.max(0, Math.round(cursorPos.x - half)),
    y1: Math.max(0, Math.round(cursorPos.y - half)),
    x2: Math.round(cursorPos.x + half),
    y2: Math.round(cursorPos.y + half),
  };
}

export async function captureAndOptimize(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Promise<string | null> {
  log(`captureAndOptimize: (${x1},${y1}) to (${x2},${y2})`);
  try {
    let imagePath: string;
    try {
      imagePath = await captureRegion(x1, y1, x2, y2);
    } catch (err: any) {
      log(`Screenshot capture failed: ${err.message}`);
      return null;
    }

    try {
      return await optimizeImage(imagePath);
    } catch (err: any) {
      log(`Image optimization failed: ${err.message}`);
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