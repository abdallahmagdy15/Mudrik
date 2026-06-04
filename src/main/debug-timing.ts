let isDebug = true;
try {
  const { app } = require("electron");
  if (app) isDebug = !app.isPackaged;
} catch {
  // vitest / non-electron env — keep debug on
}

let tSeq = 0;

export interface TimingRecord {
  label: string;
  totalMs: number;
  marks: { label: string; ms: number }[];
  timestamp: number;
}

let timingHistory: TimingRecord[] = [];
const MAX_HISTORY = 80;

function pushRecord(r: TimingRecord): void {
  timingHistory.push(r);
  if (timingHistory.length > MAX_HISTORY) {
    timingHistory = timingHistory.slice(-MAX_HISTORY);
  }
}

export interface Timer {
  mark(label: string): void;
  done(): void;
}

class TimerImpl implements Timer {
  private seq: number;
  private t0: number;
  private label: string;
  private marks: { label: string; ms: number }[] = [];

  constructor(label: string) {
    this.seq = ++tSeq;
    this.label = `${label} #${this.seq}`;
    this.t0 = performance.now();
  }

  mark(label: string): void {
    this.marks.push({ label, ms: performance.now() - this.t0 });
  }

  done(): void {
    const total = performance.now() - this.t0;
    const parts = this.marks.map((m) => `  ${m.label}: ${m.ms.toFixed(0)}ms`).join("\n");
    console.log(`\n[TIMING] ${this.label}: ${total.toFixed(0)}ms total\n${parts}\n`);
    pushRecord({
      label: this.label,
      totalMs: Math.round(total),
      marks: this.marks.map((m) => ({ label: m.label, ms: Math.round(m.ms) })),
      timestamp: Date.now(),
    });
  }
}

const noopTimer: Timer = { mark() {}, done() {} };

export function startTimer(label: string): Timer {
  if (!isDebug) return noopTimer;
  return new TimerImpl(label);
}

export function debugLog(label: string, ms: number): void {
  if (!isDebug) return;
  console.log(`[TIMING] ${label}: ${ms.toFixed(0)}ms`);
  pushRecord({
    label,
    totalMs: Math.round(ms),
    marks: [],
    timestamp: Date.now(),
  });
}

export function getTimingHistory(): TimingRecord[] {
  return [...timingHistory].reverse();
}

export function clearTimingHistory(): void {
  timingHistory = [];
}
