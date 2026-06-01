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
    // System options (Cancel, Something else) always go at the end
    const systemOpts = ["Cancel", "Something else"];
    const aiOpts = options.filter((o) => !systemOpts.includes(o));
    const presentSystem = systemOpts.filter((o) => options.includes(o));
    return [...aiOpts, ...presentSystem];
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
        {ordered.map((opt, i) => {
          const isCancel = opt === "Cancel";
          const isSomethingElse = opt === "Something else";
          return (
            <button
              key={i}
              className={`option-btn ${isCancel ? "cancel" : isSomethingElse ? "secondary" : "ok"}`}
              onClick={() => onChoose(opt)}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ChatInputOptions;
