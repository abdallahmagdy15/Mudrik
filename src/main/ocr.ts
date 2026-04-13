import { exec } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const log = (msg: string) => console.log(`[OCR] ${msg}`);

const SCRIPT_NAME = "hoverbuddy-ocr-v1.ps1";

function getScriptContent(): string {
  const lines: string[] = [];
  lines.push("param([int]$X1, [int]$Y1, [int]$X2, [int]$Y2)");
  lines.push("Add-Type -AssemblyName System.Runtime.WindowsRuntime");
  lines.push("Add-Type -AssemblyName System.Drawing");
  lines.push("");
  lines.push("$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime]");
  lines.push("$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]");
  lines.push("$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]");
  lines.push("$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]");
  lines.push("$null = [Windows.Foundation.IAsyncOperation`1, Windows.Foundation, ContentType=WindowsRuntime]");
  lines.push("$null = [Windows.Foundation.IAsyncInfo, Windows.Foundation, ContentType=WindowsRuntime]");
  lines.push("");
  lines.push("$w = $X2 - $X1");
  lines.push("$h = $Y2 - $Y1");
  lines.push("if ($w -le 0 -or $h -le 0) {");
  lines.push('    @{ text=""; error="Invalid area" } | ConvertTo-Json -Compress');
  lines.push("    exit 0");
  lines.push("}");
  lines.push("");
  lines.push('$tmpFile = Join-Path $env:TEMP "hoverbuddy-ocr-$(Get-Random).png"');
  lines.push("");
  lines.push("try {");
  lines.push("    $bmp = New-Object System.Drawing.Bitmap($w, $h)");
  lines.push("    $g = [System.Drawing.Graphics]::FromImage($bmp)");
  lines.push("    $g.CopyFromScreen($X1, $Y1, 0, 0, [System.Drawing.Size]::new($w, $h))");
  lines.push("    $g.Dispose()");
  lines.push("    $bmp.Save($tmpFile, [System.Drawing.Imaging.ImageFormat]::Png)");
  lines.push("    $bmp.Dispose()");
  lines.push("");
  lines.push("    $AsTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {");
  lines.push("        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'");
  lines.push("    })[0]");
  lines.push("");
  lines.push("    function Await-Result($op, $resType) {");
  lines.push("        $task = $AsTaskGeneric.MakeGenericMethod($resType).Invoke($null, @($op))");
  lines.push("        $task.Wait()");
  lines.push("        return $task.Result");
  lines.push("    }");
  lines.push("");
  lines.push("    $storageFile = Await-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmpFile)) ([Windows.Storage.StorageFile])");
  lines.push("    $stream = Await-Result ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])");
  lines.push("    $decoder = Await-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])");
  lines.push("    $sBitmap = Await-Result ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])");
  lines.push("");
  lines.push("    $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()");
  lines.push("    if (-not $ocrEngine) {");
  lines.push('        @{ text=""; error="OCR engine not available" } | ConvertTo-Json -Compress');
  lines.push("        exit 0");
  lines.push("    }");
  lines.push("");
  lines.push("    $ocrResult = Await-Result ($ocrEngine.RecognizeAsync($sBitmap)) ([Windows.Media.Ocr.OcrResult])");
  lines.push("    $lines = @()");
  lines.push("    foreach ($line in $ocrResult.Lines) {");
  lines.push("        $lines += $line.Text");
  lines.push("    }");
  lines.push('    $text = $lines -join "`n"');
  lines.push("");
  lines.push("    @{ text=$text; lineCount=$lines.Count; width=$w; height=$h } | ConvertTo-Json -Compress");
  lines.push("} catch {");
  lines.push('    @{ text=""; error=$_.Exception.Message } | ConvertTo-Json -Compress');
  lines.push("} finally {");
  lines.push("    if (Test-Path $tmpFile) { Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue }");
  lines.push("}");
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
  log(`OCR script written to: ${scriptPath}`);
  return scriptPath;
}

export async function ocrRegion(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Promise<string> {
  log(`ocrRegion: (${x1},${y1}) to (${x2},${y2})`);
  const startTime = Date.now();

  try {
    const script = ensureScriptFile();
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" ${x1} ${y1} ${x2} ${y2}`;

    const result = await new Promise<string>((resolve, reject) => {
      exec(
        cmd,
        { maxBuffer: 1024 * 1024, timeout: 20000 },
        (err: any, stdout: string, stderr: string) => {
          const elapsed = Date.now() - startTime;
          if (err) {
            log(`OCR error after ${elapsed}ms: ${err.message}`);
            if (stderr) log(`  stderr: ${stderr.slice(0, 300)}`);
            reject(new Error(stderr || err.message));
            return;
          }
          log(`OCR completed in ${elapsed}ms, output length=${stdout.length}`);
          resolve(stdout.trim());
        }
      );
    });

    if (!result) return "";

    const parsed = JSON.parse(result);
    if (parsed.error) {
      log(`OCR error: ${parsed.error}`);
      return "";
    }

    const text: string = parsed.text || "";
    log(`OCR result: ${parsed.lineCount || 0} lines, ${text.length} chars, preview="${text.slice(0, 100)}"`);
    return text;
  } catch (err: any) {
    log(`ocrRegion FAILED: ${err.message}`);
    return "";
  }
}