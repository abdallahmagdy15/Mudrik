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

function formatMessageContent(content: string): string {
  return content
    .replace(/<!--ACTION:[\s\S]*?-->/g, "")
    .replace(/<skill_content[\s\S]*?<\/skill_content>/gi, "")
    .replace(/<skill[\s\S]*?<\/skill>/gi, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/\[skill\][\s\S]*?\[\/skill\]/gi, "")
    .trim();
}

export function App() {
  const [context, setContext] = useState<ContextPayload | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentResponse, setCurrentResponse] = useState("");
  const [actionResults, setActionResults] = useState<ActionResultEntry[]>([]);
  const [screenshotAttached, setScreenshotAttached] = useState(false);
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
      if (data.element?.type !== "area") {
        setMessages([]);
      }
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

    window.hoverbuddy.onFocusInput(() => {
      console.log("[RENDERER] Focus input requested");
      setTimeout(() => chatInputRef.current?.focus(), 50);
    });

    const handleWindowFocus = () => {
      setTimeout(() => chatInputRef.current?.focus(), 50);
    };
    window.addEventListener("focus", handleWindowFocus);
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

  return (
    <div className="app">
      <div className="app-header" onMouseDown={handleMouseDown}>
        <span className="app-title">HoverBuddy</span>
        <div className="header-actions">
          <button className="btn-new-session" onClick={handleNewSession} title="New Session">+</button>
          <button className="btn-minimize" onClick={handleMinimize} title="Minimize (auto-show on response)">&#8211;</button>
          <button className="btn-dismiss" onClick={handleDismiss} title="Close">&times;</button>
        </div>
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
        {messages.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}`}>
            <div className="message-role">{msg.role === "user" ? "You" : "Assistant"}{msg.screenshotAttached ? " 📸" : ""}</div>
            <pre className="message-content">{formatMessageContent(msg.content)}</pre>
            {streaming && !currentResponse && msg.role === "user" && i === messages.length - 1 && (
              <div className="loading-bar-container">
                <div className="loading-bar" />
                <div className="loading-text">Thinking...</div>
              </div>
            )}
          </div>
        ))}
        {currentResponse && (
          <div className="message message-assistant">
            <div className="message-role">Assistant</div>
            <pre className="message-content">{formatMessageContent(currentResponse)}</pre>
            {streaming && <span className="cursor-blink">|</span>}
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