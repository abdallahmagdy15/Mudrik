import { describe, expect, it } from "vitest";
import { BASE_PROMPT, ACTION_PROMPT_FULL, SYSTEM_PROMPT } from "./prompts";

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
