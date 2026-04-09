import React, { useEffect, useRef } from "react";

interface Props {
  response: string;
  streaming: boolean;
  error: string | null;
}

export function ResponseView({ response, streaming, error }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [response]);

  if (error) {
    return <div className="response-error">{error}</div>;
  }

  if (!response && !streaming) {
    return (
      <div className="response-empty">
        Point at something, Ctrl+Shift+Space, then ask a question.
      </div>
    );
  }

  const displayText = response
    .replace(/<!--ACTION:\{[^}]+\}-->/g, "")
    .trim();

  return (
    <div className="response-view" ref={containerRef}>
      <pre className="response-text">{displayText}</pre>
      {streaming && <span className="cursor-blink">|</span>}
    </div>
  );
}