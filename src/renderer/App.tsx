import React, { useState, useEffect, useCallback, useRef } from "react";
import { ContextPreview } from "./components/ContextPreview";
import { OwlMascot, OwlState } from "./components/OwlMascot";
import { ChatInput } from "./components/ChatInput";
import { ResponseView } from "./components/ResponseView";
import { ContextPayload, Action } from "@shared/types";

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
      onScreenshotAttached: (cb: (data: { attached: boolean; hasImage: boolean }) => void) => void;
      getConfig: () => Promise<any>;
      setConfig: (config: any) => Promise<any>;
      restoreSession: () => Promise<any>;
      onSessionHistory: (cb: (messages: any[]) => void) => void;
      stopResponse: () => void;
      validateModel: (model: string) => Promise<{ valid: boolean; modelId?: string; error?: string; suggestions?: string[] }>;
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
  const [copiedChip, setCopiedChip] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoClickGuide, setAutoClickGuide] = useState(false);
  const [currentModel, setCurrentModel] = useState("zai-coding-plan/glm-4.6v");
  const [recentModels, setRecentModels] = useState<string[]>(["zai-coding-plan/glm-4.6v"]);
  const [customModelInput, setCustomModelInput] = useState("");
  const [modelValidationError, setModelValidationError] = useState<string | null>(null);
  const [modelValidating, setModelValidating] = useState(false);
  const [restoringSession, setRestoringSession] = useState(false);
  const [hotkeyPointer, setHotkeyPointer] = useState("Alt+Space");
  const [hotkeyArea, setHotkeyArea] = useState("CommandOrControl+Space");
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [launchOnStartup, setLaunchOnStartup] = useState(false);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [fontSize, setFontSize] = useState(14);
  const [restoreSessionOnActivate, setRestoreSessionOnActivate] = useState(true);
  const restoreSessionRef = useRef(true);
  const chatInputRef = useRef<{ focus: () => void }>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      setScreenshotAttached(false);
      setSettingsOpen(false);
      setMessages((prev) => {
        if (prev.length > 0) {
          console.log("[RENDERER] Context changed within active session — keeping messages");
          return prev;
        }
        if (!restoreSessionRef.current) {
          console.log("[RENDERER] Fresh activation — restore disabled, starting clean");
          return [];
        }
        console.log("[RENDERER] Fresh activation — clearing messages, restoring session");
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
      setError(err);
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
      if (cfg?.autoClickGuide !== undefined) setAutoClickGuide(cfg.autoClickGuide);
      if (cfg?.model) setCurrentModel(cfg.model);
      if (cfg?.recentModels) setRecentModels(cfg.recentModels);
      if (cfg?.hotkeyPointer) setHotkeyPointer(cfg.hotkeyPointer);
      if (cfg?.hotkeyArea) setHotkeyArea(cfg.hotkeyArea);
      if (cfg?.launchOnStartup !== undefined) setLaunchOnStartup(cfg.launchOnStartup);
      if (cfg?.theme) setTheme(cfg.theme);
      if (typeof cfg?.fontSize === "number") setFontSize(cfg.fontSize);
      if (cfg?.restoreSessionOnActivate !== undefined) {
        setRestoreSessionOnActivate(cfg.restoreSessionOnActivate);
        restoreSessionRef.current = cfg.restoreSessionOnActivate;
      }
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
    setMessages((prev) => [...prev, { role: "user" as const, content: prompt, toolUses: [], screenshotAttached: screenshotAttached }]);
    setCurrentResponse("");
    setError(null);
    setStreaming(true);
    setActionResults([]);
    setScreenshotAttached(false);
    window.hoverbuddy.sendPrompt(prompt);
  }, [screenshotAttached]);

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
      setError("Response stopped by user");
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

  const handleCopyChip = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedChip(text);
    setTimeout(() => setCopiedChip(null), 1500);
  }, []);

  const handleToggleAutoClick = useCallback(() => {
    const newVal = !autoClickGuide;
    setAutoClickGuide(newVal);
    window.hoverbuddy.setConfig({ autoClickGuide: newVal });
  }, [autoClickGuide]);

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

  const handleSetTheme = useCallback((newTheme: "system" | "light" | "dark") => {
    setTheme(newTheme);
    window.hoverbuddy.setConfig({ theme: newTheme });
  }, []);

  const commitHotkeys = useCallback(async (pointer: string, area: string) => {
    setHotkeyError(null);
    const cfg: any = await window.hoverbuddy.setConfig({ hotkeyPointer: pointer, hotkeyArea: area });
    if (cfg?.hotkeyPointer !== pointer || cfg?.hotkeyArea !== area) {
      setHotkeyError("One or both hotkeys are already in use; reverted to the previous binding.");
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
    try {
      const result = await window.hoverbuddy.validateModel(modelId);
      if (result.valid && result.modelId) {
        handleSwitchModel(result.modelId);
      } else {
        setModelValidationError(result.suggestions?.length
          ? `${result.error}. Did you mean: ${result.suggestions.join(", ")}?`
          : (result.error || "Model not found"));
      }
    } catch (err: any) {
      setModelValidationError(err.message);
    }
    setModelValidating(false);
  }, [customModelInput, handleSwitchModel]);

  const renderSegments = useCallback((content: string) => {
    const segments = parseMessageContent(content);
    return segments.map((seg, i) => {
      if (seg.type === "copy-chip") {
        const isCopied = copiedChip === seg.content;
        return (
          <span key={i} className={`copy-chip ${isCopied ? "copied" : ""}`} onClick={() => handleCopyChip(seg.content)}>
            {isCopied ? "✓ Copied!" : seg.content}
          </span>
        );
      }
      return <span key={i}>{seg.content}</span>;
    });
  }, [copiedChip, handleCopyChip]);

  return (
    <div className="app">
      <div className="app-header">
        <div className="app-brand">
          <OwlMascot
            state={streaming ? "thinking" : (currentResponse ? "replying" : "idle") as OwlState}
            size={44}
          />
          <span className="app-title">HoverBuddy</span>
        </div>
        <div className="header-actions">
          <button className="btn-settings" onClick={() => setSettingsOpen(!settingsOpen)} title="Settings">&#9881;</button>
          <button className="btn-new-session" onClick={handleNewSession} title="New Session">+</button>
          <button className="btn-minimize" onClick={handleMinimize} title="Minimize (auto-show on response)">&#8211;</button>
          <button className="btn-dismiss" onClick={handleDismiss} title="Close">&times;</button>
        </div>
        {settingsOpen && (
          <div className="settings-dropdown">
            <div className="settings-section">
              <div className="settings-label">Model</div>
              {recentModels.map((m) => (
                <div
                  key={m}
                  className={`model-option ${m === currentModel ? "model-active" : ""}`}
                  onClick={() => handleSwitchModel(m)}
                >
                  <span className="model-name">{m.split("/").pop()}</span>
                  <span className="model-provider">{m.split("/")[0]}</span>
                  {m === currentModel && <span className="model-check">&#10003;</span>}
                </div>
              ))}
            </div>
            <div className="settings-section">
              <div className="settings-label">Custom Model</div>
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
                  {modelValidating ? "..." : "Set"}
                </button>
              </div>
              {modelValidationError && <div className="model-error">{modelValidationError}</div>}
            </div>
            <div className="settings-section">
              <div className="settings-label">Hotkeys</div>
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
            <div className="settings-section">
              <div className="settings-label">Theme</div>
              <div className="theme-picker">
                {(["system", "light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    className={`theme-option ${theme === t ? "theme-active" : ""}`}
                    onClick={() => handleSetTheme(t)}
                  >
                    {t === "system" ? "Auto" : t === "light" ? "Light" : "Dark"}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-label">
                Font size <span className="settings-hint">{fontSize}px</span>
              </div>
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
            <label className="settings-toggle">
              <span>Auto-click guide</span>
              <div className={`toggle-switch ${autoClickGuide ? "on" : ""}`} onClick={handleToggleAutoClick}>
                <div className="toggle-knob" />
              </div>
            </label>
            <label className="settings-toggle">
              <span>Launch on startup</span>
              <div className={`toggle-switch ${launchOnStartup ? "on" : ""}`} onClick={handleToggleLaunchOnStartup}>
                <div className="toggle-knob" />
              </div>
            </label>
            <label className="settings-toggle">
              <span>Restore chat on popup</span>
              <div className={`toggle-switch ${restoreSessionOnActivate ? "on" : ""}`} onClick={handleToggleRestoreSession}>
                <div className="toggle-knob" />
              </div>
            </label>
          </div>
        )}
      </div>
      {/* Context preview only renders if there's an actual element. The cold
          "Show Panel" fallback uses a placeholder context with empty fields,
          which would otherwise render an empty grey bar. */}
      {context && (context.element?.name || context.element?.value || (context.surrounding && context.surrounding.length > 0)) && (
        <ContextPreview context={context} />
      )}
      {/* Screenshot attachment is always available — even from a cold panel
          opened via the tray, the user can attach a screenshot and chat. */}
      {!screenshotAttached && (
        <button className="btn-attach-screenshot" onClick={handleAttachScreenshot} disabled={streaming}>
          📸 Attach Screenshot
        </button>
      )}
      {screenshotAttached && (
        <div className="screenshot-badge">📸 Screenshot attached</div>
      )}
      <div className="messages">
        {restoringSession && (
          <div className="session-restoring">Loading chat history...</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}`}>
            <div className="message-role">{msg.role === "user" ? "You" : "Assistant"}{msg.screenshotAttached ? " 📸" : ""}</div>
            <pre className="message-content">{renderSegments(msg.content)}</pre>
            {streaming && !currentResponse && msg.role === "user" && i === messages.length - 1 && (
              <div className="loading-bar-container">
                <div className="loading-bar" />
                <div className="loading-text">Thinking...</div>
                <button className="btn-stop" onClick={handleStopResponse}>Stop</button>
              </div>
            )}
          </div>
        ))}
        {currentResponse && (
          <div className="message message-assistant">
            <div className="message-role">Assistant</div>
            <pre className="message-content">{renderSegments(currentResponse)}</pre>
            {streaming && <span className="cursor-blink">|</span>}
            {streaming && <button className="btn-stop-inline" onClick={handleStopResponse}>Stop</button>}
          </div>
        )}
        {actionResults.map((ar, i) => (
          <div key={`action-${i}`} className={`action-result ${ar.result.success ? "action-success" : "action-failed"}`}>
            <span className="action-result-label">{ar.action.type}{ar.action.selector ? `: ${ar.action.selector}` : ""}</span>
            <span className="action-result-status">{ar.result.success ? "OK" : "FAIL"}</span>
            {!ar.result.success && (
              <button className="btn-retry" onClick={() => handleRetryAction(ar.action)}>Retry</button>
            )}
            {ar.result.error && <div className="action-result-error">{ar.result.error}</div>}
            {ar.result.output && <div className="action-result-output">{ar.result.output.slice(0, 500)}</div>}
          </div>
        ))}
        {error && <div className="response-error">{error}</div>}
        <div ref={messagesEndRef} />
      </div>
      <ChatInput ref={chatInputRef} onSubmit={handleSubmit} disabled={streaming} />
    </div>
  );
}