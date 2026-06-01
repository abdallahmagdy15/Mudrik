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
import { screen } from "electron";
import { log } from "../logger";

/** System-injected options that always appear in guide mode regardless of what
 *  the AI sends. Cancel aborts the guide; Something else opens the panel so
 *  the user can type a custom message. */
const SYSTEM_OPTIONS = ["Cancel", "Something else"];

function boundsHintToPhysical(bounds: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  // The AI's boundsHint is in logical (DIP) pixels because the candidates
  // list we send is converted to logical. showOverlay expects physical
  // screen pixels, so we multiply by the display scale factor.
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const sf = display?.scaleFactor || screen.getPrimaryDisplay().scaleFactor || 1;
  return {
    x: Math.round(bounds.x * sf),
    y: Math.round(bounds.y * sf),
    width: Math.round(bounds.width * sf),
    height: Math.round(bounds.height * sf),
  };
}

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
    setOwlMode?: (mode: "pointing" | "thinking") => void;
  };
  getActiveHwnd: () => Promise<number>;
  getCursorPos: () => { x: number; y: number };
  /** Sends a follow-up to OpenCode and streams. Takes the action descriptor
   *  directly; the implementation handles hiding the panel, capturing
   *  screenshot + UIA tree of the TARGET app (not Mudrik), formatting the
   *  prompt with fresh candidates, and showing the panel. The controller
   *  doesn't wait on the AI — the next guide_* marker arrives via
   *  handleAction(). Replaces the previous buildFollowUpPrompt+sendFollowUp
   *  pair so screenshot and UIA capture happen in ONE hide-show window
   *  with Mudrik out of the foreground (otherwise UIA reads Mudrik's own
   *  tree, not the app the user is being guided through). */
  sendFollowUp: (
    actionDesc:
      | { kind: "click"; x: number; y: number }
      | { kind: "option"; choice: string },
  ) => Promise<void>;
  /** Pushes a state update to the renderer's chat-input options bar. */
  onStateUpdate: (s: GuideStateUpdate) => void;
  /** Hide/show panel window */
  hidePanel: () => void;
  showPanel: () => void;
  /** Show panel and focus the chat input (used by "Something else" option) */
  showPanelAndFocusInput: () => void;
  /** Resolves the AI's target to pixel bounds via UIA lookup.
   *  The new dual-bounds system means the AI provides either:
   *  - uiaBounds: copied from UIA tree (pixel-perfect, high confidence)
   *  - guessBounds: estimated from screenshot (for Chromium/web apps)
   *  This function is a FINAL fallback when the AI didn't provide either.
   *  Returns null if UIA can't find the element — the controller then
   *  shows NO owl (better no guide than wrong guide). */
  resolveTargetBounds?: (
    target: {
      selector: string;
      automationId?: string;
      uiaBounds?: { x: number; y: number; width: number; height: number };
      guessBounds?: { x: number; y: number; width: number; height: number };
    },
  ) => Promise<{ x: number; y: number; width: number; height: number } | null>;
}

const STEP_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

