import { timeline } from "@picompanion/frontend-core";

/**
 * The turn meta line the web transcript draws above a block (T386 family
 * fidelity work; the mockup's `.meta`).
 *
 * The mockup precedes every turn with
 *
 * ```html
 * <div class="meta"><span class="who u">you</span><span>23:36</span></div>
 * ```
 *
 * and styles it as `font-family: var(--mono); font-size: 10.5px; color:
 * var(--ink-3)` with `.who` at `font-size: 9.5px; font-weight: 700;
 * letter-spacing: .06em; text-transform: uppercase` — `.who.u` reading
 * `var(--accent-ink)` for the user and `.who.a` reading `var(--ink-2)` for
 * everything the agent did. Before this, the web speaker was a
 * `.pc-message__speaker` label *inside* the bubble and the message time
 * rendered *below* the row (T308), so a reader saw "23:36" detached from
 * whoever said it.
 *
 * `who` is a lowercase DOM string (`you` / `pi` / `thinking`) exactly as
 * the mockup writes it; the uppercase treatment is CSS
 * (`text-transform`), never a different string, so a screen reader hears
 * the words the mockup's own markup carries. The speaker's *accessible*
 * name still comes from the message bubble's `role="group"` `aria-label`
 * ("You"/"Pi") — this line is the visible, shared treatment both rows use.
 *
 * The optional `timestamp` is passed only by message rows: reasoning,
 * tool-call and compaction rows are process detail rather than something
 * either party said, and must not be dated (the rule T308's own test still
 * pins). `formatMessageTimestamp` already returns `null` for an absent or
 * unparseable stamp, and this component renders nothing in that case — the
 * row stays readable without a fabricated "Invalid Date".
 */
export type TranscriptSpeaker = "you" | "pi" | "thinking";

const SPEAKER_LABEL: Record<TranscriptSpeaker, string> = {
  you: "you",
  pi: "pi",
  thinking: "thinking",
};

export interface TranscriptMetaProps {
  who: TranscriptSpeaker;
  /** Raw daemon ISO timestamp, rendered as the mockup's `.meta` time. Omit for rows that must not be dated. */
  timestamp?: string;
  /** Prefix for the `<time>`'s `data-testid` (`${testId}-timestamp`), the same suffix T308 shipped. */
  testId?: string;
}

export function TranscriptMeta({ who, timestamp, testId }: TranscriptMetaProps) {
  const stamp = timestamp === undefined ? null : timeline.formatMessageTimestamp(timestamp);
  return (
    <div className="pc-transcript__meta">
      <span className={`pc-transcript__who pc-transcript__who--${who}`}>{SPEAKER_LABEL[who]}</span>
      {stamp ? (
        <time
          className="pc-transcript__timestamp"
          dateTime={stamp.iso}
          title={stamp.title}
          data-testid={testId ? `${testId}-timestamp` : undefined}
        >
          {stamp.text}
        </time>
      ) : null}
    </div>
  );
}

export default TranscriptMeta;
