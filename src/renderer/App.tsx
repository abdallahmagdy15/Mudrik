import React, { useState, useEffect, useCallback, useRef } from "react";
import { ContextPreview } from "./components/ContextPreview";
import { OwlMascot, OwlState } from "./components/OwlMascot";
import { ChatInput } from "./components/ChatInput";
import { ResponseView } from "./components/ResponseView";
import { ContextPayload, Action } from "@shared/types";
import { t as translate, Lang } from "@shared/i18n";

declare global {
  interface Window {
    hoverbuddy: {
      onContext: (cb: (data: ContextPayload) => void) => void;
      sendPrompt: (prompt: string) => void;
      onStreamToken: (cb: (token: string) => void) => void;
      onStreamDone: (cb: () => void) => void;
      onStreamError: (cb: (err: string) => void) => void;
      onToolUse: (cb: (event: any) => void) => void;
      onSessionReset: (cb: (data?: { hasImage?: boolean }) => void) => void;
      executeAction: (action: any) => void;
      onActionResult: (cb: (result: any) => void) => void;
      retryAction: (action: any) => void;
      dismiss: () => void;
      minimize: () => void;
      windowMove: (deltaX: number, deltaY: number) => void;
      newSession: () => void;
      onFocusInput: (cb: () => void) => void;
      attachScreenshot: () => void;
      removeScreenshot: () => void;
      onScreenshotAttached: (cb: (data: { attached: boolean; hasImage: boolean }) => void) => void;
      getConfig: () => Promise<any>;
      setConfig: (config: any) => Promise<any>;
      restoreSession: () => Promise<any>;
      onSessionHistory: (cb: (messages: any[]) => void) => void;
      stopResponse: () => void;
      validateModel: (model: string) => Promise<{ valid: boolean; modelId?: string; error?: string; suggestions?: string[]; needsAuth?: boolean; provider?: string }>;
      saveApiKey: (provider: string, key: string) => Promise<{ ok: boolean; error?: string }>;
      removeModel: (modelId: string) => Promise<any>;
    };
  }
}

interface Message {
  role: "user" | "assistant";
  content: string;
  toolUses: ToolUseEvent[];
  screenshotAttached?: boolean;
}

interface ToolUseEvent {
  tool: string;
  status: string;
  input?: Record<string, any>;
  output?: string;
}

interface ActionResultEntry {
  action: Action;
  result: { success: boolean; error?: string; output?: string };
}

interface MessageSegment {
  type: "text" | "copy-chip";
  content: string;
}

/**
 * Threshold for inlining a stream-error string in the UI. Anything longer
 * (or non-string) is treated as "unexpected runtime detail the user doesn't
 * need to see" and replaced with a localized friendly message. The full
 * value still goes to the renderer console for debugging.
 */
const MAX_INLINE_ERROR_LEN = 120;

function parseMessageContent(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const copyRe = /<!--COPY:([\s\S]*?)-->/g;
  const clean = content
    .replace(/<!--ACTION:[\s\S]*?-->/g, "")
    .replace(/<skill_content[\s\S]*?<\/skill_content>/gi, "")
    .replace(/<skill[\s\S]*?<\/skill>/gi, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/\[skill\][\s\S]*?\[\/skill\]/gi, "")
    .trim();
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = copyRe.exec(clean)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: clean.slice(lastIndex, match.index) });
    }
    segments.push({ type: "copy-chip", content: match[1] });
    lastIndex = copyRe.lastIndex;
  }
  if (lastIndex < clean.length) {
    segments.push({ type: "text", content: clean.slice(lastIndex) });
  }
  return segments;
}

