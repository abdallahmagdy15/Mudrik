import robot from "robotjs";
import { Action } from "../shared/types";

const VK_MAP: Record<string, string> = {
  ctrl: "control",
  alt: "alt",
  shift: "shift",
  enter: "enter",
  tab: "tab",
  escape: "escape",
  backspace: "backspace",
  delete: "delete",
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function typeText(text: string): Promise<void> {
  robot.typeString(text);
}

async function pasteText(text: string): Promise<boolean> {
  try {
    const { clipboard } = require("electron");
    clipboard.writeText(text);
    await sleep(50);
    robot.keyTap("v", "control");
    return true;
  } catch {
    return false;
  }
}

async function pressKeys(combination: string): Promise<void> {
  const keys = combination.split("+").map((k) => k.trim().toLowerCase());

  const held: string[] = [];
  for (const key of keys) {
    const mapped = VK_MAP[key] || key;
    if (["control", "alt", "shift"].includes(mapped)) {
      robot.keyToggle(mapped, "down");
      held.push(mapped);
    }
  }

  await sleep(30);

  for (const key of keys) {
    const mapped = VK_MAP[key] || key;
    if (!["control", "alt", "shift"].includes(mapped)) {
      robot.keyTap(mapped);
    }
  }

  await sleep(30);

  for (const key of held.reverse()) {
    robot.keyToggle(key, "up");
  }
}

function copyToClipboard(text: string): boolean {
  try {
    const { clipboard } = require("electron");
    clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function executeAction(action: Action): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    switch (action.type) {
      case "type_text":
        if (!action.text) return { success: false, error: "No text provided" };
        await typeText(action.text);
        return { success: true };

      case "paste_text":
        if (!action.text) return { success: false, error: "No text provided" };
        const pasted = await pasteText(action.text);
        return pasted
          ? { success: true }
          : { success: false, error: "Paste failed" };

      case "click_element":
        if (!action.selector) return { success: false, error: "No selector" };
        return {
          success: false,
          error: "Click by selector not yet implemented",
        };

      case "copy_to_clipboard":
        if (!action.text) return { success: false, error: "No text provided" };
        const copied = copyToClipboard(action.text);
        return copied
          ? { success: true }
          : { success: false, error: "Copy failed" };

      case "press_keys":
        if (!action.combination)
          return { success: false, error: "No combination" };
        await pressKeys(action.combination);
        return { success: true };

      default:
        return { success: false, error: `Unknown action: ${action.type}` };
    }
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

export function parseActionsFromResponse(text: string): Action[] {
  const actions: Action[] = [];
  const regex = /<!--ACTION:(\{[^}]+\})-->/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const action = JSON.parse(match[1]);
      if (action.type) {
        actions.push(action);
      }
    } catch {
      // skip malformed
    }
  }
  return actions;
}