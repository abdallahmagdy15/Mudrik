import { describe, expect, it } from "vitest";
import { validateAction, parseActionsFromResponse } from "./action-executor";

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

  it("accepts guide_offer with estSteps=1 (AI decides; not a runtime gate)", () => {
    const r = validateAction(
      { type: "guide_offer", summary: "x", estSteps: 1, options: ["Cancel", "Start guide"] },
      cfg(true)
    );
    expect("action" in r).toBe(true);
  });

  it("accepts guide_offer with estSteps=0 — AI's call, runtime stays out of policy", () => {
    const r = validateAction(
      { type: "guide_offer", summary: "x", estSteps: 0, options: ["Cancel", "Start guide"] },
      cfg(true)
    );
    expect("action" in r).toBe(true);
  });

  it("rejects guide_offer when estSteps is non-finite (NaN/Infinity) or non-numeric — schema sanity only", () => {
    const rNaN = validateAction(
      { type: "guide_offer", summary: "x", estSteps: NaN, options: ["Cancel", "Start guide"] },
      cfg(true)
    );
    expect("error" in rNaN && rNaN.error).toMatch(/finite/i);
    const rStr = validateAction(
      { type: "guide_offer", summary: "x", estSteps: "two", options: ["Cancel", "Start guide"] },
      cfg(true)
    );
    expect("error" in rStr && rStr.error).toMatch(/finite/i);
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
        target: { selector: "Save", automationId: "saveBtn", boundsHint: { x: 100, y: 200, width: 80, height: 24 } },
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

  it("rejects trackable=true without target.boundsHint (would arm hook globally)", () => {
    const r = validateAction(
      {
        type: "guide_step",
        caption: "Click Save",
        target: null,
        options: ["Cancel", "I did it"],
        trackable: true,
        waitMs: 800,
        stepIndex: 1,
        estStepsLeft: 3,
      },
      cfg(true)
    );
    expect("error" in r && r.error).toMatch(/boundsHint/i);
  });

  it("accepts trackable=false without boundsHint (typing/scrolling steps)", () => {
    const r = validateAction(
      {
        type: "guide_step",
        caption: "Type your filename",
        target: null,
        options: ["Cancel", "I see the dialog", "Nothing happened"],
        trackable: false,
        waitMs: 800,
        stepIndex: 2,
        estStepsLeft: 2,
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

describe("parseActionsFromResponse — guide marker payloads", () => {
  it("preserves guide_offer payload fields (summary/estSteps/options) — regression for stripped-fields bug", () => {
    const text = `Sure, I'll guide you. <!--ACTION:{"type":"guide_offer","summary":"Open game from Library","estSteps":4,"options":["Cancel","Start guide"]}-->`;
    const { actions } = parseActionsFromResponse(text);
    expect(actions).toHaveLength(1);
    const a = actions[0] as any;
    expect(a.type).toBe("guide_offer");
    expect(a.summary).toBe("Open game from Library");
    expect(a.estSteps).toBe(4);
    expect(a.options).toEqual(["Cancel", "Start guide"]);
  });

  it("preserves guide_step payload fields (caption/target/trackable/waitMs/stepIndex/estStepsLeft)", () => {
    const text = `<!--ACTION:{"type":"guide_step","caption":"Click Library","target":{"selector":"Library","automationId":"libBtn","boundsHint":{"x":10,"y":20,"width":80,"height":24}},"options":["Cancel","I did it"],"trackable":true,"waitMs":800,"stepIndex":1,"estStepsLeft":3}-->`;
    const { actions } = parseActionsFromResponse(text);
    expect(actions).toHaveLength(1);
    const a = actions[0] as any;
    expect(a.type).toBe("guide_step");
    expect(a.caption).toBe("Click Library");
    expect(a.target?.boundsHint).toEqual({ x: 10, y: 20, width: 80, height: 24 });
    expect(a.options).toEqual(["Cancel", "I did it"]);
    expect(a.trackable).toBe(true);
    expect(a.waitMs).toBe(800);
    expect(a.stepIndex).toBe(1);
    expect(a.estStepsLeft).toBe(3);
  });

  it("preserves guide_abort.reason and guide_complete.summary", () => {
    const text = `<!--ACTION:{"type":"guide_abort","reason":"Screen unrecognizable"}--><!--ACTION:{"type":"guide_complete","summary":"Done — you opened the library."}-->`;
    const { actions } = parseActionsFromResponse(text);
    expect(actions).toHaveLength(2);
    expect((actions[0] as any).reason).toBe("Screen unrecognizable");
    expect((actions[1] as any).summary).toBe("Done — you opened the library.");
  });

  it("still strips unknown fields on non-guide markers (regression)", () => {
    const text = `<!--ACTION:{"type":"paste_text","selector":"Body","text":"hi","unknownField":"should be dropped"}-->`;
    const { actions } = parseActionsFromResponse(text);
    expect(actions).toHaveLength(1);
    expect((actions[0] as any).unknownField).toBeUndefined();
    expect(actions[0].type).toBe("paste_text");
    expect(actions[0].text).toBe("hi");
  });
});
