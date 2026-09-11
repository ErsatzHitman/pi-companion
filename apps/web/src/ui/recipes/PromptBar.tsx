import { useId } from "react";
import type { KeyboardEvent, ReactNode } from "react";

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
  /**
   * Optional leading control rendered as the row's first affordance — the
   * composer's attach `+`. Kept a slot rather than a hard-coded button so
   * this recipe stays platform-neutral; see `features/composer/Composer.tsx`
   * for the real caller.
   */
  attachControl?: ReactNode;
  /**
   * Optional control rendered immediately right of the attach control —
   * the composer's context ring. Same slot reasoning as `attachControl`.
   */
  contextControl?: ReactNode;
  /**
   * Called when Escape is pressed in the textarea. The reference binds
   * Escape to "interrupt the running turn"; the composer's own caller
   * decides what that means (and is a no-op when it cannot interrupt).
   */
  onEscape?: () => void;
  /**
   * Optional visible footer content, rendered left of the keyboard
   * contract. The composer uses it for the "steering / starts a new turn"
   * sentence the mockup's `.composer-foot` carries.
   */
  footer?: ReactNode;
}

/**
 * PromptBar recipe (plan.md §10.4): the message composer, laid out as the
 * mockup's `.prompt` row — `[ attach + | context ring | textarea | send ]`
 * on a single raised surface — with the mockup's visible `.composer-foot`
 * line beneath it (a state sentence, the queued count, and the keyboard
 * contract). Clean-specification recipe (plan.md §10.1).
 *
 * DOM order inside `.pc-prompt-bar__row` is ring → textarea → send →
 * attach, and `.pc-prompt-bar__attach` is moved visually first with
 * `order: -1`. That is deliberate, not incidental: the keyboard-navigation
 * e2e contract (`apps/web/e2e/keyboard-navigation.spec.ts`) pins Tab from
 * the textarea reaching Send, then Attach files, then the composer's
 * remaining controls, so the attach button has to stay after the send
 * button in document order while the mockup draws it first. Tab order is
 * therefore unchanged from before this restructure.
 *
 * Accessibility (plan.md §10.5): a labelled `<textarea>` (not just a
 * placeholder — placeholders are not a substitute for a label), Enter to
 * send / Shift+Enter for a newline / Escape to interrupt (documented in a
 * visible footer line and associated with the input through
 * `aria-describedby`), and the queued-message count is both visible text
 * and an `aria-live="polite"` region so screen-reader users hear it update.
 * The send control is icon-only, so its accessible name comes from
 * `aria-label="Send"` plus a native `title`.
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
  attachControl,
  contextControl,
  onEscape,
  footer,
}: PromptBarProps) {
  const inputId = useId();
  const keysId = useId();

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      onEscape?.();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <div className="pc-prompt-bar" data-testid={testId}>
      <div className="pc-prompt-bar__row">
        <label className="pc-visually-hidden" htmlFor={inputId}>
          {label}
        </label>
        {contextControl}
        <textarea
          id={inputId}
          className="pc-prompt-bar__input"
          placeholder={placeholder}
          value={value}
          aria-describedby={keysId}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          data-testid={testId ? `${testId}-input` : undefined}
        />
        <button
          type="button"
          className="pc-prompt-bar__send"
          aria-label="Send"
          title="Send"
          disabled={!canSend}
          onClick={onSend}
          data-testid={testId ? `${testId}-send` : undefined}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h13M12 5l7 7-7 7" />
          </svg>
        </button>
        {attachControl}
      </div>
      <div className="pc-prompt-bar__foot">
        {footer ? <span className="pc-prompt-bar__foot-state">{footer}</span> : null}
        <span className="pc-prompt-bar__foot-grow" />
        <span className="pc-prompt-bar__queued" aria-live="polite">
          {queuedCount > 0 ? `${queuedCount} queued` : ""}
        </span>
        <span id={keysId} className="pc-prompt-bar__keys">
          <span aria-hidden="true">⏎ send · ⇧⏎ newline · Esc interrupt</span>
          <span className="pc-visually-hidden">
            Press Enter to send, Shift+Enter for a new line, Escape to interrupt the running turn.
          </span>
        </span>
      </div>
    </div>
  );
}

export default PromptBar;
