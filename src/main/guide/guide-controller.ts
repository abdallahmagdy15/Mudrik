// src/main/guide/guide-controller.ts
//
// State machine that drives Auto-Guide mode. Owns the active guide session
// across IDLE -> OFFER -> STEP_ACTIVE -> WAITING -> RECAPTURING -> AWAITING_AI.
// Coordinates the overlay (Task 4.2), the mouse hook (Task 4.1), the
// chat-input options bar (renderer IPC), and OpenCode follow-up prompts.
//
// Spec reference: Mudrik-Plan/docs/specs/2026-05-03-auto-guide-design.md §4.2

import {
  Action,
  GuideOfferPayload,
  GuideStepPayload,
  GuideCompletePayload,
  GuideAbortPayload,
} from "../../shared/types";

export type GuidePhase =
  | "idle"
  | "offer"
  | "step-active"
  | "waiting"
  | "recapturing"
  | "awaiting-ai";

export interface GuideStateUpdate {
  phase: GuidePhase;
  caption?: string;
  options?: string[];
  stepIndex?: number;
  estStepsLeft?: number;
  /** For phase==="offer": the summary describing what the guide will do. */
  summary?: string;
  /** For phase==="idle" sent right after a guide_complete or guide_abort:
   *  short message to flash in the chat (recap or reason). */
  finalMessage?: string;
}

export interface ClickEvent {
  x: number;
  y: number;
  button: "left" | "right" | "middle";
}

export interface GuideControllerDeps {
  overlay: {
    show: (
      target: { x: number; y: number; width: number; height: number },
      fromCursor: { x: number; y: number },
    ) => Promise<void>;
    hide: () => void;
  };
  mouseHook: {
    start: (opts: { scopeHwnd: number; onClick: (e: ClickEvent) => void }) => Promise<void>;
    stop: () => void;
  };
  /** Returns the current foreground window's HWND (used to scope mouse hook
   *  and to bind active-window grace-timeout). */
  getActiveHwnd: () => Promise<number>;
  /** Returns the current cursor position (for the overlay's start position). */
  getCursorPos: () => { x: number; y: number };
  /** Sends a follow-up prompt to OpenCode and starts streaming. The
   *  controller does NOT wait on this — it expects the next guide_*
   *  marker to arrive via handleAction(). */
  sendFollowUp: (prompt: string) => Promise<void>;
  /** Builds the screen-context block to include in the follow-up prompt,
   *  describing the user's most recent action and the new active-window
   *  state. */
  buildFollowUpPrompt: (
    actionDesc:
      | { kind: "click"; x: number; y: number }
      | { kind: "option"; choice: string },
  ) => Promise<string>;
  /** Pushes a state update to the renderer's chat-input options bar. */
  onStateUpdate: (s: GuideStateUpdate) => void;
  /** Resolves the AI's target hint to ACCURATE pixel bounds via UIA before
   *  the overlay places the owl. The AI's boundsHint comes from a screenshot
   *  and is regularly off by tens-to-hundreds of pixels (LLMs are weak at
   *  exact 2D coordinates). UIA lookup by selector/automationId returns
   *  pixel-perfect bounds when the element exists. Returns null if the
   *  lookup fails — the controller then falls back to the AI's boundsHint
   *  so a stale UIA snapshot doesn't break the flow. */
  resolveTargetBounds?: (
    target: { selector: string; automationId?: string; boundsHint?: { x: number; y: number; width: number; height: number } },
  ) => Promise<{ x: number; y: number; width: number; height: number } | null>;
}

const STEP_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

export class GuideController {
  private phase: GuidePhase = "idle";
  // Latest queued action context — set during STEP_ACTIVE, cleared on transition
  private pendingAction:
    | { kind: "click"; x: number; y: number }
    | { kind: "option"; choice: string }
    | null = null;
  // The guide_step that's currently displayed (so cancel knows what to abort)
  private currentStep: GuideStepPayload | null = null;
  // Captured at the start of the active step so the hook scope is correct
  private currentScopeHwnd: number = 0;
  // 5-min idle timeout for the active step
  private inactivityTimer: NodeJS.Timeout | null = null;
  // True while the controller is processing the post-action transitions
  // (prevents re-entering on a second click between WAITING -> RECAPTURING)
  private processing: boolean = false;

  constructor(private deps: GuideControllerDeps) {}

  /** Current phase (for tests + the Esc binding's guide-aware case). */
  getPhase(): GuidePhase {
    return this.phase;
  }

