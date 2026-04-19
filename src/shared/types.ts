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
  _pctDist?: string;
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
  | "guide_to";

export interface Action {
  type: ActionType;
  text?: string;
  selector?: string;
  combination?: string;
  automationId?: string;
  boundsHint?: { x: number; y: number; width: number; height: number };
  parentChain?: string[];
  autoClick?: boolean;
}

export interface Config {
  model: string;
  workingDir: string;
  autoClickGuide: boolean;
  recentModels: string[];
  hotkeyPointer: string;
  hotkeyArea: string;
  panelWidth: number;
  panelHeight: number;
  launchOnStartup: boolean;
  hasCompletedWelcome: boolean;
  telemetryEnabled: boolean;
  theme: "system" | "light" | "dark";
  /** Base font size in px. Applied as `--font-size-base` on :root. */
  fontSize: number;
}

export const DEFAULT_CONFIG: Config = {
  model: "zai-coding-plan/glm-4.6v",
  workingDir: "",
  autoClickGuide: false,
  recentModels: ["zai-coding-plan/glm-4.6v"],
  hotkeyPointer: "Alt+Space",
  hotkeyArea: "CommandOrControl+Space",
  panelWidth: 380,
  panelHeight: 480,
  launchOnStartup: false,
  hasCompletedWelcome: false,
  telemetryEnabled: false,
  theme: "system",
  fontSize: 14,
};

export interface WindowInfo {
  title: string;
  processName: string;
  processPath: string;
}

export interface ContextPayload {
  element: UIElement;
  surrounding: UIElement[];
  cursorPos: { x: number; y: number };
  imagePath?: string;
  hasScreenshot?: boolean;
  windowInfo?: WindowInfo;
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
  RESTORE_SESSION: "restore-session",
  SESSION_HISTORY: "session-history",
  STOP_RESPONSE: "stop-response",
  VALIDATE_MODEL: "validate-model",
  CURSOR_POS: "cursor-pos",
} as const;