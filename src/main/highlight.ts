import { BrowserWindow, screen } from "electron";

const log = (msg: string) => console.log(`[HIGHLIGHT] ${msg}`);

export function showElementHighlight(bounds: { x: number; y: number; width: number; height: number }): void {
  const padding = 4;
  const bx = bounds.x - padding;
  const by = bounds.y - padding;
  const bw = bounds.width + padding * 2;
  const bh = bounds.height + padding * 2;

  log(`Highlight element at (${bx},${by}) ${bw}x${bh}`);

  const display = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    x: bx,
    y: by,
    width: bw,
    height: bh,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.setIgnoreMouseEvents(true);

  const html = `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html>
<head>
<style>
* { margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
@keyframes glow-pulse {
  0% { box-shadow: 0 0 4px 1px rgba(137,180,250,0.8), 0 0 12px 2px rgba(137,180,250,0.4); }
  50% { box-shadow: 0 0 8px 2px rgba(166,227,161,0.9), 0 0 20px 4px rgba(166,227,161,0.5); }
  100% { box-shadow: 0 0 4px 1px rgba(137,180,250,0.8), 0 0 12px 2px rgba(137,180,250,0.4); }
}
@keyframes fade-out {
  0% { opacity: 1; }
  100% { opacity: 0; }
}
#border {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  border: 2px solid rgba(137,180,250,0.85);
  border-radius: 3px;
  animation: glow-pulse 0.6s ease-in-out 2;
}
#border.fade {
  animation: fade-out 0.4s ease-out forwards;
}
</style>
</head>
<body>
<div id="border"></div>
<script>
setTimeout(() => {
  document.getElementById('border').classList.add('fade');
}, 1200);
</script>
</body>
</html>`)}`;

  win.loadURL(html);

  win.once("ready-to-show", () => {
    win.show();
  });

  setTimeout(() => {
    if (!win.isDestroyed()) {
      win.close();
    }
  }, 2000);
}

export function showAreaHighlight(rect: { x1: number; y1: number; x2: number; y2: number }): void {
  const x = rect.x1;
  const y = rect.y1;
  const w = rect.x2 - rect.x1;
  const h = rect.y2 - rect.y1;

  log(`Highlight area at (${x},${y}) ${w}x${h}`);

  const win = new BrowserWindow({
    x,
    y,
    width: w,
    height: h,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.setIgnoreMouseEvents(true);

  const html = `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html>
<head>
<style>
* { margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
@keyframes glow-pulse {
  0% { box-shadow: 0 0 6px 2px rgba(137,180,250,0.7), 0 0 16px 3px rgba(137,180,250,0.3); }
  50% { box-shadow: 0 0 10px 3px rgba(166,227,161,0.8), 0 0 24px 5px rgba(166,227,161,0.4); }
  100% { box-shadow: 0 0 6px 2px rgba(137,180,250,0.7), 0 0 16px 3px rgba(137,180,250,0.3); }
}
@keyframes fade-out {
  0% { opacity: 1; }
  100% { opacity: 0; }
}
#border {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  border: 2px solid rgba(137,180,250,0.85);
  border-radius: 3px;
  animation: glow-pulse 0.6s ease-in-out 2;
}
#border.fade {
  animation: fade-out 0.4s ease-out forwards;
}
</style>
</head>
<body>
<div id="border"></div>
<script>
setTimeout(() => {
  document.getElementById('border').classList.add('fade');
}, 1200);
</script>
</body>
</html>`)}`;

  win.loadURL(html);

  win.once("ready-to-show", () => {
    win.show();
  });

  setTimeout(() => {
    if (!win.isDestroyed()) {
      win.close();
    }
  }, 2000);
}