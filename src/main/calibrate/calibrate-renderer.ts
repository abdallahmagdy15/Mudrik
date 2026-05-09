// Renderer for the cursor calibration test window. Vanilla JS — no React,
// keeps the diagnostic tool a single self-contained file.

interface Candidate {
  index: number;
  type: string;
  name: string;
  automationId: string;
  bounds: { x: number; y: number; width: number; height: number };
}

declare global {
  interface Window {
    calibrate: {
      capture: (hideWaitMs: number) => Promise<{
        windowTitle?: string;
        totalElements?: number;
        totalClickables?: number;
        scaleFactor?: number;
        candidates?: Candidate[];
        error?: string;
      }>;
      testTarget: (bounds: { x: number; y: number; width: number; height: number }) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

const btnCapture = document.getElementById("btn-capture") as HTMLButtonElement;
const hideWaitInput = document.getElementById("hide-wait") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const listEl = document.getElementById("list") as HTMLDivElement;

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
    const meta = `${cand.automationId ? `automationId="${cand.automationId}" · ` : ""}bounds=(${cand.bounds.x},${cand.bounds.y},${cand.bounds.width}×${cand.bounds.height})`;
    info.innerHTML = `<span class="type">${cand.type}</span><span class="name">${escapeHtml(cand.name) || "<i>(no name)</i>"}</span><div class="meta">${escapeHtml(meta)}</div>`;
    const btn = document.createElement("button");
    btn.textContent = "Test cursor";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "…showing 3s";
      const r = await window.calibrate.testTarget(cand.bounds);
      if (!r.ok) setStatus(`Test failed: ${r.error || "unknown"}`, true);
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "Test cursor";
      }, 3200);
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
  setStatus(`Hiding window… capturing in ${hideWaitMs}ms…`);
  listEl.innerHTML = "";
  const r = await window.calibrate.capture(hideWaitMs);
  btnCapture.disabled = false;
  if (r.error) {
    setStatus(`Error: ${r.error}${r.windowTitle ? ` (window="${r.windowTitle}")` : ""}`, true);
    return;
  }
  setStatus(`Captured "${r.windowTitle}" — ${r.totalElements} elements, ${r.totalClickables} clickable, sf=${r.scaleFactor}. Showing ${r.candidates?.length ?? 0} random.`);
  renderCandidates(r.candidates || []);
});

export {};