export function App() {
  const [context, setContext] = useState<ContextPayload | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentResponse, setCurrentResponse] = useState("");
  const [actionResults, setActionResults] = useState<ActionResultEntry[]>([]);
  const [screenshotAttached, setScreenshotAttached] = useState(false);
  // Per-chip copied flag keyed by "<messageKey>::<segmentIndex>" so that
  // clicking one chip never highlights other chips that happen to have the
  // same text content. Cleared after 1.5s.
  const [copiedChipId, setCopiedChipId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [actionsEnabled, setActionsEnabled] = useState(true);
  const [currentModel, setCurrentModel] = useState("ollama-cloud/gemini-3-flash-preview");
  const [recentModels, setRecentModels] = useState<string[]>(["ollama-cloud/gemini-3-flash-preview"]);
  const [customModelInput, setCustomModelInput] = useState("");
  const [modelValidationError, setModelValidationError] = useState<string | null>(null);
  const [modelValidating, setModelValidating] = useState(false);
  // When validation fails because a provider isn't authed, the main process
  // sets needsAuth + provider. We surface an inline API-key input so the user
  // can paste a key and retry without leaving the panel.
  const [authPromptProvider, setAuthPromptProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  // Collapsible settings groups. Model + Hotkeys default closed (rarely touched
  // once configured); Appearance + Behavior default open (quick tweaks).
  const [openSections, setOpenSections] = useState<{ model: boolean; hotkeys: boolean; appearance: boolean; behavior: boolean }>({
    model: false,
    hotkeys: false,
    appearance: true,
    behavior: true,
  });
  const toggleSection = useCallback((key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const [restoringSession, setRestoringSession] = useState(false);
  const [hotkeyPointer, setHotkeyPointer] = useState("Alt+Space");
  const [hotkeyArea, setHotkeyArea] = useState("CommandOrControl+Space");
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [launchOnStartup, setLaunchOnStartup] = useState(false);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [lang, setLang] = useState<Lang>("en");
  const t = useCallback((key: any) => translate(lang, key), [lang]);
  // Mirror `lang` to localStorage so ErrorBoundary — which renders outside
  // of React state when App crashes — can still pick the right direction
  // + strings for the crash screen.
  useEffect(() => {
    try { localStorage.setItem("mudrik-lang", lang); } catch {}
  }, [lang]);

  // Close settings dropdown on click outside. Mousedown (not click) so we
  // intercept before any focus shift that could swallow a click on the
  // dropdown itself. The settings gear and dropdown both opt out via their
  // class names — clicking either keeps the panel open.
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (target.closest(".settings-dropdown") || target.closest(".btn-settings")) return;
      setSettingsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [settingsOpen]);
  const [fontSize, setFontSize] = useState(14);
  const [restoreSessionOnActivate, setRestoreSessionOnActivate] = useState(true);
  const [autoAttachImage, setAutoAttachImage] = useState(false);
  const restoreSessionRef = useRef(true);
  const configLoadedRef = useRef(false);
  const chatInputRef = useRef<{ focus: () => void }>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Last prompt the user sent — powers the Retry button on error. Stored in a
  // ref (not state) because it never needs to trigger a re-render on its own.
  const lastPromptRef = useRef<string>("");

  useEffect(() => {
    if (!window.hoverbuddy) {
      console.log("[RENDERER] ERROR: window.hoverbuddy is undefined!");
      return;
    }

    window.hoverbuddy.onContext((data) => {
      console.log(`[RENDERER] onContext: element type="${data.element?.type}" name="${data.element?.name}"`);
      setContext(data);
      setActionResults([]);
      setCurrentResponse("");
      setStreaming(false);
      setError(null);
      setScreenshotAttached(!!data.hasScreenshot);
      setSettingsOpen(false);
      setMessages((prev) => {
        if (!configLoadedRef.current) {
          console.log("[RENDERER] Config not loaded yet — starting clean, will respect config on next activation");
          return [];
        }
        if (!restoreSessionRef.current) {
          console.log("[RENDERER] Restore disabled — starting clean");
          return [];
        }
        if (prev.length > 0) {
          console.log("[RENDERER] Restore enabled + active session — keeping messages");
          return prev;
        }
        console.log("[RENDERER] Fresh activation — restoring session");
        setRestoringSession(true);
        window.hoverbuddy.restoreSession().finally(() => setRestoringSession(false));
        return [];
      });
      setTimeout(() => chatInputRef.current?.focus(), 150);
    });

    window.hoverbuddy.onStreamToken((token) => {
      setCurrentResponse((prev) => prev + token);
    });

    window.hoverbuddy.onStreamDone(() => {
      console.log("[RENDERER] Stream done");
      setStreaming(false);
      setCurrentResponse((prev) => {
        if (prev.trim()) {
          setMessages((msgs) => [
            ...msgs,
            { role: "assistant", content: prev, toolUses: [] },
          ]);
        }
        return "";
      });
    });

    window.hoverbuddy.onStreamError((err) => {
      console.log(`[RENDERER] Stream error: ${err}`);
      setStreaming(false);
      setError(typeof err === "string" && err.length < MAX_INLINE_ERROR_LEN ? err : t("somethingWentWrong"));
    });

    window.hoverbuddy.onActionResult((result) => {
      console.log("[RENDERER] Action result:", result);
      setActionResults((prev) => [...prev, result as ActionResultEntry]);
    });

    window.hoverbuddy.onSessionReset((data) => {
      console.log(`[RENDERER] Session reset (hasImage=${data?.hasImage ?? false})`);
      setCurrentResponse("");
      setError(null);
      setActionResults([]);
      // Keep the screenshot badge when the server still has an image armed
      // for the next send (NEW_SESSION preserves pointer/area screenshots).
if (!data?.hasImage) {
        setScreenshotAttached(false);
      }
    });

    window.hoverbuddy.onScreenshotAttached((data) => {
      console.log(`[RENDERER] Screenshot attached: ${data.attached}, hasImage: ${data.hasImage}`);
      setScreenshotAttached(data.attached && data.hasImage);
    });

    window.hoverbuddy.onSessionHistory((historyMessages: { role: string; content: string }[]) => {
      console.log(`[RENDERER] Session history: ${historyMessages.length} messages`);
      setRestoringSession(false);
      if (historyMessages.length > 0) {
        const mapped = historyMessages.map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content,
          toolUses: [],
        }));
        setMessages((prev) => {
          if (prev.length === 0) return mapped;
          console.log(`[RENDERER] Merging ${mapped.length} history with ${prev.length} existing messages`);
          return [...mapped, ...prev];
        });
      }
    });

    // Focus the chat input only when the user doesn't already have focus
    // in another field (settings inputs, hotkey capture, model picker).
    // Without this guard, any window-focus event steals focus away from
    // whatever input the user just clicked into.
    const focusChatIfIdle = () => {
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)) {
        // User has something else focused. Respect it.
        return;
      }
      chatInputRef.current?.focus();
    };

    window.hoverbuddy.onFocusInput(() => {
      console.log("[RENDERER] Focus input requested");
      setTimeout(focusChatIfIdle, 50);
    });

    const handleWindowFocus = () => {
      setTimeout(focusChatIfIdle, 50);
    };
    window.addEventListener("focus", handleWindowFocus);

    window.hoverbuddy.getConfig().then((cfg: any) => {
      if (cfg?.actionsEnabled !== undefined) setActionsEnabled(cfg.actionsEnabled);
      if (cfg?.model) setCurrentModel(cfg.model);
      if (cfg?.recentModels) setRecentModels(cfg.recentModels);
      if (cfg?.hotkeyPointer) setHotkeyPointer(cfg.hotkeyPointer);
      if (cfg?.hotkeyArea) setHotkeyArea(cfg.hotkeyArea);
      if (cfg?.launchOnStartup !== undefined) setLaunchOnStartup(cfg.launchOnStartup);
      if (cfg?.theme) setTheme(cfg.theme);
      if (cfg?.lang) setLang(cfg.lang);
      if (typeof cfg?.fontSize === "number") setFontSize(cfg.fontSize);
      if (cfg?.restoreSessionOnActivate !== undefined) {
        setRestoreSessionOnActivate(cfg.restoreSessionOnActivate);
        restoreSessionRef.current = cfg.restoreSessionOnActivate;
      }
      if (cfg?.autoAttachImage !== undefined) setAutoAttachImage(cfg.autoAttachImage);
      configLoadedRef.current = true;
    });
  }, []);

  // Push fontSize into the CSS custom property so every size-driven rule
  // in global.css (body, .message-content, .chat-input textarea) reacts
  // live without a refresh.
  useEffect(() => {
    const clamped = Math.max(11, Math.min(20, Math.round(fontSize)));
    document.documentElement.style.setProperty("--font-size-base", `${clamped}px`);
  }, [fontSize]);

  const handleSetFontSize = useCallback((size: number) => {
    const clamped = Math.max(11, Math.min(20, Math.round(size)));
    setFontSize(clamped);
    window.hoverbuddy.setConfig({ fontSize: clamped });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentResponse, actionResults]);

  // Escape dismisses the panel. Captured at the window so it works regardless
  // of which element has focus. If the model is still streaming, the first
  // Escape stops the response; a second Escape hides the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (streaming) {
        window.hoverbuddy.stopResponse();
        e.preventDefault();
        return;
      }
      window.hoverbuddy.dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [streaming]);

  const handleSubmit = useCallback((prompt: string) => {
    console.log(`[RENDERER] Submit prompt: "${prompt}"`);
    lastPromptRef.current = prompt;
    setMessages((prev) => [...prev, { role: "user" as const, content: prompt, toolUses: [], screenshotAttached: screenshotAttached }]);
    setCurrentResponse("");
    setError(null);
    setStreaming(true);
    setActionResults([]);
    setScreenshotAttached(false);
    window.hoverbuddy.sendPrompt(prompt);
  }, [screenshotAttached]);

  const handleRetry = useCallback(() => {
    const prompt = lastPromptRef.current;
    if (!prompt || streaming) return;
    console.log(`[RENDERER] Retry: re-sending "${prompt}"`);
    setError(null);
    setCurrentResponse("");
    setActionResults([]);
    setStreaming(true);
    window.hoverbuddy.sendPrompt(prompt);
  }, [streaming]);

  const handleNewSession = useCallback(() => {
    console.log("[RENDERER] New session — preserving prompt/context/image");
    // Clear the conversation but leave screenshotAttached alone: the main
    // process replies via onSessionReset with { hasImage } which drives the
    // badge. The ChatInput keeps its own text state, so the typed prompt
    // survives unless/until the user presses Enter.
    window.hoverbuddy.newSession();
    setMessages([]);
    setCurrentResponse("");
    setError(null);
    setActionResults([]);
    setStreaming(false);
  }, []);

  const handleAttachScreenshot = useCallback(() => {
    console.log("[RENDERER] Attach screenshot clicked");
    window.hoverbuddy.attachScreenshot();
  }, []);

  const handleRemoveScreenshot = useCallback(() => {
    console.log("[RENDERER] Remove screenshot clicked");
    window.hoverbuddy.removeScreenshot();
    setScreenshotAttached(false);
    setMessages([]);
    setCurrentResponse("");
    setError(null);
    setActionResults([]);
    setStreaming(false);
  }, []);

  const handleStopResponse = useCallback(() => {
    console.log("[RENDERER] Stop response clicked");
    window.hoverbuddy.stopResponse();
    setStreaming(false);
    if (currentResponse.trim()) {
      setMessages((msgs) => [
        ...msgs,
        { role: "assistant", content: currentResponse + "\n\n*[Response stopped]*", toolUses: [] },
      ]);
      setCurrentResponse("");
    } else {
      setCurrentResponse("");
      setError(t("responseStopped"));
    }
  }, [currentResponse]);

  const handleDismiss = useCallback(() => {
    console.log("[RENDERER] Dismiss clicked");
    window.hoverbuddy.dismiss();
  }, []);

  const handleMinimize = useCallback(() => {
    console.log("[RENDERER] Minimize clicked — panel will auto-show when AI responds");
    window.hoverbuddy.minimize();
  }, []);

  // Dragging is handled natively by Chromium via the CSS `-webkit-app-region:
  // drag` declaration on `.app-header`. No JS / IPC involved — it's smooth
  // at any framerate, which the previous per-mousemove IPC approach was not.

  const handleRetryAction = useCallback((action: Action) => {
    console.log(`[RENDERER] Retrying action: type=${action.type}`);
    window.hoverbuddy.retryAction(action);
  }, []);

  const handleCopyChip = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedChipId(id);
    setTimeout(() => setCopiedChipId((cur) => (cur === id ? null : cur)), 1500);
  }, []);

  const handleToggleActionsEnabled = useCallback(() => {
    const newVal = !actionsEnabled;
    setActionsEnabled(newVal);
    window.hoverbuddy.setConfig({ actionsEnabled: newVal });
  }, [actionsEnabled]);

  const handleToggleLaunchOnStartup = useCallback(() => {
    const newVal = !launchOnStartup;
    setLaunchOnStartup(newVal);
    window.hoverbuddy.setConfig({ launchOnStartup: newVal });
  }, [launchOnStartup]);

  const handleToggleRestoreSession = useCallback(() => {
    const newVal = !restoreSessionOnActivate;
    setRestoreSessionOnActivate(newVal);
    restoreSessionRef.current = newVal;
    window.hoverbuddy.setConfig({ restoreSessionOnActivate: newVal });
  }, [restoreSessionOnActivate]);

  const handleToggleAutoAttachImage = useCallback(() => {
    const newVal = !autoAttachImage;
    setAutoAttachImage(newVal);
    window.hoverbuddy.setConfig({ autoAttachImage: newVal });
  }, [autoAttachImage]);

  const handleSetTheme = useCallback((newTheme: "system" | "light" | "dark") => {
    setTheme(newTheme);
    window.hoverbuddy.setConfig({ theme: newTheme });
  }, []);

  const handleSetLang = useCallback((newLang: Lang) => {
    setLang(newLang);
    window.hoverbuddy.setConfig({ lang: newLang });
  }, []);

  const commitHotkeys = useCallback(async (pointer: string, area: string) => {
    setHotkeyError(null);
    const cfg: any = await window.hoverbuddy.setConfig({ hotkeyPointer: pointer, hotkeyArea: area });
    if (cfg?.hotkeyPointer !== pointer || cfg?.hotkeyArea !== area) {
      setHotkeyError(t("hotkeyInUse"));
      if (cfg?.hotkeyPointer) setHotkeyPointer(cfg.hotkeyPointer);
      if (cfg?.hotkeyArea) setHotkeyArea(cfg.hotkeyArea);
    }
  }, []);

  const handleSwitchModel = useCallback((model: string) => {
    console.log(`[RENDERER] Switching model to: ${model}`);
    setCurrentModel(model);
    setCustomModelInput("");
    setModelValidationError(null);
    window.hoverbuddy.setConfig({ model }).then((cfg: any) => {
      if (cfg?.recentModels) setRecentModels(cfg.recentModels);
      if (cfg?.model) setCurrentModel(cfg.model);
    });
  }, []);

  const handleCustomModelSubmit = useCallback(async () => {
    const modelId = customModelInput.trim();
    if (!modelId) return;
    setModelValidating(true);
    setModelValidationError(null);
    setAuthPromptProvider(null);
    try {
      const result = await window.hoverbuddy.validateModel(modelId);
      if (result.valid && result.modelId) {
        handleSwitchModel(result.modelId);
        setApiKeyInput("");
      } else if (result.needsAuth && result.provider) {
        // Provider not authenticated — reveal the inline API-key input.
        setAuthPromptProvider(result.provider);
        setModelValidationError(result.error || `API key required for ${result.provider}`);
      } else {
        setModelValidationError(result.suggestions?.length
          ? `${result.error}. Did you mean: ${result.suggestions.join(", ")}?`
          : (result.error || t("modelNotFound")));
      }
    } catch (err: any) {
      setModelValidationError(err.message);
    }
    setModelValidating(false);
  }, [customModelInput, handleSwitchModel]);

  /**
   * Save the API key and switch to the requested model. OpenCode has no way
   * to pre-validate a key, so we trust the user's input — if the key is bad,
   * the first message send surfaces the real error from the provider. This
   * is simpler and honest: every "validate" would just be a second shot at
   * the same failing call.
   */
  const handleSaveApiKey = useCallback(async () => {
    const provider = authPromptProvider;
    const key = apiKeyInput.trim();
    const modelId = customModelInput.trim();
    if (!provider || !key) return;
    setApiKeySaving(true);
    setModelValidationError(null);
    try {
      const saved = await window.hoverbuddy.saveApiKey(provider, key);
      if (!saved.ok) {
        setModelValidationError(saved.error || t("failedToSaveKey"));
        setApiKeySaving(false);
        return;
      }
      // Save the key, then switch to whatever model is currently in the
      // input. Both the "type a new custom model" flow and the "✎ edit key"
      // flow populate customModelInput, so the behaviour is uniform: what
      // you see in the input is the model you'll be on after Save. If the
      // input matches the active model already, the switch is a no-op.
      if (modelId) {
        handleSwitchModel(modelId);
        setCustomModelInput("");
      }
      setAuthPromptProvider(null);
      setApiKeyInput("");
    } catch (err: any) {
      setModelValidationError(err.message);
    }
    setApiKeySaving(false);
  }, [authPromptProvider, apiKeyInput, customModelInput, handleSwitchModel]);

  /**
   * Remove a model from the recent list. Main-process handler picks the
   * next recent as the new active model if the removed entry was current.
   * Disabled (via filtered click handler) when only one model remains.
   */
  const handleRemoveModel = useCallback(async (modelToRemove: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (recentModels.length <= 1) return;
    const cfg = await window.hoverbuddy.removeModel(modelToRemove);
    if (cfg?.recentModels) setRecentModels(cfg.recentModels);
    if (cfg?.model) setCurrentModel(cfg.model);
  }, [recentModels.length]);

  /**
   * Open the API-key input for an existing model's provider without changing
   * the selected model. Used when a saved key turns out to be wrong and the
   * user needs to replace it — a common case since we can't pre-validate
   * keys against the provider. `handleSaveApiKey` detects this entry point
   * (empty customModelInput) and skips the model-switch step.
   */
  const handleEditProviderKey = useCallback((modelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const provider = modelId.split("/")[0];
    setAuthPromptProvider(provider);
    setApiKeyInput("");
    setModelValidationError(null);
    // Show which model the key edit targets so the user can confirm. On Save
    // we'll also switch to this model — same behaviour as typing the model
    // by hand and clicking Set, which keeps the flow predictable.
    setCustomModelInput(modelId);
    // Ensure Model section is open so the input is visible.
    setOpenSections((prev) => ({ ...prev, model: true }));
  }, []);

  // msgKey disambiguates chips across messages — e.g. two separate replies
  // can each have a <!--COPY:pwd--> chip without sharing highlight state.
  const renderSegments = useCallback((content: string, msgKey: string) => {
    const segments = parseMessageContent(content);
    return segments.map((seg, i) => {
      if (seg.type === "copy-chip") {
        const id = `${msgKey}::${i}`;
        const isCopied = copiedChipId === id;
        return (
          <span key={i} className={`copy-chip ${isCopied ? "copied" : ""}`} onClick={() => handleCopyChip(seg.content, id)}>
            {isCopied ? "✓ Copied!" : seg.content}
          </span>
        );
      }
      return <span key={i}>{seg.content}</span>;
    });
  }, [copiedChipId, handleCopyChip]);

  return (
    <div className="app" dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="app-header">
        <div className="app-brand">
          <OwlMascot
            state={streaming ? "thinking" : (currentResponse ? "replying" : "idle") as OwlState}
            size={44}
          />
          <span className="app-title">{t("appTitle")}</span>
        </div>
        <div className="header-actions">
          <button className="btn-settings" onClick={() => setSettingsOpen(!settingsOpen)} title={t("settings")}>&#9881;</button>
          <button className="btn-new-session" onClick={handleNewSession} title={`${t("startNewConversation")} (${t("newSession")})`}>+</button>
          <button className="btn-minimize" onClick={handleMinimize} title={t("minimize")}>&#8211;</button>
          <button className="btn-dismiss" onClick={handleDismiss} title={t("close")}>&times;</button>
        </div>
        {settingsOpen && (
          <div className="settings-dropdown">
            <div className={`settings-section ${openSections.model ? "open" : "closed"}`}>
              <button
                type="button"
                className="settings-section-header"
                onClick={() => toggleSection("model")}
                aria-expanded={openSections.model}
              >
                <span className="settings-label">{t("model")}</span>
                <span className="settings-section-meta">{currentModel.split("/").pop()}</span>
                <span className={`settings-chevron ${openSections.model ? "open" : ""}`}>▾</span>
              </button>
              {openSections.model && (
                <div className="settings-section-body">
                  {recentModels.map((m) => (
                    <div
                      key={m}
                      className={`model-option ${m === currentModel ? "model-active" : ""}`}
                      onClick={() => handleSwitchModel(m)}
                    >
                      <span className="model-name">{m.split("/").pop()}</span>
                      <span className="model-provider">{m.split("/")[0]}</span>
                      {m === currentModel && <span className="model-check">&#10003;</span>}
                      <button
                        type="button"
                        className="model-edit-key"
                        onClick={(e) => handleEditProviderKey(m, e)}
                        title={`Edit API key for ${m.split("/")[0]}`}
                        aria-label={`Edit key for ${m.split("/")[0]}`}
                      >
                        &#9998;
                      </button>
                      {recentModels.length > 1 && (
                        <button
                          type="button"
                          className="model-remove"
                          onClick={(e) => handleRemoveModel(m, e)}
                          title={`Remove ${m} from recent models`}
                          aria-label={`Remove ${m}`}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="settings-sublabel">Custom</div>
                  <div className="model-input-row">
                    <input
                      className="model-input"
                      type="text"
                      placeholder="provider/model-name"
                      value={customModelInput}
                      onChange={(e) => { setCustomModelInput(e.target.value); setModelValidationError(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") handleCustomModelSubmit(); }}
                      disabled={modelValidating}
                    />
                    <button className="model-input-btn" onClick={handleCustomModelSubmit} disabled={modelValidating || !customModelInput.trim()}>
                      {modelValidating ? "..." : t("set")}
                    </button>
                  </div>
                  {modelValidationError && <div className="model-error">{modelValidationError}</div>}
                  {authPromptProvider && (
                    <div className="api-key-prompt">
                      <div className="api-key-label">
                        {customModelInput.trim() ? t("apiKeyFor") : t("replaceKeyFor")}
                        <span className="api-key-provider">{authPromptProvider}</span>
                      </div>
                      <div className="model-input-row">
                        <input
                          className="model-input"
                          type="password"
                          placeholder={t("pasteKeyHint")}
                          value={apiKeyInput}
                          onChange={(e) => setApiKeyInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleSaveApiKey(); }}
                          disabled={apiKeySaving}
                          autoComplete="new-password"
                          spellCheck={false}
                          autoFocus
                        />
                        <button
                          className="model-input-btn"
                          onClick={handleSaveApiKey}
                          disabled={apiKeySaving || !apiKeyInput.trim()}
                        >
                          {apiKeySaving ? "..." : t("save")}
                        </button>
                        <button
                          className="model-input-btn model-input-btn-secondary"
                          onClick={() => { setAuthPromptProvider(null); setApiKeyInput(""); setModelValidationError(null); }}
                          disabled={apiKeySaving}
                          title={t("cancel")}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="api-key-hint">
                        {t("storedLocally")}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className={`settings-section ${openSections.hotkeys ? "open" : "closed"}`}>
              <button
                type="button"
                className="settings-section-header"
                onClick={() => toggleSection("hotkeys")}
                aria-expanded={openSections.hotkeys}
              >
                <span className="settings-label">{t("hotkeys")}</span>
                <span className="settings-section-meta">{hotkeyPointer} · {hotkeyArea.replace("CommandOrControl", "Ctrl")}</span>
                <span className={`settings-chevron ${openSections.hotkeys ? "open" : ""}`}>▾</span>
              </button>
              {openSections.hotkeys && (
                <div className="settings-section-body">
                  <label className="hotkey-row">
                    <span>Pointer</span>
                    <input
                      className="hotkey-input"
                      type="text"
                      value={hotkeyPointer}
                      onChange={(e) => setHotkeyPointer(e.target.value)}
                      onBlur={() => { if (hotkeyPointer) commitHotkeys(hotkeyPointer, hotkeyArea); }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      placeholder="Alt+Space"
                    />
                  </label>
                  <label className="hotkey-row">
                    <span>Area</span>
                    <input
                      className="hotkey-input"
                      type="text"
                      value={hotkeyArea}
                      onChange={(e) => setHotkeyArea(e.target.value)}
                      onBlur={() => { if (hotkeyArea) commitHotkeys(hotkeyPointer, hotkeyArea); }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      placeholder="CommandOrControl+Space"
                    />
                  </label>
                  {hotkeyError && <div className="model-error">{hotkeyError}</div>}
                </div>
              )}
            </div>
            <div className={`settings-section ${openSections.appearance ? "open" : "closed"}`}>
              <button
                type="button"
                className="settings-section-header"
                onClick={() => toggleSection("appearance")}
                aria-expanded={openSections.appearance}
              >
                <span className="settings-label">{t("appearance")}</span>
                <span className="settings-section-meta">{theme === "system" ? t("themeAuto") : theme === "light" ? t("themeLight") : t("themeDark")} · {fontSize}px</span>
                <span className={`settings-chevron ${openSections.appearance ? "open" : ""}`}>▾</span>
              </button>
              {openSections.appearance && (
                <div className="settings-section-body">
                  <div className="settings-sublabel">{t("theme")}</div>
                  <div className="theme-picker">
                    {(["system", "light", "dark"] as const).map((th) => (
                      <button
                        key={th}
                        className={`theme-option ${theme === th ? "theme-active" : ""}`}
                        onClick={() => handleSetTheme(th)}
                      >
                        {th === "system" ? t("themeAuto") : th === "light" ? t("themeLight") : t("themeDark")}
                      </button>
                    ))}
                  </div>
                  <div className="settings-sublabel">{t("language")}</div>
                  <div className="theme-picker">
                    {(["en", "ar"] as const).map((l) => (
                      <button
                        key={l}
                        className={`theme-option ${lang === l ? "theme-active" : ""}`}
                        onClick={() => handleSetLang(l)}
                      >
                        {l === "en" ? "EN" : "عربي"}
                      </button>
                    ))}
                  </div>
                  <div className="settings-sublabel">{t("fontSize")} <span className="settings-hint">{fontSize}px</span></div>
                  <input
                    className="font-size-slider"
                    type="range"
                    min={11}
                    max={20}
                    step={1}
                    value={fontSize}
                    onChange={(e) => handleSetFontSize(Number(e.target.value))}
                  />
                </div>
              )}
            </div>
            <div className={`settings-section ${openSections.behavior ? "open" : "closed"}`}>
              <button
                type="button"
                className="settings-section-header"
                onClick={() => toggleSection("behavior")}
                aria-expanded={openSections.behavior}
              >
                <span className="settings-label">{t("behavior")}</span>
                <span className={`settings-chevron ${openSections.behavior ? "open" : ""}`}>▾</span>
              </button>
              {openSections.behavior && (
                <div className="settings-section-body">
                  <label className="settings-toggle" title="When off, Mudrik runs in read-only mode: it can answer and copy content to the clipboard, but cannot click, type, paste, press keys, or move your cursor.">
                    <span>{t("allowDesktopActions")}</span>
                    <div className={`toggle-switch ${actionsEnabled ? "on" : ""}`} onClick={handleToggleActionsEnabled}>
                      <div className="toggle-knob" />
                    </div>
                  </label>
                  <label className="settings-toggle">
                    <span>{t("launchOnStartup")}</span>
                    <div className={`toggle-switch ${launchOnStartup ? "on" : ""}`} onClick={handleToggleLaunchOnStartup}>
                      <div className="toggle-knob" />
                    </div>
                  </label>
                  <label className="settings-toggle">
                    <span>{t("restoreChatOnPopup")}</span>
                    <div className={`toggle-switch ${restoreSessionOnActivate ? "on" : ""}`} onClick={handleToggleRestoreSession}>
                      <div className="toggle-knob" />
                    </div>
                  </label>
                  <label className="settings-toggle" title={t("autoAttachImageHint")}>
                    <span>{t("autoAttachImage")}</span>
                    <div className={`toggle-switch ${autoAttachImage ? "on" : ""}`} onClick={handleToggleAutoAttachImage}>
                      <div className="toggle-knob" />
                    </div>
                  </label>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
{/* Context preview hidden from end users — the LLM receives it
           internally but the UI doesn't need to show the raw element data. */}
      {!screenshotAttached ? (
        <button className="btn-attach-screenshot" onClick={handleAttachScreenshot} disabled={streaming}>
          {t("attachScreenshot")}
        </button>
      ) : (
        <div className="screenshot-badge">
          {t("screenshotAttached")}
          <button className="screenshot-badge-x" onClick={handleRemoveScreenshot} title={t("removeScreenshot")}>×</button>
        </div>
      )}
      <div className="messages">
        {restoringSession && (
          <div className="session-restoring">{t("loadingHistory")}</div>
        )}
        {!restoringSession && messages.length === 0 && !currentResponse && (
          <div className="new-conversation-hint">{t("startNewConversation")}</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}`}>
            <div className="message-role">{msg.role === "user" ? t("you") : t("assistant")}{msg.screenshotAttached ? " 📸" : ""}</div>
            <pre className="message-content">{renderSegments(msg.content, `m${i}`)}</pre>
            {streaming && !currentResponse && msg.role === "user" && i === messages.length - 1 && (
              <div className="loading-bar-container">
                <div className="loading-bar" />
                <div className="loading-text">{t("thinking")}</div>
                <button className="btn-stop" onClick={handleStopResponse}>{t("stop")}</button>
              </div>
            )}
          </div>
        ))}
        {currentResponse && (
          <div className="message message-assistant">
            <div className="message-role">{t("assistant")}</div>
            <pre className="message-content">{renderSegments(currentResponse, "streaming")}</pre>
            {streaming && <span className="cursor-blink">|</span>}
            {streaming && <button className="btn-stop-inline" onClick={handleStopResponse}>{t("stop")}</button>}
          </div>
        )}
        {actionResults.map((ar, i) => (
          <div key={`action-${i}`} className={`action-result ${ar.result.success ? "action-success" : "action-failed"}`}>
            <span className="action-result-label">{ar.action.type}{ar.action.selector ? `: ${ar.action.selector}` : ""}</span>
            <span className="action-result-status">{ar.result.success ? "OK" : "FAIL"}</span>
            {!ar.result.success && (
              <button className="btn-retry" onClick={() => handleRetryAction(ar.action)}>{t("retry")}</button>
            )}
            {ar.result.error && <div className="action-result-error">{ar.result.error}</div>}
            {ar.result.output && <div className="action-result-output">{ar.result.output.slice(0, 500)}</div>}
          </div>
        ))}
        {error && (
          <div className="response-error">
            <div className="response-error-msg">{error}</div>
            {lastPromptRef.current && (
              <button className="btn-retry-response" onClick={handleRetry} disabled={streaming}>
                {t("retry")}
              </button>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <ChatInput ref={chatInputRef} onSubmit={handleSubmit} disabled={streaming} lang={lang} />
    </div>
  );
}