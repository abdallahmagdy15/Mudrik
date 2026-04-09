import React from "react";
import { ContextPayload, UIElement } from "@shared/types";

interface Props {
  context: ContextPayload;
}

export function ContextPreview({ context }: Props) {
  const { element, surrounding } = context;

  return (
    <div className="context-preview">
      <div className="context-element">
        <span className="context-type">{element.type}</span>
        {element.name && (
          <span className="context-name">{element.name}</span>
        )}
        {element.value && (
          <pre className="context-value">{element.value}</pre>
        )}
      </div>
      {surrounding.length > 0 && (
        <details className="context-surrounding">
          <summary>
            {surrounding.length} nearby element
            {surrounding.length !== 1 ? "s" : ""}
          </summary>
          {surrounding.map((el: UIElement, i: number) => (
            <div key={i} className="context-sibling">
              <span className="context-type">{el.type}</span>
              {el.name && <span className="context-name">{el.name}</span>}
              {el.value && (
                <pre className="context-value">{el.value}</pre>
              )}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}