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
    getActiveHwnd: vi.fn().mockResolvedValue(1234),
    getCursorPos: vi.fn().mockReturnValue({ x: 50, y: 50 }),
    sendFollowUp: vi.fn().mockResolvedValue(undefined),
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

    it("guide_offer with estSteps=1 is ACCEPTED (AI decides; runtime doesn't gate on step count)", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction({ ...sampleOffer, estSteps: 1 } as unknown as Action);
      expect(ctrl.getPhase()).toBe("offer");
      expect(deps.onStateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ phase: "offer", estStepsLeft: 1 }),
      );
    });

    it("guide_offer with weird estSteps (0, negative, non-finite) is accepted but clamped to 1 for the counter", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction({ ...sampleOffer, estSteps: 0 } as unknown as Action);
      expect(ctrl.getPhase()).toBe("offer");
      expect(deps.onStateUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: "offer", estStepsLeft: 1 }),
      );
      // Reset and try negative
      (deps.onStateUpdate as ReturnType<typeof vi.fn>).mockClear();
      await ctrl.cancel();
      (deps.onStateUpdate as ReturnType<typeof vi.fn>).mockClear();
      await ctrl.handleAction({ ...sampleOffer, estSteps: -3 } as unknown as Action);
      expect(deps.onStateUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: "offer", estStepsLeft: 1 }),
      );
      // And non-numeric
      await ctrl.cancel();
      (deps.onStateUpdate as ReturnType<typeof vi.fn>).mockClear();
      await ctrl.handleAction({ ...sampleOffer, estSteps: "two" } as unknown as Action);
      expect(deps.onStateUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: "offer", estStepsLeft: 1 }),
      );
    });

    it("user choice 'Cancel' from OFFER returns to IDLE WITHOUT AI follow-up", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Cancel");
      expect(ctrl.getPhase()).toBe("idle");
      // Local short-circuit — declining the offer shouldn't burn a token round-trip
      expect(deps.sendFollowUp).not.toHaveBeenCalled();
    });

    it("user choice 'Start guide' from OFFER triggers AI follow-up requesting first step", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      expect(deps.sendFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "option", choice: "Start guide" }),
      );
      expect(ctrl.getPhase()).toBe("awaiting-ai");
    });
  });

  describe("step phase", () => {
    it("guide_step trackable=true shows overlay (mouse hook removed)", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      await ctrl.handleAction(sampleStep as unknown as Action);
      expect(ctrl.getPhase()).toBe("step-active");
      expect(deps.overlay.show).toHaveBeenCalledWith(
        sampleStep.target!.boundsHint!,
        expect.any(Object),
      );
    });

    it("guide_step trackable=false does NOT show overlay (target=null)", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      await ctrl.handleAction(sampleStepNonTrackable as unknown as Action);
      expect(ctrl.getPhase()).toBe("step-active");
      expect(deps.overlay.show).not.toHaveBeenCalled();
    });

    it("user option click during STEP_ACTIVE transitions through WAITING → RECAPTURING → AWAITING_AI", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      await ctrl.handleAction(sampleStepNonTrackable as unknown as Action);

      await ctrl.handleUserChoice("I see the dialog");
      await vi.advanceTimersByTimeAsync(sampleStepNonTrackable.waitMs + 50);
      expect(ctrl.getPhase()).toBe("awaiting-ai");
      expect(deps.sendFollowUp).toHaveBeenCalledWith({
        kind: "option",
        choice: "I see the dialog",
      });
    });

    it("user option click during a TRACKABLE step also advances (mouse hook is off — option is the only path)", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      await ctrl.handleAction(sampleStep as unknown as Action);

      await ctrl.handleUserChoice("I did it");
      await vi.advanceTimersByTimeAsync(sampleStep.waitMs + 50);
      expect(ctrl.getPhase()).toBe("awaiting-ai");
      expect(deps.sendFollowUp).toHaveBeenCalledWith({
        kind: "option",
        choice: "I did it",
      });
    });
  });

  describe("cancel and abort", () => {
    it("cancel() during STEP_ACTIVE hides overlay, returns to IDLE WITHOUT informing AI (token-saving short-circuit)", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      const sendFollowUpCallsBefore = (deps.sendFollowUp as ReturnType<typeof vi.fn>).mock.calls.length;
      await ctrl.handleAction(sampleStep as unknown as Action);
      await ctrl.cancel();
      expect(ctrl.getPhase()).toBe("idle");
      expect(deps.overlay.hide).toHaveBeenCalled();
      expect((deps.sendFollowUp as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBe(sendFollowUpCallsBefore);
    });

    it("cancel() while IDLE is a no-op", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.cancel();
      expect(deps.overlay.hide).not.toHaveBeenCalled();
      expect(deps.sendFollowUp).not.toHaveBeenCalled();
    });

    it("guide_step from idle throws (so executeAction surfaces failure, not a misleading 'OK')", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      // No prior offer — controller starts in idle
      await expect(ctrl.handleAction(sampleStep as unknown as Action)).rejects.toThrow(/no active offer/i);
      expect(ctrl.getPhase()).toBe("idle");
      // No state update for the rejection — the renderer would otherwise
      // show a misleading "Guide ended" message when the guide never started
      expect(deps.onStateUpdate).not.toHaveBeenCalled();
    });

    it("guide_complete from idle throws — common AI misread of 'start over' as 'close the previous guide'", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await expect(
        ctrl.handleAction({ type: "guide_complete", summary: "Restarting" } as unknown as Action),
      ).rejects.toThrow(/no active guide/i);
      expect(ctrl.getPhase()).toBe("idle");
      expect(deps.onStateUpdate).not.toHaveBeenCalled();
    });

    it("guide_offer from idle ALWAYS works (the entry point for start-over / resume / fresh-start)", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      expect(ctrl.getPhase()).toBe("offer");
      expect(deps.onStateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ phase: "offer" }),
      );
    });

    it("cancel() ABORTS an in-flight advanceFromStep — no screenshot/follow-up after Cancel races with a screen-click", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      await ctrl.handleAction(sampleStep as unknown as Action);
      const sendFollowUpCallsBefore = (deps.sendFollowUp as ReturnType<typeof vi.fn>).mock.calls.length;
      // Simulate a screen click — kicks off advanceFromStep with sleep(waitMs)
      // pending.
      await ctrl.handleUserChoice("I see the dialog");
      // Cancel arrives BEFORE the waitMs sleep resolves (real-world race:
      // user's click on Cancel button happens just after a stray screen
      // click already started the pipeline).
      await ctrl.cancel();
      // Drain the pending sleep + any post-await work
      await vi.runAllTimersAsync();
      expect(ctrl.getPhase()).toBe("idle");
      // The crucial assertion: advanceFromStep must NOT have called
      // sendFollowUp after cancel bumped the generation. Without the
      // generation check, the sleep would resolve and sendFollowUp would
      // fire — which is exactly the bug the user reported.
      expect((deps.sendFollowUp as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBe(sendFollowUpCallsBefore);
    });

    it("closeOptions short-circuit: clicking a terminal option closes locally with no AI round-trip", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      // Final step that lists "Done — task complete" as a closeOption.
      const finalStep = {
        type: "guide_step",
        caption: "Click Pause updates and confirm",
        target: { selector: "Pause", automationId: "pauseBtn", boundsHint: { x: 100, y: 100, width: 80, height: 24 } },
        options: ["Cancel", "Done — updates paused", "It didn't work"],
        closeOptions: ["Done — updates paused"],
        trackable: true,
        waitMs: 800,
        stepIndex: 3,
        estStepsLeft: 0,
      };
      await ctrl.handleAction(finalStep as unknown as Action);
      const sendFollowUpCallsBefore = (deps.sendFollowUp as ReturnType<typeof vi.fn>).mock.calls.length;
      await ctrl.handleUserChoice("Done — updates paused");
      expect(ctrl.getPhase()).toBe("idle");
      expect(deps.overlay.hide).toHaveBeenCalled();
      // No new follow-up — the whole point of the short-circuit
      expect((deps.sendFollowUp as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBe(sendFollowUpCallsBefore);
      // Final state update carries the chosen option as the recap
      expect(deps.onStateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ phase: "idle", finalMessage: "Done — updates paused" }),
      );
    });

    it("non-closeOption clicks still advance via AI follow-up (regression)", async () => {
      const deps = makeDeps();
      const ctrl = new GuideController(deps);
      await ctrl.handleAction(sampleOffer as unknown as Action);
      await ctrl.handleUserChoice("Start guide");
      const stepWithCloseOpts = {
        type: "guide_step",
        caption: "Click File menu",
        target: { selector: "File", automationId: "fileBtn", boundsHint: { x: 10, y: 10, width: 50, height: 24 } },
        options: ["Cancel", "Menu opened", "Nothing happened"],
        closeOptions: ["Menu opened"], // hypothetical, just exercising the schema
        trackable: true,
        waitMs: 800,
        stepIndex: 1,
        estStepsLeft: 2,
      };
      await ctrl.handleAction(stepWithCloseOpts as unknown as Action);
      const sendFollowUpCallsBefore = (deps.sendFollowUp as ReturnType<typeof vi.fn>).mock.calls.length;
      await ctrl.handleUserChoice("Nothing happened"); // NOT in closeOptions
      // Should still advance — phase moves out of step-active and a follow-up
      // is dispatched (eventually, after the waitMs sleep)
      expect(ctrl.getPhase()).not.toBe("idle");
      // Drive timers: waiting → recapturing → awaiting-ai → sendFollowUp
      await vi.runAllTimersAsync();
      expect((deps.sendFollowUp as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBeGreaterThan(sendFollowUpCallsBefore);
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
