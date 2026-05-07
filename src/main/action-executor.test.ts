import { describe, expect, it } from "vitest";
import { validateAction } from "./action-executor";

const cfg = (autoGuideEnabled: boolean, actionsEnabled = true) => ({
  actionsEnabled,
  autoGuideEnabled,
});

describe("validateAction — guide markers", () => {
  it("rejects guide_offer when autoGuideEnabled=false", () => {
    const r = validateAction(
      { type: "guide_offer", summary: "x", estSteps: 3, options: ["Cancel", "Start guide"] },
      cfg(false)
    );
    expect("error" in r && r.error).toMatch(/Auto-Guide is disabled/i);
  });

  it("rejects guide_offer with estSteps < 2 even when enabled", () => {
    const r = validateAction(
      { type: "guide_offer", summary: "x", estSteps: 1, options: ["Cancel", "Start guide"] },
      cfg(true)
    );
    expect("error" in r && r.error).toMatch(/at least 2/i);
  });

  it("accepts a valid guide_offer when enabled", () => {
    const r = validateAction(
      { type: "guide_offer", summary: "x", estSteps: 3, options: ["Cancel", "Start guide"] },
      cfg(true)
    );
    expect("action" in r).toBe(true);
  });

  it("rejects guide_step with options not including 'Cancel'", () => {
    const r = validateAction(
      {
        type: "guide_step",
        caption: "x",
        target: null,
        options: ["I did it"],
        trackable: false,
        waitMs: 800,
        stepIndex: 1,
        estStepsLeft: 2,
      },
      cfg(true)
    );
    expect("error" in r && r.error).toMatch(/options must include "Cancel"/i);
  });

  it("rejects guide_step with waitMs out of range", () => {
    const r = validateAction(
      {
        type: "guide_step",
        caption: "x",
        target: null,
        options: ["Cancel", "I did it"],
        trackable: false,
        waitMs: 50000,
        stepIndex: 1,
        estStepsLeft: 2,
      },
      cfg(true)
    );
    expect("error" in r && r.error).toMatch(/waitMs/i);
  });

  it("accepts a valid guide_step when enabled", () => {
    const r = validateAction(
      {
        type: "guide_step",
        caption: "Click Save",
        target: { selector: "Save", automationId: "saveBtn" },
        options: ["Cancel", "I did it"],
        trackable: true,
        waitMs: 800,
        stepIndex: 1,
        estStepsLeft: 3,
      },
      cfg(true)
    );
    expect("action" in r).toBe(true);
  });

  it("accepts a valid guide_complete and guide_abort", () => {
    expect("action" in validateAction({ type: "guide_complete", summary: "Done." }, cfg(true))).toBe(true);
    expect("action" in validateAction({ type: "guide_abort", reason: "User off track." }, cfg(true))).toBe(true);
  });
});

describe("validateAction — existing types unaffected", () => {
  it("still accepts a valid paste_text payload (regression)", () => {
    const r = validateAction(
      { type: "paste_text", selector: "Body", text: "hello" },
      cfg(false) // autoGuideEnabled doesn't matter for non-guide markers
    );
    expect("action" in r).toBe(true);
  });

  it("still rejects unknown action types (regression)", () => {
    const r = validateAction({ type: "run_command", command: "rm -rf /" }, cfg(true));
    expect("error" in r).toBe(true);
  });
});
