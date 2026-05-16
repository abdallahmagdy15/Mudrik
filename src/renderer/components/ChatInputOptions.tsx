import * as React from "react";

interface Props {
  caption?: string;
  stepIndex?: number;
  estStepsLeft?: number;
  options: string[];
  onChoose: (option: string) => void;
}

function layoutFor(n: number): "row" | "list" | "grid" {
  if (n <= 2) return "row";
  if (n === 3) return "list";
  return "grid";
}

export const ChatInputOptions: React.FC<Props> = ({
  caption,
  stepIndex,
  estStepsLeft,
  options,
  onChoose,
}) => {
  const layout = layoutFor(options.length);
  const ordered = React.useMemo(() => {
    const cancelIdx = options.findIndex((o) => o === "Cancel");
    if (cancelIdx <= 0) return options;
    const rest = options.filter((o) => o !== "Cancel");
    return ["Cancel", ...rest];
  }, [options]);
  return (
    <div className={`chat-input-options ${layout}`}>
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
        {ordered.map((opt, i) => (
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
