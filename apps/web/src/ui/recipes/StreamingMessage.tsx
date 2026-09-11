import "../primitives/primitives.css";
import "./recipes.css";

export interface StreamingMessageProps {
  speaker: "assistant" | "user";
  text: string;
  streaming: boolean;
  testId?: string;
}

/**
 * StreamingMessage recipe (plan.md §10.4): a single transcript turn,
 * optionally still streaming. Clean-specification recipe, not copied
 * (plan.md §10.1).
 *
 * Accessibility (plan.md §10.5): the streaming state is announced through
 * visible, visually-hidden text ("Pi is still responding") rather than
 * the blinking-cursor animation alone, so screen-reader users and
 * `prefers-reduced-motion` users get the same information. The cursor
 * animation is suppressed under reduced motion in CSS.
 *
 * The visible speaker label moved OUT of this recipe to the transcript's
 * own meta line above the block (`features/transcript/transcript-meta.tsx`,
 * the mockup's `.meta`), so the group's `aria-label` here is the one place
 * the label still lives in this recipe — and it is the accessible name,
 * kept deliberately. */
export function StreamingMessage({ speaker, text, streaming, testId }: StreamingMessageProps) {
  return (
    <div
      className={`pc-message pc-message--${speaker}`}
      role="group"
      aria-label={`${speaker === "assistant" ? "Pi" : "You"}${streaming ? " (responding)" : ""}`}
      data-testid={testId}
    >
      <p className="pc-message__text">
        {text}
        {streaming ? <span className="pc-message__cursor" aria-hidden="true" /> : null}
      </p>
      {streaming ? <span className="pc-visually-hidden">Pi is still responding</span> : null}
    </div>
  );
}

export default StreamingMessage;
