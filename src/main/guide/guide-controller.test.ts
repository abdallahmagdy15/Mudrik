import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  GuideController,
  GuideControllerDeps,
} from "./guide-controller";
import type {
  GuideOfferPayload,
  GuideStepPayload,
  GuideCompletePayload,
  GuideAbortPayload,
  Action,
} from "../../shared/types";

function makeDeps(overrides: Partial<GuideControllerDeps> = {}): GuideControllerDeps {
  return {
    overlay: { show: vi.fn().mockResolvedValue(undefined), hide: vi.fn() },
    mouseHook: { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() },
    getActiveHwnd: vi.fn().mockResolvedValue(1234),
    getCursorPos: vi.fn().mockReturnValue({ x: 50, y: 50 }),
    sendFollowUp: vi.fn().mockResolvedValue(undefined),
    buildFollowUpPrompt: vi.fn().mockResolvedValue("follow-up prompt"),
    onStateUpdate: vi.fn(),
    ...overrides,
  };
}

const sampleOffer: GuideOfferPayload = {
  type: "guide_offer",
  summary: "Walk through exporting Excel as PDF",
  estSteps: 4,
  options: ["Cancel", "Start guide"],
};

const sampleStep: GuideStepPayload = {
  type: "guide_step",
  caption: "Click the Save button",
  target: {
    selector: "Save",
    automationId: "saveBtn",
    boundsHint: { x: 100, y: 100, width: 80, height: 24 },
  },
  options: ["Cancel", "I did it"],
  trackable: true,
  waitMs: 800,
  stepIndex: 1,
  estStepsLeft: 3,
};

const sampleStepNonTrackable: GuideStepPayload = {
  ...sampleStep,
  caption: "Type your password into the field",
  target: null,
  options: ["Cancel", "I see the dialog", "Nothing happened", "I see an error"],
  trackable: false,
};

