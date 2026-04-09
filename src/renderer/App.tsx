import React, { useState, useEffect, useCallback } from "react";
import { ContextPreview } from "./components/ContextPreview";
import { ChatInput } from "./components/ChatInput";
import { ResponseView } from "./components/ResponseView";
import { ActionBar } from "./components/ActionBar";
import { ContextPayload, Action } from "@shared/types";

declare global {
  interface Window {
    hoverbuddy: {
      onContext: (cb: (data: ContextPayload) => void) => void;
      sendPrompt: (prompt: string) => void;
      onStreamToken: (cb: (token: string) => void) => void;
      onStreamDone: (cb: () => void) => void;
      onStreamError: (cb: (err: string) => void) => void;
      executeAction: (action: Action) => void;
      onActionResult: (cb: (result: any) => void) => void;
      dismiss: () => void;
      getConfig: () => Promise<any>;
      setConfig: (config: any) => Promise<any>;
    };
  }
}

export function App() {
  const [context, setContext] = useState<ContextPayload | null>(null);
  const [response, setResponse] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Action[]>([]);

  useEffect(() => {
    window.hoverbuddy.onContext((data) => {
      setContext(data);
      setResponse("");
      setError(null);
      setPendingActions([]);
    });

    window.hoverbuddy.onStreamToken((token) => {
      setStreaming(true);
      setResponse((prev) => prev + token);
    });

    window.hoverbuddy.onStreamDone(() => {
      setStreaming(false);
    });

    window.hoverbuddy.onStreamError((err) => {
      setStreaming(false);
      setError(err);
    });

    window.hoverbuddy.onActionResult((result) => {
      if (result.pendingActions) {
        setPendingActions(result.pendingActions);
      }
    });
  }, []);

  const handleSubmit = useCallback((prompt: string) => {
    setResponse("");
    setError(null);
    setStreaming(true);
    window.hoverbuddy.sendPrompt(prompt);
  }, []);

  const handleExecuteAction = useCallback((action: Action) => {
    window.hoverbuddy.executeAction(action);
  }, []);

  const handleDismiss = useCallback(() => {
    window.hoverbuddy.dismiss();
  }, []);

  return (
    <div className="app">
      <div className="app-header">
        <span className="app-title">HoverBuddy</span>
        <button className="btn-dismiss" onClick={handleDismiss}>
          &times;
        </button>
      </div>
      {context && <ContextPreview context={context} />}
      <ResponseView
        response={response}
        streaming={streaming}
        error={error}
      />
      {pendingActions.length > 0 && (
        <ActionBar
          actions={pendingActions}
          onExecute={handleExecuteAction}
        />
      )}
      <ChatInput onSubmit={handleSubmit} disabled={streaming} />
    </div>
  );
}