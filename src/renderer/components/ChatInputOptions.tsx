import * as React from "react";

interface Props {
  caption?: string;
  stepIndex?: number;
  estStepsLeft?: number;
  options: string[];
  onChoose: (option: string) => void;
}

// Layout per option count:
//   2  → row (Cancel / Confirm sit side-by-side, equal flex)
//   3  → list (single column, vertical poll)
//   4+ → grid (2 columns; Cancel always spans the full row at top)
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
  // Render Cancel first so it lands on the leading edge in row mode and on
  // top of the grid (where it spans both columns via CSS grid-column).
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
