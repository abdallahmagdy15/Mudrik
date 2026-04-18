import React, { useState, useEffect, useCallback, useRef } from "react";
import { ContextPreview } from "./components/ContextPreview";
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
      onSessionReset: (cb: () => void) => void;
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
  const [restoringSession, setRestoringSession] = useState(false);
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

    window.hoverbuddy.onSessionReset(() => {
      console.log("[RENDERER] Session reset");
      setCurrentResponse("");
      setError(null);
      setActionResults([]);
      setScreenshotAttached(false);
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

    window.hoverbuddy.onFocusInput(() => {
      console.log("[RENDERER] Focus input requested");
      setTimeout(() => chatInputRef.current?.focus(), 50);
    });

    const handleWindowFocus = () => {
      setTimeout(() => chatInputRef.current?.focus(), 50);
    };
    window.addEventListener("focus", handleWindowFocus);

    window.hoverbuddy.getConfig().then((cfg: any) => {
      if (cfg?.autoClickGuide !== undefined) setAutoClickGuide(cfg.autoClickGuide);
    });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentResponse, actionResults]);

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
    console.log("[RENDERER] New session");
    window.hoverbuddy.newSession();
    setMessages([]);
    setCurrentResponse("");
    setError(null);
    setActionResults([]);
    setStreaming(false);
    setScreenshotAttached(false);
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

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    let lastX = e.screenX;
    let lastY = e.screenY;

    const handleMouseMove = (moveE: MouseEvent) => {
      const deltaX = moveE.screenX - lastX;
      const deltaY = moveE.screenY - lastY;
      lastX = moveE.screenX;
      lastY = moveE.screenY;
      window.hoverbuddy.windowMove(deltaX, deltaY);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      setTimeout(() => chatInputRef.current?.focus(), 50);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

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
      <div className="app-header" onMouseDown={handleMouseDown}>
        <span className="app-title">HoverBuddy</span>
        <div className="header-actions">
          <button className="btn-settings" onClick={() => setSettingsOpen(!settingsOpen)} title="Settings">&#9881;</button>
          <button className="btn-new-session" onClick={handleNewSession} title="New Session">+</button>
          <button className="btn-minimize" onClick={handleMinimize} title="Minimize (auto-show on response)">&#8211;</button>
          <button className="btn-dismiss" onClick={handleDismiss} title="Close">&times;</button>
        </div>
        {settingsOpen && (
          <div className="settings-dropdown">
            <label className="settings-toggle">
              <span>Auto-click guide</span>
              <div className={`toggle-switch ${autoClickGuide ? "on" : ""}`} onClick={handleToggleAutoClick}>
                <div className="toggle-knob" />
              </div>
            </label>
          </div>
        )}
      </div>
      {context && <ContextPreview context={context} />}
      {context && !screenshotAttached && (
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