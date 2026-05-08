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
  isContained?: boolean;
  depth?: number;
  isTarget?: boolean;
}

export interface VisibleWindow {
  name: string;
  type: string;
  bounds: { x: number; y: number; width: number; height: number };
  processName: string;
  isActive?: boolean;
  isMinimized?: boolean;
}

export type ActionType =
  | "type_text"
  | "paste_text"
  | "click_element"
  | "set_value"
  | "invoke_element"
  | "copy_to_clipboard"
  | "press_keys"
  | "guide_to"
  // new (Auto-Guide mode)
  | "guide_offer"
  | "guide_step"
  | "guide_complete"
  | "guide_abort";

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

export interface GuideOfferPayload {
  type: "guide_offer";
  summary: string;
  estSteps: number;
  options: string[];
}

export interface GuideStepPayload {
  type: "guide_step";
  caption: string;
  target: {
    selector: string;
    automationId?: string;
    boundsHint?: { x: number; y: number; width: number; height: number };
  } | null;
  options: string[];
  trackable: boolean;
  waitMs: number;
  stepIndex: number;
  estStepsLeft: number;
  /**
   * Subset of `options` whose selection ENDS the guide locally without an
   * AI roundtrip. Use for terminal "Done" / "Task complete" / "Goal reached"
   * confirmations on the final step. Saves tokens on what would otherwise be
   * a wasted "ack — guide complete" turn.
   */
  closeOptions?: string[];
}

export interface GuideCompletePayload {
  type: "guide_complete";
  summary: string;
}

export interface GuideAbortPayload {
  type: "guide_abort";
  reason: string;
}

/** The four marker types that drive Auto-Guide mode. Used by validateAction
 *  and by action-executor to decide whether to dispatch through the guide
 *  controller path. */
export const GUIDE_ACTION_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  "guide_offer", "guide_step", "guide_complete", "guide_abort",
]);

export interface Config {
  model: string;
  workingDir: string;
  /**
   * Master switch for desktop-interactive actions (click, type, paste, press
   * keys, invoke, set_value, guide_to). When false, the model runs in
   * read-only mode: it can still answer questions and put text on the
   * clipboard (copy_to_clipboard / COPY chips), but cannot drive the desktop.
   */
  actionsEnabled: boolean;
  recentModels: string[];
  /**
   * Map of provider name → API key. When spawning OpenCode (for both
   * `opencode run` and `opencode models`), each entry is injected as an
   * environment variable following the provider-env-var convention (e.g.
   * `anthropic` → `ANTHROPIC_API_KEY`). Keys are stored in plaintext in
   * config.json — a future release may migrate to Electron `safeStorage`.
   */
  apiKeys: Record<string, string>;
  hotkeyPointer: string;
  hotkeyArea: string;
  panelWidth: number;
  panelHeight: number;
  launchOnStartup: boolean;
  hasCompletedWelcome: boolean;
  theme: "system" | "light" | "dark";
  lang: "en" | "ar";
  /** Base font size in px. Applied as `--font-size-base` on :root. */
  fontSize: number;
  /** When true, restores previous chat history on panel popup. When false, always starts fresh. */
  restoreSessionOnActivate: boolean;
  /** When true, automatically captures and attaches a full-screen screenshot on Alt+Space (pointer) activation. Area selection always includes its screenshot regardless. */
  autoAttachImage: boolean;
  /** When true, enables Auto-Guide mode (step-by-step walkthroughs of
   *  multi-step tasks). Adds ~700 tokens to every system prompt — opt-in
   *  to keep prompts lean. Lazy-loads the guide module on first use. */
  autoGuideEnabled: boolean;
}

export const DEFAULT_CONFIG: Config = {
  model: "ollama-cloud/gemini-3-flash-preview",
  workingDir: "",
  actionsEnabled: true,
  recentModels: ["ollama-cloud/gemini-3-flash-preview"],
  apiKeys: {},
  hotkeyPointer: "Alt+Space",
  hotkeyArea: "CommandOrControl+Space",
  panelWidth: 380,
  panelHeight: 400,
  launchOnStartup: false,
  hasCompletedWelcome: false,
  theme: "system",
  lang: "en",
  fontSize: 14,
  restoreSessionOnActivate: true,
  autoAttachImage: false,
  autoGuideEnabled: false,
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
  windowTree?: UIElement[];
  visibleWindows?: VisibleWindow[];
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
  SAVE_API_KEY: "save-api-key",
  REMOVE_MODEL: "remove-model",
  CURSOR_POS: "cursor-pos",
  REMOVE_SCREENSHOT: "remove-screenshot",
  GUIDE_USER_CHOICE: "guide-user-choice",
  GUIDE_STATE_UPDATE: "guide-state-update",
} as const;