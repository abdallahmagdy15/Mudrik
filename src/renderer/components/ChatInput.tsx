import React, { useState } from "react";

interface Props {
  onSubmit: (prompt: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSubmit, disabled }: Props) {
  const [text, setText] = useState("");

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim() && !disabled) {
        onSubmit(text.trim());
        setText("");
      }
    }
  };

  return (
    <div className="chat-input">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask something about this element..."
        disabled={disabled}
        rows={2}
      />
    </div>
  );
}