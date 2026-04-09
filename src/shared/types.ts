export interface UIElement {
  name: string;
  type: string;
  value: string;
  bounds: { x: number; y: number; width: number; height: number };
  children: UIElement[];
}

export type ActionType =
  | "type_text"
  | "paste_text"
  | "click_element"
  | "copy_to_clipboard"
  | "press_keys";

export interface Action {
  type: ActionType;
  text?: string;
  selector?: string;
  combination?: string;
}

export interface Config {
  ollamaUrl: string;
  model: string;
  cloudProxyUrl: string;
  hotkeyModifier: "ctrl" | "alt" | "shift";
}

export const DEFAULT_CONFIG: Config = {
  ollamaUrl: "http://localhost:11434",
  model: "llama3",
  cloudProxyUrl: "",
  hotkeyModifier: "ctrl",
};

export interface ContextPayload {
  element: UIElement;
  surrounding: UIElement[];
  cursorPos: { x: number; y: number };
}

export const IPC = {
  ACTIVATE: "activate",
  CONTEXT_READY: "context-ready",
  SEND_PROMPT: "send-prompt",
  STREAM_TOKEN: "stream-token",
  STREAM_DONE: "stream-done",
  STREAM_ERROR: "stream-error",
  EXECUTE_ACTION: "execute-action",
  ACTION_RESULT: "action-result",
  GET_CONFIG: "get-config",
  SET_CONFIG: "set-config",
  DISMISS: "dismiss",
} as const;