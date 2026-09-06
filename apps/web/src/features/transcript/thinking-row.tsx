import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { timeline } from "@picompanion/frontend-core";

import { ThinkingSection } from "../../ui/recipes/index.js";

/** The `thinking` transcript entry kind (plan.md §11.1 "assistant text and
 * thinking deltas"; `transcript-view.ts`'s `reasoning` -> `"thinking"`
 * projection). T28A3's sibling to `message-row.tsx`'s `CoreMessageEntry` —
 * see that file's doc comment for the full list of `TranscriptEntry`
 * kinds still owned by later tasks in this directory. */
export type ThinkingTranscriptEntry = Extract<timeline.TranscriptEntry, { kind: "thinking" }>;

export function isThinkingEntry(entry: timeline.TranscriptEntry): entry is ThinkingTranscriptEntry {
  return entry.kind === "thinking";
}

export interface TranscriptThinkingRowProps {
  entry: ThinkingTranscriptEntry;
  /** `true` while this entry is the one currently receiving live
   * reasoning deltas — same source/shape as `TranscriptMessageRow`'s
   * `streaming` prop (see that component's doc comment for why this is
   * an explicit caller-supplied prop rather than derived here). */
  live: boolean;
  testId?: string;
}

/**
 * Reasoning can run to many thousands of characters over a long turn.
 * Truncating what this row renders (never what `frontend-core` stores)
 * keeps one transcript row's DOM bounded — T28A3 acceptance: "long
 * reasoning is bounded rather than unbounded" — without discarding any
 * daemon data.
 */
const MAX_BODY_CHARS = 4000;
const MAX_SUMMARY_CHARS = 80;
const BODY_TRUNCATION_SUFFIX = "\n\n… (truncated for display)";
const SUMMARY_TRUNCATION_SUFFIX = "…";

function truncate(text: string, max: number, suffix: string): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

function firstLine(text: string): string {
  const trimmed = text.trim();
  const newlineIndex = trimmed.indexOf("\n");
  return newlineIndex === -1 ? trimmed : trimmed.slice(0, newlineIndex);
}

function summaryFor(entry: ThinkingTranscriptEntry, live: boolean): string {
  const preview = truncate(firstLine(entry.text), MAX_SUMMARY_CHARS, SUMMARY_TRUNCATION_SUFFIX);
  if (preview.length === 0) {
    return live ? "Thinking…" : "Thought";
  }
  return live ? `Thinking: ${preview}` : `Thought: ${preview}`;
}

function bodyFor(entry: ThinkingTranscriptEntry): string {
  const trimmed = entry.text.trim();
  if (trimmed.length === 0) {
    return "…";
  }
  return truncate(trimmed, MAX_BODY_CHARS, BODY_TRUNCATION_SUFFIX);
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * A `thinking` entry carries one daemon timestamp, not a start/end pair
 * (see `ThinkingTranscriptEntry`), so this row is the only place that can
 * derive `ThinkingSection`'s `durationLabel`: tick a live "Ns"/"Nm Ss"
 * readout for as long as `live` stays true, freeze it the instant `live`
 * turns false, and — for an entry that was already settled the first time
 * this client observed it (a page reload mid-conversation, or backfilled
 * history) — report no duration at all rather than the meaningless
 * "time since this row's timestamp until now".
 */
function useElapsedLabel(timestamp: string, live: boolean): string {
  const startMs = useMemo(() => Date.parse(timestamp), [timestamp]);
  const wasLiveRef = useRef(false);
  const frozenMsRef = useRef<number | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!live) {
      return undefined;
    }
    const intervalId = setInterval(() => forceTick((count) => count + 1), 1000);
    return () => clearInterval(intervalId);
  }, [live]);

  if (live) {
    wasLiveRef.current = true;
    frozenMsRef.current = null;
    return formatElapsed(Date.now() - startMs);
  }
  if (wasLiveRef.current && frozenMsRef.current === null) {
    frozenMsRef.current = Date.now() - startMs;
  }
  return frozenMsRef.current === null ? "" : formatElapsed(frozenMsRef.current);
}

/**
 * Renders one `thinking` transcript entry by composing the
 * `ThinkingSection` recipe (T28A3, plan.md §10.4). The recipe already
 * gives keyboard-operable disclosure with correct `aria-expanded`/
 * `aria-controls` state; this component maps the framework-neutral
 * `TranscriptEntry` onto that recipe's props and derives the
 * summary/duration text the recipe needs but the entry does not carry
 * directly.
 */
function TranscriptThinkingRowImpl({ entry, live, testId }: TranscriptThinkingRowProps) {
  // Same render-count instrumentation as `TranscriptMessageRow`, for the
  // same reason — see that component's doc comment.
  const renderCount = useRef(0);
  renderCount.current += 1;
  const durationLabel = useElapsedLabel(entry.timestamp, live);

  return (
    <div data-render-count={renderCount.current}>
      <ThinkingSection
        summary={summaryFor(entry, live)}
        body={bodyFor(entry)}
        durationLabel={durationLabel}
        live={live}
        testId={testId}
      />
    </div>
  );
}

function areThinkingRowPropsEqual(
  previous: TranscriptThinkingRowProps,
  next: TranscriptThinkingRowProps,
): boolean {
  return (
    previous.entry.id === next.entry.id &&
    previous.entry.text === next.entry.text &&
    previous.entry.timestamp === next.entry.timestamp &&
    previous.live === next.live &&
    previous.testId === next.testId
  );
}

export const TranscriptThinkingRow = memo(TranscriptThinkingRowImpl, areThinkingRowPropsEqual);
