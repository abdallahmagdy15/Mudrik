import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { t as translate, Lang } from "@shared/i18n";

interface Props {
  onSubmit: (prompt: string) => void;
  disabled: boolean;
  lang: Lang;
}

export const ChatInput = forwardRef<{ focus: () => void }, Props>(({ onSubmit, disabled, lang }, ref) => {
  const tp = (key: any) => translate(lang, key);
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

  const submit = () => {
    if (text.trim() && !disabled) {
      onSubmit(text.trim());
      setText("");
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const canSend = text.trim().length > 0 && !disabled;

  return (
    <div className="chat-input">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tp("inputPlaceholder")}
        disabled={disabled}
        rows={2}
      />
      <button
        type="button"
        className="btn-send"
        onClick={submit}
        disabled={!canSend}
        title={tp("send")}
        aria-label={tp("send")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
});
