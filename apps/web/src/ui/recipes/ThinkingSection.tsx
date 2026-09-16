import { useId, useState } from "react";

import "./recipes.css";

export interface ThinkingSectionProps {
  summary: string;
  body: string;
  durationLabel: string;
  defaultExpanded?: boolean;
  /** `true` while this block is still receiving reasoning deltas (T28A3,
   * plan.md §11.1 "assistant text and thinking deltas"). Adds the
   * shimmer-gradient live-state treatment to the summary text, plus a
   * visually-hidden "Still thinking" announcement, so the live state is
   * never colour/animation-only.
   *
   * CORRECTED (STREAM-1 follow-up): this used to call the gradient "the
   * same approved treatment `StreamingMessage` already uses for in-flight
   * assistant text". STREAM-1 removed exactly that treatment from
   * `.pc-message__text`, because Beautiful UI reserves the gradient for
   * short, fixed labels and gives real streamed prose a trailing blur and
   * mask instead. The summary is a short label, which is the case the
   * gradient was always for, so it keeps the treatment on its own terms
   * rather than by inheriting one that no longer exists. `recipes.css`'s
   * `.pc-thinking__summary--live` rule carries the same correction. */
  live?: boolean;
  testId?: string;
}

/**
 * ThinkingSection recipe (plan.md §10.4): a collapsible transcript block
 * for an assistant turn's reasoning. Built from a clean specification (a
 * disclosure button controlling a labelled region) rather than copied
 * code — see plan.md §10.1.
 *
 * Accessibility (plan.md §10.5): the trigger is a real `<button>` with
 * `aria-expanded`/`aria-controls`, so it is keyboard-operable and its
 * state is exposed to assistive tech without relying on an icon's
 * rotation alone; the duration is always visible text, never a
 * colour-only cue.
 */
export function ThinkingSection({
  summary,
  body,
  durationLabel,
  defaultExpanded = false,
  live = false,
  testId,
}: ThinkingSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const bodyId = useId();

  return (
    <div className={`pc-thinking${live ? " pc-thinking--live" : ""}`} data-testid={testId}>
      <button
        type="button"
        className="pc-thinking__trigger"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span
          className={`pc-thinking__chevron${expanded ? " pc-thinking__chevron--open" : ""}`}
          aria-hidden="true"
        />
        <span className={`pc-thinking__summary${live ? " pc-thinking__summary--live" : ""}`}>
          {summary}
        </span>
        <span className="pc-thinking__duration">{durationLabel}</span>
      </button>
      {live ? <span className="pc-visually-hidden">Still thinking</span> : null}
      <div id={bodyId} className="pc-thinking__body" hidden={!expanded}>
        <p>{body}</p>
      </div>
    </div>
  );
}

export default ThinkingSection;
