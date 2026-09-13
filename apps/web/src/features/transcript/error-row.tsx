import { memo, useRef } from "react";
import type { timeline } from "@picompanion/frontend-core";

import { Banner } from "../../ui/primitives/index.js";
import type { StatusTone } from "../../ui/primitives/index.js";

/** The `error` transcript entry kind (`transcript-view.ts`'s `error` ->
 * `"error"` projection, built straight from the daemon's
 * `AgentTimelineItem` error variant). This task's sibling to
 * `message-row.tsx`'s `CoreMessageEntry`, `thinking-row.tsx`'s
 * `ThinkingTranscriptEntry`, `tool-call-row.tsx`'s
 * `ToolCallTranscriptEntry`, and `compaction-row.tsx`'s
 * `CompactionTranscriptEntry`.
 *
 * An error is a system event, not a chat turn — like a compaction marker
 * it explains itself in the message text (plan.md §10.5 "non-colour
 * status text") rather than relying on the `Banner` tone alone, and it
 * renders through `Banner`, not `StreamingMessage`/`ThinkingSection`/
 * `Card`, so it reads as visually distinct from every speaker-attributed
 * row around it. */
export type ErrorTranscriptEntry = Extract<timeline.TranscriptEntry, { kind: "error" }>;

export function isErrorEntry(entry: timeline.TranscriptEntry): entry is ErrorTranscriptEntry {
  return entry.kind === "error";
}

export interface TranscriptErrorRowProps {
  entry: ErrorTranscriptEntry;
  testId?: string;
}

const TONE: StatusTone = "danger";

/**
 * A pathological error (a pasted stack trace, a runaway daemon message)
 * can run long. Bounding what this row renders — never what
 * `frontend-core` stores — keeps one row's DOM cost constant, the same
 * trade-off `thinking-row.tsx`'s `MAX_BODY_CHARS` already makes for
 * reasoning text.
 */
const MAX_MESSAGE_CHARS = 4000;
const TRUNCATION_SUFFIX = "\n\n… (truncated for display)";

function boundedMessage(message: string): string {
  if (message.length <= MAX_MESSAGE_CHARS) {
    return message;
  }
  return `${message.slice(0, Math.max(0, MAX_MESSAGE_CHARS - TRUNCATION_SUFFIX.length))}${TRUNCATION_SUFFIX}`;
}

function messageFor(entry: ErrorTranscriptEntry): string {
  const detail = entry.message.trim();
  if (detail.length === 0) {
    return "Something went wrong — the daemon reported an error with no details.";
  }
  return `Something went wrong — ${boundedMessage(detail)}`;
}

/**
 * Renders one `error` transcript entry by composing the `Banner`
 * primitive (plan.md §10.3). `Banner` already gives a live, polite
 * `role="status"` region and non-colour status text; this component only
 * maps the framework-neutral `TranscriptEntry` onto that primitive's
 * props.
 */
function TranscriptErrorRowImpl({ entry, testId }: TranscriptErrorRowProps) {
  // Render-count instrumentation for `areErrorRowPropsEqual` below —
  // same reasoning and shape as `message-row.tsx`'s
  // `TranscriptMessageRowImpl`: a `data-*` attribute has no visual or
  // accessible-tree effect, and it lets a test prove a field the memo
  // comparator watches actually causes a re-render, rather than inferring
  // it from DOM node identity alone.
  const renderCount = useRef(0);
  renderCount.current += 1;

  return (
    <div data-render-count={renderCount.current}>
      <Banner tone={TONE} message={messageFor(entry)} testId={testId} />
    </div>
  );
}

function areErrorRowPropsEqual(
  previous: TranscriptErrorRowProps,
  next: TranscriptErrorRowProps,
): boolean {
  return (
    previous.entry.id === next.entry.id &&
    previous.entry.message === next.entry.message &&
    previous.testId === next.testId
  );
}

export const TranscriptErrorRow = memo(TranscriptErrorRowImpl, areErrorRowPropsEqual);
