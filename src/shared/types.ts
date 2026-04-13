export interface UIElement {
  name: string;
  type: string;
  value: string;
  bounds: { x: number; y: number; width: number; height: number };
  children: UIElement[];
  automationId?: string;
  className?: string;
  isOffscreen?: boolean;
  parentChain?: string[];
  windowTitle?: string;
  distance?: number;
  direction?: string;
  _relation?: string;
  _drilledFromContainer?: boolean;
  containerType?: string;
  containerName?: string;
}

export type ActionType =
  | "type_text"
  | "paste_text"
  | "click_element"
  | "set_value"
  | "invoke_element"
  | "copy_to_clipboard"
  | "press_keys"
  | "run_command";

export interface Action {
  type: ActionType;
  text?: string;
  selector?: string;
  combination?: string;
  command?: string;
  automationId?: string;
  boundsHint?: { x: number; y: number; width: number; height: number };
  parentChain?: string[];
}

export interface Config {
  model: string;
  workingDir: string;
}

export const DEFAULT_CONFIG: Config = {
  model: "opencode-go/kimi-k2.5",
  workingDir: "",
};

export interface ContextPayload {
  element: UIElement;
  surrounding: UIElement[];
  cursorPos: { x: number; y: number };
  imagePath?: string;
  hasScreenshot?: boolean;
}

export const IPC = {
  ACTIVATE: "activate",
  CONTEXT_READY: "context-ready",
  SEND_PROMPT: "send-prompt",
  STREAM_TOKEN: "stream-token",
  STREAM_DONE: "stream-done",
  STREAM_ERROR: "stream-error",
  TOOL_USE: "tool-use",
  SESSION_RESET: "session-reset",
  EXECUTE_ACTION: "execute-action",
  ACTION_RESULT: "action-result",
  GET_CONFIG: "get-config",
  SET_CONFIG: "set-config",
  NEW_SESSION: "new-session",
  DISMISS: "dismiss",
  MINIMIZE: "minimize",
  WINDOW_MOVE: "window-move",
  RETRY_ACTION: "retry-action",
  FOCUS_INPUT: "focus-input",
  ATTACH_SCREENSHOT: "attach-screenshot",
} as const;