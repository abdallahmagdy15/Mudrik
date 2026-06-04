// Renderer for the Mudrik debug tools window. Vanilla JS — no React.
// Two tabs: Cursor Calibration and Timing Log.

interface Candidate {
  index: number;
  type: string;
  name: string;
  automationId: string;
  bounds: { x: number; y: number; width: number; height: number };
  physicalBounds?: { x: number; y: number; width: number; height: number };
}

interface TimingRecord {
  label: string;
  totalMs: number;
  marks: Array<{ label: string; ms: number }>;
  timestamp: number;
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
      getTimings: () => Promise<TimingRecord[]>;
      clearTimings: () => Promise<{ ok: boolean }>;
    };
  }
}

// ---- Tab switching ----
document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`panel-${btn.dataset.tab}`)?.classList.add("active");
  });
});

// ========================================================================
//  CALIBRATION TAB
// ========================================================================

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

// ========================================================================
//  TIMING LOG TAB
// ========================================================================

const timingListEl = document.getElementById("timing-list") as HTMLDivElement;
const timingAutoRefresh = document.getElementById("timing-autorefresh") as HTMLInputElement;
const btnClearTimings = document.getElementById("btn-clear-timings") as HTMLButtonElement;
const btnRefreshTimings = document.getElementById("btn-refresh-timings") as HTMLButtonElement;

let timingRefreshTimer: ReturnType<typeof setInterval> | null = null;
let timingExpanded = new Set<string>();

const CYCLE_PATTERN = /^msg-cycle/;
const PHASE_COLORS: Record<string, string> = {
  "prompt-built": "prompt",
  "opencode-done": "opencode",
  "actions-parsed": "parse",
  "actions-executed": "exec",
};

function groupCycleRecords(records: TimingRecord[]): {
  cycle: TimingRecord | null;
  events: TimingRecord[];
} {
  const events: TimingRecord[] = [];
  let cycle: TimingRecord | null = null;
  for (const r of records) {
    if (CYCLE_PATTERN.test(r.label)) {
      if (!cycle) cycle = r;
    } else {
      events.push(r);
    }
  }
  return { cycle, events };
}

