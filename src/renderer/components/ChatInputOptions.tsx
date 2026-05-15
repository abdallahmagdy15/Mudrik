import * as React from "react";

interface Props {
  caption?: string;
  stepIndex?: number;
  estStepsLeft?: number;
  options: string[];
  onChoose: (option: string) => void;
  onCustomText?: (text: string) => void;
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
  onCustomText,
}) => {
  const layout = layoutFor(options.length);
  const [showCustomInput, setShowCustomInput] = React.useState(false);
  const [customText, setCustomText] = React.useState("");
  // Render Cancel first so it lands on the leading edge in row mode and on
  // top of the grid (where it spans both columns via CSS grid-column).
  const ordered = React.useMemo(() => {
    const cancelIdx = options.findIndex((o) => o === "Cancel");
    if (cancelIdx <= 0) return options;
    const rest = options.filter((o) => o !== "Cancel");
    return ["Cancel", ...rest];
  }, [options]);

  const handleCustomSubmit = () => {
    const trimmed = customText.trim();
    if (trimmed && onCustomText) {
      onCustomText(trimmed);
      setCustomText("");
      setShowCustomInput(false);
    }
  };

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
            onMouseDown={(e) => {
              if (opt !== "Cancel") {
                // Pre-hide panel on mousedown so the target app's open
                // popup/menu/dropdown is not dismissed by the click's
                // foreground transfer. Cancel and "Something else…" don't
                // trigger recapture — no need to pre-hide.
                e.preventDefault();
                window.hoverbuddy?.hidePanel?.();
                setTimeout(() => onChoose(opt), 60);
              }
            }}
            onClick={() => {
              // Cancel fires on regular click (no pre-hide needed — it just
              // tears down the guide locally with no AI round-trip).
              if (opt === "Cancel") onChoose(opt);
            }}
          >
            {opt}
          </button>
        ))}
        {onCustomText && (
          <button
            className="option-btn custom-else"
            onClick={() => setShowCustomInput(!showCustomInput)}
          >
            Something else…
          </button>
        )}
      </div>
      {showCustomInput && onCustomText && (
        <div className="custom-input-row">
          <textarea
            className="custom-input"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleCustomSubmit();
              }
            }}
            placeholder="Tell the AI what happened…"
            rows={2}
            autoFocus
          />
          <button
            className="btn-send-custom"
            onClick={handleCustomSubmit}
            disabled={!customText.trim()}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
};

export default ChatInputOptions;
