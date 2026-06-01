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
        <i className="fa-solid fa-arrow-up" style={{ fontSize: 14 }}></i>
      </button>
    </div>
  );
});
