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
 * the caret animation alone, so screen-reader users and
 * `prefers-reduced-motion` users get the same information. The caret's
 * `--streaming` animation, and the tail blur/mask and pixel-grid loader
 * below it, are all suppressed under reduced motion in CSS.
 *
 * Live-state treatment while `streaming` is true (docs/beautiful-ui-
 * reference.md's signature traits): the caret is held solid rather than
 * blinking (`.pc-message__cursor--streaming`, matching `.stream-caret.is-
 * streaming` in `D:/beautiful-ui/app/globals.css`), the trailing run of
 * text gets a blur+mask "still forming" treatment (`.pc-message__tail`,
 * ported from `StreamText.tsx` as a single trailing span — never
 * per-character spans), and a nine-cell pixel-grid loader
 * (`.pc-message__pixel-grid`) follows the text. The whole-paragraph
 * shimmer gradient this recipe used to apply to in-flight text is gone:
 * Beautiful UI reserves that gradient for short fixed labels
 * (`Shimmer.tsx`, called only by `ThinkingState`/`LoadingState`), not real
 * streamed prose.
 *
 * The trailing span covers a fixed slice of the tail — long enough to read
 * as "still forming" without re-measuring on every delta — while the rest
 * of the text renders plainly.
 *
 * The visible speaker label moved OUT of this recipe to the transcript's
 * own meta line above the block (`features/transcript/transcript-meta.tsx`,
 * the mockup's `.meta`), so the group's `aria-label` here is the one place
 * the label still lives in this recipe — and it is the accessible name,
 * kept deliberately. */
const TAIL_LENGTH = 12;

export function StreamingMessage({ speaker, text, streaming, testId }: StreamingMessageProps) {
  const tailStart = streaming ? Math.max(0, text.length - TAIL_LENGTH) : text.length;
  const head = text.slice(0, tailStart);
  const tail = text.slice(tailStart);

  return (
    <div
      className={`pc-message pc-message--${speaker}`}
      role="group"
      aria-label={`${speaker === "assistant" ? "Pi" : "You"}${streaming ? " (responding)" : ""}`}
      data-testid={testId}
    >
      <p className="pc-message__text">
        {head}
        {streaming && tail ? <span className="pc-message__tail">{tail}</span> : tail}
        <span
          className={`pc-message__cursor${streaming ? " pc-message__cursor--streaming" : ""}`}
          aria-hidden="true"
        />
        {streaming ? (
          <span className="pc-message__pixel-grid" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        ) : null}
      </p>
      {streaming ? <span className="pc-visually-hidden">Pi is still responding</span> : null}
    </div>
  );
}

export default StreamingMessage;