export class GuideController {
  private phase: GuidePhase = "idle";
  private pendingAction:
    | { kind: "click"; x: number; y: number }
    | { kind: "option"; choice: string }
    | null = null;
  private currentStep: GuideStepPayload | null = null;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private processing: boolean = false;
  private runGeneration: number = 0;

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
    if (option === "Something else") {
      // Open panel so user can type a custom message; guide stays active
      this.deps.showPanelAndFocusInput();
      return;
    }
    if (this.phase === "offer") {
      // User accepted the offer → hide panel and show owl with thinking state
      this.deps.hidePanel();
      const cursor = this.deps.getCursorPos();
      // Show thinking owl at cursor position with "Thinking..." bubble immediately
      await this.deps.overlay.show(
        { x: cursor.x - 32, y: cursor.y - 32, width: 64, height: 64 },
        cursor,
      );
      this.deps.overlay.setOwlMode?.("thinking");
      this.deps.onStateUpdate({ phase: "awaiting-ai", caption: "Thinking...", options: [] });
      this.transitionToAwaitingAI();
      await this.deps.sendFollowUp({ kind: "option", choice: option });
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
   *  will see the cancellation context on the user's next message.
   *
   *  Bumps runGeneration so any in-flight advanceFromStep aborts at its
   *  next await point — without this, a screen-click that started the
   *  pipeline a moment before Cancel would still complete its sleep,
   *  recapture, screenshot, and follow-up to the AI. */
  async cancel(): Promise<void> {
    if (this.phase === "idle") return;
    this.runGeneration += 1;
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
    if (wasActive) {
      this.deps.showPanel();
    }
  }

  // ---------- private state-machine methods ----------

  private async handleOffer(p: GuideOfferPayload): Promise<void> {
    // The decision to use guide mode is the AI's per GUIDE_PROMPT_FULL —
    // the runtime does NOT gate on step count or task type. Only schema
    // sanity is enforced here (must be a finite number; the renderer would
    // otherwise show "Step 1 · ~NaN left" or similar). Clamp non-positive
    // integers to 1 for the counter so they don't mislead the user, but
    // don't reject the offer.
    const estSteps =
      typeof p.estSteps === "number" && Number.isFinite(p.estSteps)
        ? Math.max(1, Math.round(p.estSteps))
        : 1;
    if (this.phase !== "idle" && this.phase !== "awaiting-ai") {
      // A guide_offer arriving mid-step is unexpected; treat as abort of current
      await this.cancel();
    }
    this.phase = "offer";
    this.deps.onStateUpdate({
      phase: "offer",
      summary: p.summary,
      options: p.options,
      estStepsLeft: estSteps,
    });
  }

  private async handleStep(p: GuideStepPayload): Promise<void> {
    if (this.phase !== "offer" && this.phase !== "awaiting-ai") {
      // Out-of-band guide_step (no prior offer). Throw so the dispatcher's
      // ActionResult shows success=false — otherwise the renderer's
      // "guide_step OK" badge lies about what just happened. The throw is
      // caught in action-executor.ts's guide branch and surfaced to the
      // user as a clear failure they can act on (typically: ask the AI to
      // emit a guide_offer first).
      throw new Error("guide_step rejected — no active offer. Ask the AI to start the guide with guide_offer first.");
    }
    this.phase = "step-active";
    this.currentStep = p;
    this.pendingAction = null;
    this.processing = false;

    // Inject system options (Cancel + Something else) into the AI's option list.
    // These are always available regardless of what the AI sends.
    const aiOptions = p.options.filter((o) => !SYSTEM_OPTIONS.includes(o));
    const mergedOptions = [...aiOptions, ...SYSTEM_OPTIONS];

    // Push the step UI to the renderer
    this.deps.onStateUpdate({
      phase: "step-active",
      caption: p.caption,
      options: mergedOptions,
      stepIndex: p.stepIndex,
      estStepsLeft: p.estStepsLeft,
    });

    // Show the overlay (only if we have a target — typing-only steps may have target=null)
    if (p.target) {
      const cursor = this.deps.getCursorPos();
      // Dual-bounds priority:
      // 1. uiaBounds: AI copied from UIA tree (pixel-perfect, PHYSICAL pixels)
      // 2. guessBounds: AI estimated from screenshot (Chromium/web fallback, PHYSICAL)
      // 3. boundsHint (legacy): might be logical or physical — try direct first
      // 4. resolveTargetBounds: UIA live lookup as last resort
      // 5. null: no owl shown (better no guide than wrong guide)
      let bounds: { x: number; y: number; width: number; height: number } | null = null;

      if (p.target.uiaBounds) {
        bounds = p.target.uiaBounds;
        log(`guide_step: using uiaBounds from AI for "${p.target.selector}" @(${bounds.x},${bounds.y})`);
      } else if (p.target.guessBounds) {
        bounds = p.target.guessBounds;
        log(`guide_step: using guessBounds from AI for "${p.target.selector}" @(${bounds.x},${bounds.y})`);
      } else if (p.target.boundsHint) {
        // Legacy fallback: boundsHint might be logical (from old prompts) or physical.
        // The candidate list in the guide follow-up now shows physical pixels,
        // so modern sessions should use uiaBounds. This path handles old sessions.
        bounds = p.target.boundsHint;
        log(`guide_step: using legacy boundsHint for "${p.target.selector}" @(${bounds.x},${bounds.y})`);
      } else if (this.deps.resolveTargetBounds) {
        try {
          bounds = await this.deps.resolveTargetBounds({
            selector: p.target.selector,
            automationId: p.target.automationId,
          });
          if (bounds) {
            log(`guide_step: resolved "${p.target.selector}" via UIA live lookup @(${bounds.x},${bounds.y})`);
          }
        } catch {
          // best-effort
        }
      }

      if (bounds) {
        // All coordinate paths now deliver PHYSICAL screen pixels. The overlay
        // window consumes physical pixels directly (the renderer positions
        // elements in CSS pixels that map 1:1 to physical via the conversion
        // in showOverlay).
        await this.deps.overlay.show(bounds, cursor);
      } else {
        log(`guide_step: no bounds for "${p.target.selector}" — showing owl at cursor instead`);
        // Show owl at cursor position so user still has the bubble UI
        await this.deps.overlay.show(
          { x: cursor.x - 32, y: cursor.y - 32, width: 64, height: 64 },
          cursor,
        );
      }
      this.deps.overlay.setOwlMode?.("pointing");
    } else {
      // No target → show owl at cursor with caption bubble
      const cursor = this.deps.getCursorPos();
      await this.deps.overlay.show(
        { x: cursor.x - 32, y: cursor.y - 32, width: 64, height: 64 },
        cursor,
      );
    }

    // Mouse-hook click detection is intentionally OFF for this phase. The
    // global WH_MOUSE_LL hook caused two recurring bugs in real testing:
    // (1) screen-clicks racing with the user's option-button click (Cancel
    // got swallowed by the in-flight pipeline); (2) clicks on the panel's
    // own buttons sometimes reaching the hook because scopeHwnd was set
    // to the panel after a previous option click. Right now the user
    // confirms every step exclusively via the chat-input options bar
    // (e.g. "I did it", "Settings opened", "Nothing happened"). This is
    // simpler and matches the user's mental model — the owl points at
    // the target, the user clicks in their app, then taps the option to
    // advance. The mouseHook dep / mouse-hook.ts module are kept for a
    // future re-enable.
    // if (p.trackable) {
    //   this.currentScopeHwnd = await this.deps.getActiveHwnd();
    //   await this.deps.mouseHook.start({
    //     scopeHwnd: this.currentScopeHwnd,
    //     onClick: (e) => this.onMouseClick(e),
    //   });
    // }

    // Arm the inactivity timeout
    this.armInactivityTimer();
  }

  private handleComplete(p: GuideCompletePayload): void {
    if (this.phase === "idle") {
      throw new Error("guide_complete rejected — no active guide. The AI should emit guide_offer to begin a new walkthrough.");
    }
    this.clearInactivityTimer();
    this.phase = "idle";
    this.currentStep = null;
    this.pendingAction = null;
    this.processing = false;
    this.deps.onStateUpdate({ phase: "idle", finalMessage: p.summary });
    // Show thinking owl "Done!" for 3 seconds, then hide owl and show panel
    this.deps.overlay.setOwlMode?.("thinking");
    setTimeout(() => {
      this.deps.overlay.hide();
      this.deps.showPanel();
    }, 3000);
  }

  private handleAbort(p: GuideAbortPayload): void {
    this.deps.overlay.hide();
    this.clearInactivityTimer();
    this.phase = "idle";
    this.currentStep = null;
    this.pendingAction = null;
    this.processing = false;
    this.deps.onStateUpdate({ phase: "idle", finalMessage: p.reason });
    // Show panel when guide aborts
    this.deps.showPanel();
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
    const myGen = ++this.runGeneration;
    const isCurrent = () => this.runGeneration === myGen && this.phase !== "idle";
    this.processing = true;
    this.clearInactivityTimer();

    const waitMs = this.currentStep.waitMs;
    const action = this.pendingAction;
    this.pendingAction = null;

    // Get cursor position to keep owl visible
    const cursor = this.deps.getCursorPos();

    // WAITING phase — show thinking owl at cursor with "Waiting..." bubble
    this.phase = "waiting";
    await this.deps.overlay.show(
      { x: cursor.x - 32, y: cursor.y - 32, width: 64, height: 64 },
      cursor,
    );
    this.deps.overlay.setOwlMode?.("thinking");
    this.deps.onStateUpdate({ phase: "waiting", caption: "Waiting...", options: [] });
    await sleep(waitMs);
    if (!isCurrent()) {
      this.processing = false;
      return;
    }

    // RECAPTURING phase
    this.phase = "recapturing";
    this.deps.onStateUpdate({ phase: "recapturing", caption: "Capturing...", options: [] });

    // AWAITING_AI phase — send follow-up (capture + format + dispatch)
    this.phase = "awaiting-ai";
    this.deps.onStateUpdate({ phase: "awaiting-ai", caption: "Thinking...", options: [] });
    try {
      await this.deps.sendFollowUp(action);
      if (!isCurrent()) {
        this.processing = false;
        return;
      }
    } catch (err) {
      if (!isCurrent()) {
        // Cancel raced with the in-flight follow-up — swallow the error
        this.processing = false;
        return;
      }
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
