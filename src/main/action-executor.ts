// src/main/action-executor.ts
//
// Thin lazy dispatcher for desktop actions.
//
// `copy_to_clipboard` is handled inline (always allowed, also works in
// read-only mode) so the heavy module is never loaded when the user only
// asks for a clipboard copy. Every other action type is forwarded to
// `actions/action-executor-heavy.ts` via dynamic `await import(...)`,
// which is what splits the bundle so heavy never loads when
// `actionsEnabled === false`.
//
// What also lives here (always loaded): action validation
// (`validateAction`), parsing the LLM's `<!--ACTION:{...}-->` markers
// (`parseActionsFromResponse`), the small `isInteractiveAction` helper
// used by the IPC layer, and the per-context "last hovered element"
// cache that the dispatcher forwards to the heavy module.

import { Action, ActionType, GUIDE_ACTION_TYPES } from "../shared/types";
import { log } from "./logger";

export interface ActionResult {
  success: boolean;
  error?: string;
  output?: string;
  matchedElement?: string;
}

// Action types that actually drive the desktop (mouse, keyboard, UIA invoke).
// Everything NOT in this set is considered "safe" in read-only mode —
// copy_to_clipboard only touches the clipboard, nothing else.
const INTERACTIVE_ACTION_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  "click_element",
  "invoke_element",
  "type_text",
  "paste_text",
  "set_value",
  "press_keys",
  "guide_to",
]);

export function isInteractiveAction(type: ActionType): boolean {
  return INTERACTIVE_ACTION_TYPES.has(type);
}

// Cached "last hovered/focused element" from the most recent context capture.
// The dispatcher forwards this to the heavy module so it can fall back to
// the captured automationId/bounds when the Action itself doesn't carry one.
let lastContextElement: { automationId?: string; bounds?: { x: number; y: number; width: number; height: number }; name?: string; type?: string } | null = null;

export function setLastContextElement(element: { automationId?: string; bounds?: { x: number; y: number; width: number; height: number }; name?: string; type?: string } | null): void {
  lastContextElement = element;
  log(`setLastContextElement: name="${element?.name}" type="${element?.type}" automationId="${element?.automationId || ""}"`);
}

/** Inline `copy_to_clipboard` handler. Lives here (not in heavy.ts) so the
 *  heavy module never gets loaded when the user is in read-only mode and
 *  only triggers a clipboard copy. */
async function executeCopyClipboard(action: Action): Promise<ActionResult> {
  if (!action.text) return { success: false, error: "No text provided" };
  log(`copy_to_clipboard: length=${action.text.length}`);
  try {
    const { clipboard } = require("electron");
    clipboard.writeText(action.text);
    log("copy_to_clipboard: completed");
    return { success: true };
  } catch (err: any) {
    log(`copy_to_clipboard FAILED: ${err.message}`);
    return { success: false, error: "Copy failed" };
  }
}

/** Execute an action. Inline path for `copy_to_clipboard` (always allowed,
 *  works in read-only mode). Lazy-imports the heavy chunk for everything
 *  else, gated on `actionsEnabled`.
 *
 *  Do NOT introduce a top-level `import { executeHeavyAction } from
 *  "./actions/action-executor-heavy"` — that would defeat the lazy-loading
 *  purpose. The dynamic `await import(...)` is what splits the bundle. */
export async function executeAction(
  action: Action,
  cfg: { actionsEnabled: boolean }
): Promise<ActionResult> {
  if (action.type === "copy_to_clipboard") {
    return executeCopyClipboard(action);
  }
  if (!cfg.actionsEnabled) {
    return {
      success: false,
      error: "Desktop actions are disabled (read-only mode). Toggle 'Allow desktop actions' in settings to enable.",
    };
  }
  const heavy = await import("./actions/action-executor-heavy");
  return heavy.executeHeavyAction(action, lastContextElement || {});
}

export const ALLOWED_ACTION_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  "type_text",
  "paste_text",
  "click_element",
  "set_value",
  "invoke_element",
  "copy_to_clipboard",
  "press_keys",
  "guide_to",
  // Auto-Guide markers — recognized so parseActionsFromResponse can extract
  // them from AI responses. The guide controller (Task 6.1) routes these
  // through its own dispatcher; the validation gate (autoGuideEnabled) lives
  // below in validateAction.
  "guide_offer",
  "guide_step",
  "guide_complete",
  "guide_abort",
]);

interface ValidationConfig {
  actionsEnabled: boolean;
  autoGuideEnabled: boolean;
}

/**
 * Coerce an untrusted IPC payload to a clean `Action`. Returns the sanitized
 * action, or `{ error }` if the payload is not a safe allowed-type action.
 * Called at every IPC boundary that reaches `executeAction`.
 *
 * `cfg.autoGuideEnabled` gates the four guide_* marker types; without it the
 * guide payloads must not reach the controller.
 */