  /** Entry point called by action-executor when a guide_* marker arrives. */
  async handleAction(action: Action): Promise<void> {
    switch (action.type) {
      case "guide_offer":
        await this.handleOffer(action as unknown as GuideOfferPayload);
        return;
      case "guide_step":
        await this.handleStep(action as unknown as GuideStepPayload);
        return;
      case "guide_complete":
        this.handleComplete(action as unknown as GuideCompletePayload);
        return;
      case "guide_abort":
        this.handleAbort(action as unknown as GuideAbortPayload);
        return;
      default:
        // Should never happen — validateAction filters; defensive log
        return;
    }
  }

  /** Renderer reports the user tapped a button in the chat-input options bar. */
  async handleUserChoice(option: string): Promise<void> {
    if (option === "Cancel") {
      await this.cancel();
      return;
    }
    if (this.phase === "offer") {
      // User accepted the offer → ask AI for the first step
      this.transitionToAwaitingAI();
      const followUp = await this.deps.buildFollowUpPrompt({
        kind: "option",
        choice: option,
      });
      await this.deps.sendFollowUp(followUp);
      return;
    }
    if (this.phase === "step-active") {
      // closeOptions short-circuit: AI marked this option as terminal (e.g.
      // "Done — task complete" on the final step). Close locally without
      // burning another round-trip on a confirmation the user already gave.
      const step = this.currentStep;
      if (step?.closeOptions && step.closeOptions.includes(option)) {
        this.handleComplete({ type: "guide_complete", summary: option });
        return;
      }
      // Otherwise the user is signalling progress mid-walkthrough — record
      // and advance, the next guide_* marker arrives via handleAction().
      this.recordPendingAction({ kind: "option", choice: option });
      void this.advanceFromStep();
      return;
    }
    // Other phases shouldn't receive choice events; ignore defensively
  }

  /** User cancelled (Esc, Cancel button, or a hard timeout) — close locally
   *  without an AI round-trip. The session continuation isn't worth a token
   *  spend on "ack — guide cancelled" the user already initiated. The AI
   *  will see the cancellation context on the user's next message. */
  async cancel(): Promise<void> {
    if (this.phase === "idle") return;
    this.deps.mouseHook.stop();
    this.deps.overlay.hide();
    this.clearInactivityTimer();
    this.processing = false;
    this.pendingAction = null;
    const wasActive = this.phase !== "offer";
    this.phase = "idle";
    this.currentStep = null;
    this.deps.onStateUpdate({
      phase: "idle",
      finalMessage: wasActive ? "Guide cancelled." : undefined,
    });
  }

  // ---------- private state-machine methods ----------

  private async handleOffer(p: GuideOfferPayload): Promise<void> {
    // Runtime guard for plan-rule violation (already enforced in validateAction
    // but belt-and-suspenders; controller should reject defensively too).
    if (p.estSteps < 2) {
      // Don't transition; surface as an error via state update
      this.deps.onStateUpdate({
        phase: "idle",
        finalMessage: "Guide rejected: estSteps < 2.",
      });
      return;
    }
    if (this.phase !== "idle" && this.phase !== "awaiting-ai") {
      // A guide_offer arriving mid-step is unexpected; treat as abort of current
      await this.cancel();
    }
    this.phase = "offer";
    this.deps.onStateUpdate({
      phase: "offer",
      summary: p.summary,
      options: p.options,
      estStepsLeft: p.estSteps,
    });
  }

  private async handleStep(p: GuideStepPayload): Promise<void> {
    if (this.phase !== "offer" && this.phase !== "awaiting-ai") {
      // Out-of-band guide_step (no prior offer) — reject defensively
      this.deps.onStateUpdate({
        phase: "idle",
        finalMessage: "Guide rejected: guide_step without active offer.",
      });
      return;
    }
    this.phase = "step-active";
    this.currentStep = p;
    this.pendingAction = null;
    this.processing = false;

    // Push the step UI to the renderer
    this.deps.onStateUpdate({
      phase: "step-active",
      caption: p.caption,
      options: p.options,
      stepIndex: p.stepIndex,
      estStepsLeft: p.estStepsLeft,
    });

    // Show the overlay (only if we have a target — typing-only steps may have target=null)
    if (p.target && p.target.boundsHint) {
      const cursor = this.deps.getCursorPos();
      // Prefer UIA-resolved bounds (pixel-perfect) over the AI's screenshot
      // guess (often off by tens-to-hundreds of px). Falls back to the AI
      // hint if UIA can't find the element — an inaccurate owl is still
      // better than no owl when the target exists in the wrong tree.
      let resolved: { x: number; y: number; width: number; height: number } | null = null;
      if (this.deps.resolveTargetBounds) {
        try {
          resolved = await this.deps.resolveTargetBounds({
            selector: p.target.selector,
            automationId: p.target.automationId,
            boundsHint: p.target.boundsHint,
          });
        } catch {
          // best-effort — fall through to AI's hint
        }
      }
      await this.deps.overlay.show(resolved || p.target.boundsHint, cursor);
    } else {
      // No target → no overlay; user just acts in the underlying app
      this.deps.overlay.hide();
    }

    // Start the mouse hook only for trackable steps
    if (p.trackable) {
      this.currentScopeHwnd = await this.deps.getActiveHwnd();
      await this.deps.mouseHook.start({
        scopeHwnd: this.currentScopeHwnd,
        onClick: (e) => this.onMouseClick(e),
      });
    }

    // Arm the inactivity timeout
    this.armInactivityTimer();
  }

