import { describe, expect, it } from "vitest";
import {
  BASE_PROMPT,
  ACTION_PROMPT_FULL,
  ACTION_PROMPT_AWARE,
  SYSTEM_PROMPT,
  buildSystemPrompt,
  GUIDE_PROMPT_AWARE,
  GUIDE_PROMPT_FULL,
} from "./prompts";

describe("prompts split", () => {
  it("BASE_PROMPT exists and includes the Mudrik intro", () => {
    expect(BASE_PROMPT).toBeTypeOf("string");
    expect(BASE_PROMPT).toContain("Mudrik");
    expect(BASE_PROMPT).toContain("UIA");
  });

  it("ACTION_PROMPT_FULL exists and includes THE CONTRACT", () => {
    expect(ACTION_PROMPT_FULL).toBeTypeOf("string");
    expect(ACTION_PROMPT_FULL).toContain("THE CONTRACT");
    expect(ACTION_PROMPT_FULL).toContain("paste_text");
  });

  it("BASE_PROMPT does NOT contain action-marker how-to", () => {
    expect(BASE_PROMPT).not.toContain("THE CONTRACT");
    expect(BASE_PROMPT).not.toContain("paste_text");
  });

  it("legacy SYSTEM_PROMPT still equals BASE + ACTION (for back-compat)", () => {
    expect(SYSTEM_PROMPT).toContain(BASE_PROMPT);
    expect(SYSTEM_PROMPT).toContain(ACTION_PROMPT_FULL);
  });
});

describe("ACTION_PROMPT_AWARE", () => {
  it("is short (under 60 words)", () => {
    expect(ACTION_PROMPT_AWARE.split(/\s+/).length).toBeLessThan(60);
  });

  it("forbids interactive markers but explicitly allows copy_to_clipboard", () => {
    expect(ACTION_PROMPT_AWARE).toContain("DISABLED");
    expect(ACTION_PROMPT_AWARE).toMatch(/copy_to_clipboard.*allowed/i);
  });

  it("tells the AI how the user can re-enable", () => {
    expect(ACTION_PROMPT_AWARE).toContain("Allow desktop actions");
    expect(ACTION_PROMPT_AWARE).toContain("settings");
  });
});

describe("buildSystemPrompt", () => {
  it("with actionsEnabled=true, includes ACTION_PROMPT_FULL not AWARE", () => {
    const out = buildSystemPrompt({ actionsEnabled: true, autoGuideEnabled: false });
    expect(out).toContain(ACTION_PROMPT_FULL);
    expect(out).not.toContain(ACTION_PROMPT_AWARE);
  });

  it("with actionsEnabled=false, includes ACTION_PROMPT_AWARE not FULL", () => {
    const out = buildSystemPrompt({ actionsEnabled: false, autoGuideEnabled: false });
    expect(out).toContain(ACTION_PROMPT_AWARE);
    expect(out).not.toContain(ACTION_PROMPT_FULL);
  });

  it("always includes BASE_PROMPT", () => {
    const out1 = buildSystemPrompt({ actionsEnabled: true, autoGuideEnabled: false });
    const out2 = buildSystemPrompt({ actionsEnabled: false, autoGuideEnabled: false });
    expect(out1).toContain(BASE_PROMPT);
    expect(out2).toContain(BASE_PROMPT);
  });
});

describe("GUIDE_PROMPT_AWARE", () => {
  it("is short (under 60 words)", () => {
    expect(GUIDE_PROMPT_AWARE.split(/\s+/).length).toBeLessThan(60);
  });

  it("forbids guide markers and tells how to enable", () => {
    expect(GUIDE_PROMPT_AWARE).toContain("guide_offer");
    expect(GUIDE_PROMPT_AWARE).toContain("DISABLED");
    expect(GUIDE_PROMPT_AWARE).toContain("Auto-Guide");
    expect(GUIDE_PROMPT_AWARE).toContain("settings");
  });
});

describe("buildSystemPrompt — guide block AWARE", () => {
  it("with autoGuideEnabled=false, includes GUIDE_PROMPT_AWARE", () => {
    const out = buildSystemPrompt({ actionsEnabled: true, autoGuideEnabled: false });
    expect(out).toContain(GUIDE_PROMPT_AWARE);
  });

  it("with autoGuideEnabled=true, does NOT include GUIDE_PROMPT_AWARE", () => {
    const out = buildSystemPrompt({ actionsEnabled: true, autoGuideEnabled: true });
    expect(out).not.toContain(GUIDE_PROMPT_AWARE);
  });
});

describe("GUIDE_PROMPT_FULL", () => {
  it("documents all four marker types", () => {
    expect(GUIDE_PROMPT_FULL).toContain("guide_offer");
    expect(GUIDE_PROMPT_FULL).toContain("guide_step");
    expect(GUIDE_PROMPT_FULL).toContain("guide_complete");
    expect(GUIDE_PROMPT_FULL).toContain("guide_abort");
  });

  it("has strict 'when not to use' rules", () => {
    expect(GUIDE_PROMPT_FULL).toContain("DO NOT use guide mode");
    expect(GUIDE_PROMPT_FULL).toContain("Single actions");
  });

  it("includes a positive example with guide_offer first", () => {
    expect(GUIDE_PROMPT_FULL).toContain("ALWAYS emit this first");
  });

  it("includes a negative example showing single-action fallback", () => {
    expect(GUIDE_PROMPT_FULL).toContain("invoke_element");
  });
});

describe("buildSystemPrompt — guide block FULL", () => {
  it("with autoGuideEnabled=true, includes GUIDE_PROMPT_FULL not AWARE", () => {
    const out = buildSystemPrompt({ actionsEnabled: true, autoGuideEnabled: true });
    expect(out).toContain(GUIDE_PROMPT_FULL);
    expect(out).not.toContain(GUIDE_PROMPT_AWARE);
  });
});