function renderTimingRecords(records: TimingRecord[]) {
  if (!records.length) {
    timingListEl.innerHTML = `<div class="empty">No timing data yet. Send a message (Alt+Space) to record a cycle.</div>`;
    return;
  }

  const GAPS: Record<string, { ms: number; label: string }> = {
    "prompt-built": { ms: 0, label: "prompt-building" },
    "opencode-done": { ms: 0, label: "opencode-call" },
    "actions-parsed": { ms: 0, label: "parsing" },
    "actions-executed": { ms: 0, label: "execution" },
  };

  const html: string[] = [];
  let lastTs = 0;

  for (const r of records) {
    if (lastTs && lastTs - r.timestamp > 5000) {
      html.push(`<div style="text-align:center;color:#556A77;font-size:10px;padding:4px;">--- ${Math.round((lastTs - r.timestamp) / 1000)}s gap ---</div>`);
    }
    lastTs = r.timestamp;

    const isCycle = CYCLE_PATTERN.test(r.label);
    if (isCycle && r.marks.length > 0) {
      // Phase breakdown
      let prevMs = 0;
      const gaps: Array<{ label: string; ms: number; pct: number }> = [];
      for (const m of r.marks) {
        gaps.push({ label: m.label, ms: m.ms - prevMs, pct: Math.round((m.ms - prevMs) / r.totalMs * 100) });
        prevMs = m.ms;
      }
      gaps.push({ label: "post-exec", ms: r.totalMs - prevMs, pct: Math.round((r.totalMs - prevMs) / r.totalMs * 100) });

      const recordId = `rec-${r.timestamp}-${r.label}`;
      const open = timingExpanded.has(recordId);
      const labelShort = r.label.replace(/ #\d+$/, "");

      html.push(`<div class="timing-record">`);
      html.push(`<div class="timing-header" data-record="${recordId}">`);
      html.push(`<span class="timing-arrow${open ? " open" : ""}">&#9654;</span>`);
      html.push(`<span class="timing-label">${escapeHtml(labelShort)}</span>`);
      html.push(`<span class="timing-total">${r.totalMs}ms</span>`);
      html.push(`<span class="timing-ts">${new Date(r.timestamp).toLocaleTimeString()}</span>`);
      html.push(`</div>`);

      // Mini bar chart
      html.push(`<div class="timing-detail${open ? " open" : ""}" style="padding:4px 10px 0;">`);
      html.push(`<div class="timing-bar-chart">`);
      for (const g of gaps) {
        const color = PHASE_COLORS[g.label] || "prompt";
        html.push(`<div class="bar ${color}" style="width:${Math.max(1, g.pct)}%" title="${g.label}: ${g.ms}ms (${g.pct}%)"></div>`);
      }
      html.push(`</div></div>`);

      // Phase lines
      html.push(`<div class="timing-detail${open ? " open" : ""}">`);
      for (const g of gaps) {
        html.push(`<div class="timing-mark"><span class="mark-label">${g.label}</span><span class="mark-time">${g.ms}ms</span><span class="mark-pct">${g.pct}%</span></div>`);
      }
      html.push(`</div>`);
      html.push(`</div>`);
    } else {
      // Simple event record
      html.push(`<div class="timing-record">`);
      html.push(`<div class="timing-header" style="cursor:default">`);
      html.push(`<span style="width:18px"></span>`);
      html.push(`<span class="timing-label" style="color:#8FBFCD">${escapeHtml(r.label)}</span>`);
      html.push(`<span class="timing-total" style="font-size:13px;color:#5FD8F0">${r.totalMs}ms</span>`);
      html.push(`<span class="timing-ts">${new Date(r.timestamp).toLocaleTimeString()}</span>`);
      html.push(`</div>`);
      html.push(`</div>`);
    }
  }

  timingListEl.innerHTML = html.join("\n");

  // Wire click handlers for expand/collapse
  timingListEl.querySelectorAll<HTMLDivElement>(".timing-header[data-record]").forEach((hdr) => {
    hdr.addEventListener("click", () => {
      const id = hdr.dataset.record!;
      if (timingExpanded.has(id)) {
        timingExpanded.delete(id);
      } else {
        timingExpanded.add(id);
      }
      // Re-render to keep state in sync
      const records = window.calibrate.getTimings();
      records.then(renderTimingRecords);
    });
  });
}

async function refreshTimings() {
  try {
    const records = await window.calibrate.getTimings();
    renderTimingRecords(records);
  } catch { /* ignore */ }
}

function startTimingAutoRefresh() {
  if (timingRefreshTimer) return;
  timingRefreshTimer = setInterval(refreshTimings, 1500);
}

function stopTimingAutoRefresh() {
  if (timingRefreshTimer) { clearInterval(timingRefreshTimer); timingRefreshTimer = null; }
}

timingAutoRefresh.addEventListener("change", () => {
  if (timingAutoRefresh.checked) startTimingAutoRefresh();
  else stopTimingAutoRefresh();
});

btnRefreshTimings.addEventListener("click", refreshTimings);

btnClearTimings.addEventListener("click", async () => {
  await window.calibrate.clearTimings();
  timingExpanded.clear();
  timingListEl.innerHTML = `<div class="empty">Cleared.</div>`;
});

// Auto-refresh when switching to timing tab; stop when leaving
const timingTab = document.querySelector<HTMLButtonElement>(".tab[data-tab=\"timing\"]")!;
const observer = new MutationObserver(() => {
  if (timingTab.classList.contains("active")) {
    refreshTimings();
    if (timingAutoRefresh.checked) startTimingAutoRefresh();
  } else {
    stopTimingAutoRefresh();
  }
});
observer.observe(timingTab, { attributes: true, attributeFilter: ["class"] });

// Initial load if timing tab is active on open
if (timingTab.classList.contains("active")) {
  refreshTimings();
  if (timingAutoRefresh.checked) startTimingAutoRefresh();
}

export {};
