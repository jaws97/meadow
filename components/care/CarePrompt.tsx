"use client";
// A gentle question before a care action that might not help: the can on soil that is still damp, the can when rain is
// falling (or heavy rain is due), plant food on a bed that is already rich. It opens in place, just above the care
// buttons, with the kinder choice first and lit; focus moves to that choice, Escape (or the close button) puts the
// question away, and focus goes back to the button that asked. Not a modal: the garden stays alive behind it.
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { CloseIcon } from "@/components/care/icons";

export interface PromptAction {
  label: string;
  primary?: boolean;
  run: () => void;
}

export interface PromptSpec {
  /** a new id for each question, so a second question takes the focus again */
  id: number;
  title: string;
  body?: string;
  actions: PromptAction[];
}

export function CarePrompt({ spec, onClose }: { spec: PromptSpec; onClose: () => void }) {
  const titleId = useId();
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus({ preventScroll: true });
  }, [spec.id]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="care-prompt" role="group" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <div className="care-prompt-head">
        <p id={titleId} className="care-prompt-title">
          {spec.title}
        </p>
        <button type="button" className="care-icon-btn" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      {spec.body && <p className="care-prompt-body">{spec.body}</p>}
      <div className="care-prompt-actions">
        {spec.actions.map((a, i) => (
          <button
            key={a.label}
            ref={i === 0 ? first : undefined}
            type="button"
            className={a.primary ? "care-btn care-btn-primary" : "care-btn"}
            onClick={() => {
              onClose();
              a.run();
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
