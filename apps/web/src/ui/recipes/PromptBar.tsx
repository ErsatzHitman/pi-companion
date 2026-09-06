import { useId } from "react";
import type { KeyboardEvent } from "react";

import { Button } from "../primitives/Button.js";
import "../primitives/primitives.css";
import "./recipes.css";

export interface PromptBarProps {
  label: string;
  placeholder: string;
  value: string;
  canSend: boolean;
  queuedCount: number;
  onValueChange: (value: string) => void;
  onSend: () => void;
  testId?: string;
}

/**
 * PromptBar recipe (plan.md §10.4): the message composer, with a queued
 * message counter for messages sent while Pi is still working. Clean-
 * specification recipe (plan.md §10.1).
 *
 * Accessibility (plan.md §10.5): a labelled `<textarea>` (not just a
 * placeholder — placeholders are not a substitute for a label), Enter to
 * send / Shift+Enter for a newline (documented in a visually-hidden
 * hint), and the queued-message count is both visible text and an
 * `aria-live="polite"` region so screen-reader users hear it update.
 */
export function PromptBar({
  label,
  placeholder,
  value,
  canSend,
  queuedCount,
  onValueChange,
  onSend,
  testId,
}: PromptBarProps) {
  const inputId = useId();
  const hintId = useId();

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <div className="pc-prompt-bar" data-testid={testId}>
      <label className="pc-visually-hidden" htmlFor={inputId}>
        {label}
      </label>
      <textarea
        id={inputId}
        className="pc-prompt-bar__input"
        placeholder={placeholder}
        value={value}
        aria-describedby={hintId}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
        data-testid={testId ? `${testId}-input` : undefined}
      />
      <span id={hintId} className="pc-visually-hidden">
        Press Enter to send, Shift+Enter for a new line.
      </span>
      <div className="pc-prompt-bar__row">
        <span className="pc-prompt-bar__queued" aria-live="polite">
          {queuedCount > 0 ? `${queuedCount} queued` : ""}
        </span>
        <Button kind="primary" disabled={!canSend} onClick={onSend}>
          Send
        </Button>
      </div>
    </div>
  );
}

export default PromptBar;
