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

const rlog = (msg: string) => {
  console.log(`[RENDERER] ${msg}`);
};

export function App() {
  const [context, setContext] = useState<ContextPayload | null>(null);
  const [response, setResponse] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Action[]>([]);

  rlog("App component rendering");

  useEffect(() => {
    rlog("App useEffect - registering IPC listeners");

    if (!window.hoverbuddy) {
      rlog("ERROR: window.hoverbuddy is undefined! Preload script may not have loaded.");
      return;
    }

    rlog("window.hoverbuddy API available");

    window.hoverbuddy.onContext((data) => {
      rlog(`onContext received: element type="${data.element?.type}" name="${data.element?.name}"`);
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
      rlog("Stream done");
      setStreaming(false);
    });

    window.hoverbuddy.onStreamError((err) => {
      rlog(`Stream error: ${err}`);
      setStreaming(false);
      setError(err);
    });

    window.hoverbuddy.onActionResult((result) => {
      rlog(`Action result: ${JSON.stringify(result).slice(0, 100)}`);
      if (result.pendingActions) {
        rlog(`Pending actions: ${result.pendingActions.length}`);
        setPendingActions(result.pendingActions);
      }
    });

    rlog("All IPC listeners registered");
  }, []);

  const handleSubmit = useCallback((prompt: string) => {
    rlog(`Submit prompt: "${prompt}"`);
    setResponse("");
    setError(null);
    setStreaming(true);
    window.hoverbuddy.sendPrompt(prompt);
  }, []);

  const handleExecuteAction = useCallback((action: Action) => {
    rlog(`Execute action: type=${action.type}`);
    window.hoverbuddy.executeAction(action);
  }, []);

  const handleDismiss = useCallback(() => {
    rlog("Dismiss clicked");
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