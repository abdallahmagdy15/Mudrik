import * as React from "react";

interface Props {
  caption?: string;
  stepIndex?: number;
  estStepsLeft?: number;
  options: string[];
  onChoose: (option: string) => void;
}

export const ChatInputOptions: React.FC<Props> = ({
  caption,
  stepIndex,
  estStepsLeft,
  options,
  onChoose,
}) => {
  const isRow = options.length === 2;
  return (
    <div className={`chat-input-options ${isRow ? "row" : "list"}`}>
      {caption && (
        <div className="step-caption">
          {typeof stepIndex === "number" && (
            <span className="step-marker">
              Step {stepIndex} · ~{estStepsLeft ?? 0} left
            </span>
          )}
          <span className="caption-text">{caption}</span>
        </div>
      )}
      <div className="options-bar">
        {options.map((opt, i) => (
          <button
            key={i}
            className={`option-btn ${opt === "Cancel" ? "cancel" : "primary"}`}
            onClick={() => onChoose(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ChatInputOptions;