  private handleComplete(p: GuideCompletePayload): void {
    this.deps.mouseHook.stop();
    this.deps.overlay.hide();
    this.clearInactivityTimer();
    this.phase = "idle";
    this.currentStep = null;
    this.pendingAction = null;
    this.processing = false;
    this.deps.onStateUpdate({ phase: "idle", finalMessage: p.summary });
  }

  private handleAbort(p: GuideAbortPayload): void {
    this.deps.mouseHook.stop();
    this.deps.overlay.hide();
    this.clearInactivityTimer();
    this.phase = "idle";
    this.currentStep = null;
    this.pendingAction = null;
    this.processing = false;
    this.deps.onStateUpdate({ phase: "idle", finalMessage: p.reason });
  }

  private onMouseClick(e: ClickEvent): void {
    if (this.phase !== "step-active") return;
    // Coalesce rapid clicks: just store the latest one. advanceFromStep
    // is idempotent due to processing flag.
    this.recordPendingAction({ kind: "click", x: e.x, y: e.y });
    void this.advanceFromStep();
  }

  private recordPendingAction(
    a: { kind: "click"; x: number; y: number } | { kind: "option"; choice: string },
  ): void {
    this.pendingAction = a;
  }

  private async advanceFromStep(): Promise<void> {
    if (this.processing) return;
    if (!this.currentStep) return;
    if (!this.pendingAction) return;
    this.processing = true;
    this.clearInactivityTimer();
    this.deps.mouseHook.stop();
    const waitMs = this.currentStep.waitMs;
    const action = this.pendingAction;
    this.pendingAction = null;

    // WAITING phase
    this.phase = "waiting";
    this.deps.onStateUpdate({ phase: "waiting" });
    await sleep(waitMs);

    // RECAPTURING phase
    this.phase = "recapturing";
    this.deps.onStateUpdate({ phase: "recapturing" });

    // AWAITING_AI phase — build follow-up prompt and send
    this.phase = "awaiting-ai";
    this.deps.onStateUpdate({ phase: "awaiting-ai" });
    try {
      const followUp = await this.deps.buildFollowUpPrompt(action);
      await this.deps.sendFollowUp(followUp);
    } catch (err) {
      // If follow-up fails, abort
      this.handleAbort({
        type: "guide_abort",
        reason: `Follow-up failed: ${(err as Error).message ?? "unknown error"}`,
      });
    }
    this.processing = false;
    // Next guide_step / guide_complete / guide_abort arrives via handleAction()
  }

  private transitionToAwaitingAI(): void {
    this.phase = "awaiting-ai";
    this.deps.onStateUpdate({ phase: "awaiting-ai" });
  }

  private armInactivityTimer(): void {
    this.clearInactivityTimer();
    this.inactivityTimer = setTimeout(() => {
      this.handleAbort({
        type: "guide_abort",
        reason: "Guide paused due to inactivity.",
      });
    }, STEP_INACTIVITY_TIMEOUT_MS);
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Singleton accessor — used by Task 6.1's lazy-import wiring.
let singleton: GuideController | null = null;
export function getController(deps?: GuideControllerDeps): GuideController {
  if (!singleton) {
    if (!deps) throw new Error("getController: first call must provide deps");
    singleton = new GuideController(deps);
  }
  return singleton;
}
export function isControllerInitialized(): boolean {
  return singleton !== null;
}
// Test helper — resets the singleton between tests
export function _resetSingletonForTests(): void {
  singleton = null;
}
