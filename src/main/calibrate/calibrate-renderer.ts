// Renderer for the cursor calibration test window. Vanilla JS — no React.

interface Candidate {
  index: number;
  type: string;
  name: string;
  automationId: string;
  bounds: { x: number; y: number; width: number; height: number };
  physicalBounds?: { x: number; y: number; width: number; height: number };
}

declare global {
  interface Window {
    calibrate: {
      capture: (hideWaitMs: number) => Promise<{
        windowTitle?: string;
        totalElements?: number;
        totalClickables?: number;
        candidates?: Candidate[];
        error?: string;
      }>;
      testTarget: (bounds: { x: number; y: number; width: number; height: number }) => Promise<{ ok: boolean; error?: string }>;
      getCursorPos: () => Promise<{ x: number; y: number }>;
    };
  }
}

const btnCapture = document.getElementById("btn-capture") as HTMLButtonElement;
const hideWaitInput = document.getElementById("hide-wait") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const listEl = document.getElementById("list") as HTMLDivElement;
const livePosEl = document.getElementById("live-pos") as HTMLSpanElement;

let trackTimer: ReturnType<typeof setInterval> | null = null;

function setStatus(text: string, error = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", error);
}

function renderCandidates(c: Candidate[]) {
  listEl.innerHTML = "";
  if (!c.length) {
    listEl.innerHTML = `<div class="empty">No clickables found in the captured window.</div>`;
    return;
  }
  c.forEach((cand) => {
    const row = document.createElement("div");
    row.className = "row";
    const info = document.createElement("div");
    info.className = "info";
    const physical = cand.physicalBounds
      ? `physical=(${cand.physicalBounds.x},${cand.physicalBounds.y},${cand.physicalBounds.width}\u00d7${cand.physicalBounds.height}) \u00b7 `
      : "";
    const meta = `${cand.automationId ? `automationId="${cand.automationId}" \u00b7 ` : ""}${physical}overlay=(${cand.bounds.x},${cand.bounds.y},${cand.bounds.width}\u00d7${cand.bounds.height})`;
    info.innerHTML = `<span class="type">${cand.type}</span><span class="name">${escapeHtml(cand.name) || "<i>(no name)</i>"}</span><div class="meta">${escapeHtml(meta)}</div>`;
    const btn = document.createElement("button");
    btn.textContent = "Test cursor";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "\u2026showing 3s";
      const testBounds = cand.physicalBounds || cand.bounds;
      const r = await window.calibrate.testTarget(testBounds);
      if (!r.ok) setStatus(`Test failed: ${r.error || "unknown"}`, true);
      setTimeout(() => { btn.disabled = false; btn.textContent = "Test cursor"; }, 3200);
    });
    row.appendChild(info);
    row.appendChild(btn);
    listEl.appendChild(row);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

btnCapture.addEventListener("click", async () => {
  const hideWaitMs = Math.max(100, Math.min(3000, Number(hideWaitInput.value) || 500));
  btnCapture.disabled = true;
  setStatus(`Hiding window\u2026 capturing in ${hideWaitMs}ms\u2026`);
  listEl.innerHTML = "";
  const r = await window.calibrate.capture(hideWaitMs);
  btnCapture.disabled = false;
  if (r.error) {
    setStatus(`Error: ${r.error}${r.windowTitle ? ` (window="${r.windowTitle}")` : ""}`, true);
    return;
  }
  setStatus(`Captured "${r.windowTitle}" \u2014 ${r.totalElements} elements, ${r.totalClickables} clickable. Showing ${r.candidates?.length ?? 0} random.`);
  renderCandidates(r.candidates || []);
});

function startLiveTracker() {
  if (trackTimer) return;
  trackTimer = setInterval(async () => {
    try {
      const pos = await window.calibrate.getCursorPos();
      if (livePosEl) livePosEl.textContent = `${pos.x}, ${pos.y}`;
    } catch { /* ignore */ }
  }, 120);
}
function stopLiveTracker() {
  if (trackTimer) { clearInterval(trackTimer); trackTimer = null; }
  if (livePosEl) livePosEl.textContent = "--, --";
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopLiveTracker();
  else startLiveTracker();
});
startLiveTracker();

export {};