describe("GuideController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("offer phase", () => {
    it("guide_offer transitions IDLE → OFFER and emits state update", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      expect(ctrl.getPhase()).toBe("offer");
      expect(deps.onStateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ phase: "offer", summary: sampleOffer.summary }),
      );
    });

    it("guide_offer with estSteps < 2 is rejected (no transition)", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction({
        ...sampleOffer,
        estSteps: 1,
      } as unknown as Action);
      expect(ctrl.getPhase()).toBe("idle");
      expect(deps.onStateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "idle",
          finalMessage: expect.stringContaining("estSteps < 2"),
        }),
      );
    });

    it("user choice 'Cancel' from OFFER returns to IDLE and informs AI", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Cancel");
      expect(ctrl.getPhase()).toBe("idle");
      expect(deps.sendFollowUp).toHaveBeenCalled();
    });

    it("user choice 'Start guide' from OFFER triggers AI follow-up requesting first step", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      expect(deps.buildFollowUpPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "option", choice: "Start guide" }),
      );
      expect(deps.sendFollowUp).toHaveBeenCalled();
      expect(ctrl.getPhase()).toBe("awaiting-ai");
    });
  });

  describe("step phase", () => {
    it("guide_step transitions to STEP_ACTIVE; trackable=true starts mouse hook AND shows overlay", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      await ctrl.handleAction(sampleStep as unknown as Action);
      expect(ctrl.getPhase()).toBe("step-active");
      expect(deps.mouseHook.start).toHaveBeenCalledWith(
        expect.objectContaining({ scopeHwnd: 1234 }),
      );
      expect(deps.overlay.show).toHaveBeenCalledWith(
        sampleStep.target!.boundsHint!,
        expect.any(Object),
      );
    });

    it("guide_step trackable=false does NOT start mouse hook and does NOT show overlay (target=null)", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      await ctrl.handleAction(sampleStepNonTrackable as unknown as Action);
      expect(ctrl.getPhase()).toBe("step-active");
      expect(deps.mouseHook.start).not.toHaveBeenCalled();
      expect(deps.overlay.show).not.toHaveBeenCalled();
    });

    it("mouse hook click event during STEP_ACTIVE transitions through WAITING → RECAPTURING → AWAITING_AI", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      await ctrl.handleAction(sampleStep as unknown as Action);

      // Get the onClick handler that was registered with mouseHook.start
      const startCall = (deps.mouseHook.start as any).mock.calls[0][0];
      startCall.onClick({ x: 120, y: 110, button: "left" });

      // Advance through the waitMs sleep
      await vi.advanceTimersByTimeAsync(sampleStep.waitMs + 50);
      // Final phase after advance
      expect(ctrl.getPhase()).toBe("awaiting-ai");
      expect(deps.buildFollowUpPrompt).toHaveBeenCalledWith({
        kind: "click",
        x: 120,
        y: 110,
      });
      expect(deps.sendFollowUp).toHaveBeenCalled();
      expect(deps.mouseHook.stop).toHaveBeenCalled();
    });

    it("user option click during STEP_ACTIVE transitions through the same phases", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      await ctrl.handleAction(sampleStepNonTrackable as unknown as Action);

      await ctrl.handleUserChoice("I see the dialog");
      await vi.advanceTimersByTimeAsync(sampleStepNonTrackable.waitMs + 50);
      expect(ctrl.getPhase()).toBe("awaiting-ai");
      expect(deps.buildFollowUpPrompt).toHaveBeenCalledWith({
        kind: "option",
        choice: "I see the dialog",
      });
    });

    it("rapid mouse clicks coalesce — only the FIRST position is used in the follow-up", async () => {
      // Documented behaviour: FIRST-WINS coalesce.
      //
      // onMouseClick runs synchronously: it records the pending action, then
      // calls `void this.advanceFromStep()`. advanceFromStep also runs its
      // pre-await body synchronously: it flips phase from "step-active" to
      // "waiting" before yielding. The 2nd and 3rd onClick calls then hit
      // the `phase !== "step-active"` guard inside onMouseClick and are
      // dropped — they never even update pendingAction. Net effect: the
      // first click wins; subsequent rapid clicks during the same step are
      // no-ops until the next guide_step arrives.
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      await ctrl.handleAction(sampleStep as unknown as Action);

      // Reset the mock so we only count calls made by the click flow.
      (deps.buildFollowUpPrompt as any).mockClear();

      const startCall = (deps.mouseHook.start as any).mock.calls[0][0];
      startCall.onClick({ x: 100, y: 100, button: "left" });
      startCall.onClick({ x: 200, y: 200, button: "left" });
      startCall.onClick({ x: 300, y: 300, button: "left" });

      await vi.advanceTimersByTimeAsync(sampleStep.waitMs + 50);
      expect(deps.buildFollowUpPrompt).toHaveBeenCalledTimes(1);
      const calledWith = (deps.buildFollowUpPrompt as any).mock.calls[0][0];
      expect(calledWith).toEqual({ kind: "click", x: 100, y: 100 });
    });
  });

  describe("cancel and abort", () => {
    it("cancel() during STEP_ACTIVE stops hook, hides overlay, returns to IDLE, informs AI", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      await ctrl.handleAction(sampleStep as unknown as Action);
      await ctrl.cancel();
      expect(ctrl.getPhase()).toBe("idle");
      expect(deps.mouseHook.stop).toHaveBeenCalled();
      expect(deps.overlay.hide).toHaveBeenCalled();
      expect(deps.sendFollowUp).toHaveBeenCalled();
    });

    it("cancel() while IDLE is a no-op", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.cancel();
      expect(deps.mouseHook.stop).not.toHaveBeenCalled();
      expect(deps.overlay.hide).not.toHaveBeenCalled();
      expect(deps.sendFollowUp).not.toHaveBeenCalled();
    });

    it("guide_complete transitions to IDLE and emits a completion state update", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      await ctrl.handleAction(sampleStep as unknown as Action);

      const complete: GuideCompletePayload = {
        type: "guide_complete",
        summary: "Done. PDF saved.",
      };
      await ctrl.handleAction(complete as unknown as Action);
      expect(ctrl.getPhase()).toBe("idle");
      expect(deps.mouseHook.stop).toHaveBeenCalled();
      expect(deps.overlay.hide).toHaveBeenCalled();
      expect(deps.onStateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ phase: "idle", finalMessage: "Done. PDF saved." }),
      );
    });

    it("guide_abort transitions to IDLE and emits the abort reason", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      await ctrl.handleAction(sampleStep as unknown as Action);

      const abort: GuideAbortPayload = {
        type: "guide_abort",
        reason: "User got off track.",
      };
      await ctrl.handleAction(abort as unknown as Action);
      expect(ctrl.getPhase()).toBe("idle");
      expect(deps.onStateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ phase: "idle", finalMessage: "User got off track." }),
      );
    });

    it("hard 5-min step inactivity timeout fires guide_abort", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      await ctrl.handleAction(sampleStep as unknown as Action);

      // Advance 5 minutes + 1 second
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
      expect(ctrl.getPhase()).toBe("idle");
      expect(deps.onStateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "idle",
          finalMessage: expect.stringMatching(/inactivity/i),
        }),
      );
    });
  });
});