export function validateAction(
  payload: unknown,
  cfg: ValidationConfig
): { action: Action } | { error: string } {
  if (!payload || typeof payload !== "object") return { error: "Action payload is not an object" };
  const p = payload as Record<string, unknown>;
  if (typeof p.type !== "string") return { error: "Action.type must be a string" };

  // Route guide markers to the dedicated schema validator. Auto-Guide must
  // be enabled in settings for these to pass.
  if (GUIDE_ACTION_TYPES.has(p.type as ActionType)) {
    if (!cfg.autoGuideEnabled) return { error: "Auto-Guide is disabled in settings" };
    return validateGuideAction(p);
  }

  if (!ALLOWED_ACTION_TYPES.has(p.type as ActionType)) {
    return { error: `Action.type "${p.type}" is not allowed` };
  }
  const action: Action = { type: p.type as ActionType };
  if (typeof p.text === "string") action.text = p.text;
  if (typeof p.selector === "string") action.selector = p.selector;
  if (typeof p.combination === "string") action.combination = p.combination;
  if (typeof p.automationId === "string") action.automationId = p.automationId;
  if (typeof p.autoClick === "boolean") action.autoClick = p.autoClick;
  if (p.boundsHint && typeof p.boundsHint === "object") {
    const b = p.boundsHint as any;
    if (
      typeof b.x === "number" && typeof b.y === "number" &&
      typeof b.width === "number" && typeof b.height === "number"
    ) {
      action.boundsHint = { x: b.x, y: b.y, width: b.width, height: b.height };
    }
  }
  if (Array.isArray(p.parentChain) && p.parentChain.every((s) => typeof s === "string")) {
    action.parentChain = p.parentChain as string[];
  }
  return { action };
}

/** Strict schema check for the four guide_* marker payloads. The Action
 *  interface is intentionally narrow (it's the runtime executor's contract),
 *  so we cast through `unknown` — the controller (Task 4.3 / 6.1) consumes
 *  the typed `Guide*Payload` interfaces from shared/types via narrowing. */
function validateGuideAction(p: Record<string, unknown>): { action: Action } | { error: string } {
  switch (p.type) {
    case "guide_offer": {
      if (typeof p.summary !== "string") return { error: "guide_offer.summary must be string" };
      if (typeof p.estSteps !== "number" || !Number.isInteger(p.estSteps))
        return { error: "guide_offer.estSteps must be an integer" };
      if (p.estSteps < 2)
        return { error: "guide_offer.estSteps must be at least 2 (use a single action for one step)" };
      if (!Array.isArray(p.options)) return { error: "guide_offer.options must be an array" };
      return { action: p as unknown as Action };
    }
    case "guide_step": {
      if (typeof p.caption !== "string") return { error: "guide_step.caption must be string" };
      if (!Array.isArray(p.options) || !p.options.includes("Cancel"))
        return { error: 'guide_step.options must include "Cancel"' };
      if (typeof p.trackable !== "boolean") return { error: "guide_step.trackable must be boolean" };
      if (typeof p.waitMs !== "number" || p.waitMs < 100 || p.waitMs > 10000)
        return { error: "guide_step.waitMs must be a number between 100 and 10000" };
      if (typeof p.stepIndex !== "number" || p.stepIndex < 1)
        return { error: "guide_step.stepIndex must be a positive integer" };
      if (typeof p.estStepsLeft !== "number" || p.estStepsLeft < 0)
        return { error: "guide_step.estStepsLeft must be a non-negative integer" };
      return { action: p as unknown as Action };
    }
    case "guide_complete": {
      if (typeof p.summary !== "string") return { error: "guide_complete.summary must be string" };
      return { action: p as unknown as Action };
    }
    case "guide_abort": {
      if (typeof p.reason !== "string") return { error: "guide_abort.reason must be string" };
      return { action: p as unknown as Action };
    }
    default:
      return { error: `unknown guide marker type: ${String(p.type)}` };
  }
}

export interface ParsedActions {
  actions: Action[];
  blocked: Array<{ type: string; reason: string }>;
}

export function parseActionsFromResponse(text: string): ParsedActions {
  const actions: Action[] = [];
  const blocked: Array<{ type: string; reason: string }> = [];
  const regex = /<!--ACTION:([\s\S]*?)-->/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      let jsonStr = match[1].trim();
      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        const firstBrace = jsonStr.indexOf("{");
        const lastBrace = jsonStr.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
          parsed = JSON.parse(jsonStr);
        } else {
          log(`Failed to extract JSON from action marker: ${match[1].slice(0, 80)}`);
          continue;
        }
      }
      if (typeof parsed.type !== "string") continue;

      if (!ALLOWED_ACTION_TYPES.has(parsed.type as ActionType)) {
        const reason =
          parsed.type === "run_command"
            ? "shell commands are disabled in Mudrik"
            : `unknown action type "${parsed.type}"`;
        log(`BLOCKED action marker: type=${parsed.type} (${reason})`);
        blocked.push({ type: parsed.type, reason });
        continue;
      }

      const action: Action = {
        type: parsed.type as ActionType,
        text: parsed.text,
        selector: parsed.selector,
        combination: parsed.combination,
      };
      if (parsed.automationId) action.automationId = parsed.automationId;
      if (parsed.boundsHint) action.boundsHint = parsed.boundsHint;
      if (parsed.parentChain) action.parentChain = parsed.parentChain;
      if (parsed.autoClick !== undefined) action.autoClick = parsed.autoClick;
      actions.push(action);
      log(`Parsed action: type=${action.type} selector=${action.selector || ""} automationId=${action.automationId || ""}`);
    } catch (err: any) {
      log(`Failed to parse action marker: ${match[1].slice(0, 50)}, error: ${err.message}`);
    }
  }
  if (actions.length === 0 && blocked.length === 0) {
    log("No actions found in response");
  }
  return { actions, blocked };
}
