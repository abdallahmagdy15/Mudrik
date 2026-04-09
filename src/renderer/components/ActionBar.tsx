import React from "react";
import { Action } from "@shared/types";

interface Props {
  actions: Action[];
  onExecute: (action: Action) => void;
}

export function ActionBar({ actions, onExecute }: Props) {
  const labels: Record<string, string> = {
    type_text: "Type",
    paste_text: "Paste",
    click_element: "Click",
    copy_to_clipboard: "Copy",
    press_keys: "Press Keys",
  };

  return (
    <div className="action-bar">
      <span className="action-label">Pending actions:</span>
      {actions.map((action, i) => (
        <button
          key={i}
          className="action-btn"
          onClick={() => onExecute(action)}
        >
          {labels[action.type] || action.type}
          {action.text
            ? `: "${action.text.slice(0, 30)}${action.text.length > 30 ? "..." : ""}"`
            : ""}
        </button>
      ))}
    </div>
  );
}