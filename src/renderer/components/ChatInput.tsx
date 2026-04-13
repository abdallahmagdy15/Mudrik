import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";

interface Props {
  onSubmit: (prompt: string) => void;
  disabled: boolean;
}

export const ChatInput = forwardRef<{ focus: () => void }, Props>(({ onSubmit, disabled }, ref) => {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaRef.current?.focus();
    }
  }));

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim() && !disabled) {
        onSubmit(text.trim());
        setText("");
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    }
  };

  return (
    <div className="chat-input">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask something about this element..."
        disabled={disabled}
        rows={2}
      />
    </div>
  );
});