import { memo, useRef } from "react";
import type { timeline } from "@picompanion/frontend-core";

import { Banner } from "../../ui/primitives/index.js";
import type { StatusTone } from "../../ui/primitives/index.js";

/** The `compaction` transcript entry kind (plan.md §11.1 "compaction and
 * summarization retry"; `transcript-view.ts`'s `compaction` ->
 * `"compaction"` projection, itself built straight from the daemon's
 * `CompactionTimelineItem` — `packages/protocol/src/agent-types.ts`,
 * `type: "compaction"`). T28A7's sibling to `message-row.tsx`'s
 * `CoreMessageEntry`, `thinking-row.tsx`'s `ThinkingTranscriptEntry`, and
 * `tool-call-row.tsx`'s `ToolCallTranscriptEntry`.
 *
 * There is no matching row for a *retry* marker (auto-retry or
 * summarization-retry) in this file, and that omission is not an
 * oversight this task made — it is upstream of every file this task
 * owns, the same shape of gap `message-row.tsx`'s doc comment already
 * documents for image/attachment content:
 *
 *  - the daemon's retry signal is `AgentStreamEvent`'s `{ type:
 *    "pi_retry", phase, attempt, maxAttempts, delayMs?, error? }`
 *    variant (the `AgentStreamEvent` union's `"pi_retry"` member in
 *    `packages/protocol/src/agent-types.ts`), which is a
 *    **top-level stream event**, not an `AgentTimelineItem` — unlike
 *    `CompactionTimelineItem` above, there has never been a wire shape
 *    for "a retry, as a row in the conversation";
 *  - `ingestAgentStreamMessage`, the only path that turns a live
 *    `AgentStreamEvent` into transcript state, is explicit that "every
 *    other `AgentStreamEvent` variant (turn lifecycle, permissions, Pi UI
 *    state, ...) belongs to a different frontend-core domain
 *    (sessions/permissions/extensions) and is a no-op here", in
 *    `packages/frontend-core/src/timeline/reducer.ts` — a live
 *    `pi_retry` event reaching the reducer today is silently dropped
 *    before it ever becomes a `TimelineRow`, so it can never reach
 *    `buildTranscriptEntries`/`buildTranscriptView` either;
 *  - `transcript-view.ts`'s own module doc says the same thing from the
 *    projection side: "auto-retry, summarization retry, extension
 *    errors, and model/thinking changes are `AgentStreamEvent` variants
 *    outside `type: "timeline"` ... those belong to other, not-yet-built
 *    frontend-core domains (sessions/turn state, extensions)", in
 *    `packages/frontend-core/src/timeline/transcript-view.ts`.
 *
 * `TranscriptEntry`'s union (same file, `TranscriptEntry` type) therefore
 * has no `"retry"` member for this file to render — inventing one here,
 * scoped only to `apps/web/src/features/transcript/`, would mean forking
 * the shared core view model that every other row in this directory
 * reuses unchanged, and feeding it from nothing (no live data reaches
 * this feature for a retry event at all, by the citations above). That
 * is worse than an honest gap: a row that renders only for a
 * hand-written fixture and never for a real retry. This file renders
 * every retry-shaped entry `TranscriptEntry` can actually carry today —
 * which is none — and leaves the gap here, visible, rather than papering
 * over it. Closing it needs a small frontend-core change this task does
 * not own: a `pi_retry` branch in the sessions/turn-state domain (or a
 * new `AgentTimelineItem`/`TranscriptEntry` "retry" case, mirroring
 * `CompactionTimelineItem`) that this row can then render exactly like
 * `TranscriptCompactionRow` below. */
export type CompactionTranscriptEntry = Extract<timeline.TranscriptEntry, { kind: "compaction" }>;

export function isCompactionEntry(
  entry: timeline.TranscriptEntry,
): entry is CompactionTranscriptEntry {
  return entry.kind === "compaction";
}

export interface TranscriptCompactionRowProps {
  entry: CompactionTranscriptEntry;
  testId?: string;
}

const TONE_BY_STATUS: Record<CompactionTranscriptEntry["status"], StatusTone> = {
  loading: "info",
  completed: "neutral",
};

function triggerLabel(trigger: CompactionTranscriptEntry["trigger"]): string | null {
  if (trigger === "manual") {
    return "Manual";
  }
  if (trigger === "auto") {
    return "Automatic";
  }
  return null;
}

const TOKEN_FORMATTER = new Intl.NumberFormat("en-US");

function formatTokenCount(tokens: number): string {
  return TOKEN_FORMATTER.format(Math.max(0, Math.round(tokens)));
}

/**
 * A compaction marker is a system event, not a chat turn — it explains
 * itself in the message text (plan.md §10.5 "non-colour status text")
 * rather than relying on the `Banner` tone alone, and it is rendered
 * through `Banner`, not `StreamingMessage`/`ThinkingSection`/`Card`, so
 * it reads as visually distinct from every speaker-attributed row around
 * it (T28A7 acceptance: "compaction ... markers render as distinct,
 * explained entries").
 *
 * CORRECTED (P6-W13): this comment previously said the completed message
 * "always adds a 'details not available' note (T38B3), never an empty
 * \"Compacted\" chip that reads as completeness," and that Pi's real
 * `CompactionResult` (`summary` plus `details.{readFiles, modifiedFiles}`)
 * could never reach this component because "`rpc-types.ts` still types
 * `compaction_end`'s payload `result?: unknown`" and
 * "`CompactionTimelineItem` ... has no `summary` or `details` field to
 * carry it." It then listed three steps as work nobody had done: (1) type
 * `compaction_end`'s payload in
 * `packages/server/src/server/agent/providers/pi/rpc-types.ts`, (2) add
 * `summary`/`details` fields to `CompactionTimelineItem`
 * (`packages/protocol/src/agent-types.ts`), (3) forward those fields onto
 * `CompactionTranscriptEntry` in `transcript-view.ts`.
 *
 * All three landed in T143 (`7fb0c26`): `rpc-types.ts` types
 * `compaction_end`'s result from the installed Pi's own
 * `CompactionResult`, `CompactionTimelineItem` carries `summary`,
 * `estimatedTokensAfter`, `filesRead` and `filesModified`, and
 * `transcript-view.ts` forwards all four onto `CompactionTranscriptEntry`
 * alongside `preTokens`. `messageFor` below renders every one of them.
 * The one case that is still honestly "not available" is a completed
 * compaction Pi did not attach a summary or file list to — every
 * compaction recorded before T143 shipped, and any future one Pi sends
 * without them — and `messageFor` says so for that entry specifically,
 * not as a blanket claim the app itself lacks the data.
 */
function messageFor(entry: CompactionTranscriptEntry): string {
  const trigger = triggerLabel(entry.trigger);
  const prefix = trigger ? `${trigger} compaction` : "Compaction";
  if (entry.status === "loading") {
    return `${prefix} in progress — condensing earlier turns to free up context space.`;
  }
  const tokenNote = tokenRangeNote(entry.preTokens, entry.estimatedTokensAfter);
  const summaryNote = entry.summary ? ` Summary: ${entry.summary}` : "";
  const filesNote = filesNoteFor(entry.filesRead, entry.filesModified);
  const noStructuredDetails = !entry.summary && !filesNote;
  const absentNote = noStructuredDetails
    ? " No summary or file details were provided for this compaction."
    : "";
  return `${prefix} completed — earlier turns were condensed to free up context space.${tokenNote}${summaryNote}${filesNote}${absentNote}`;
}

/**
 * T143's before/after token estimate, phrased around `formatTokenCount`.
 * `apps/android/src/features/composer/turn-status-model.ts`'s
 * `describeCompactionStatus` only ever renders `preTokens` — it carries
 * `estimatedTokensAfter` onto `TurnCompactionStatus` but never reads it
 * back out. Diverging from that here on purpose: T146 requires an
 * explicit decision for `estimatedTokensAfter` rather than leaving it
 * unread on both surfaces, and pairing the before/after counts is the
 * whole reason a user would want either number — "compaction saved about
 * this many tokens" is more legible than either count alone.
 */
function tokenRangeNote(
  preTokens: CompactionTranscriptEntry["preTokens"],
  estimatedTokensAfter: CompactionTranscriptEntry["estimatedTokensAfter"],
): string {
  if (preTokens !== undefined && estimatedTokensAfter !== undefined) {
    return ` The conversation was using about ${formatTokenCount(preTokens)} tokens beforehand, reduced to about ${formatTokenCount(estimatedTokensAfter)} afterward.`;
  }
  if (preTokens !== undefined) {
    return ` The conversation was using about ${formatTokenCount(preTokens)} tokens beforehand.`;
  }
  if (estimatedTokensAfter !== undefined) {
    return ` The conversation now uses about ${formatTokenCount(estimatedTokensAfter)} tokens.`;
  }
  return "";
}

/** T143's post-compaction file-tracking detail, phrased to match
 * `apps/android/src/features/composer/turn-status-model.ts`'s
 * `describeCompactionFiles` field-for-field so the two surfaces describe
 * the same compaction the same way. Returns `""` when the daemon
 * supplied neither list. */
function filesNoteFor(
  filesRead: CompactionTranscriptEntry["filesRead"],
  filesModified: CompactionTranscriptEntry["filesModified"],
): string {
  const readCount = filesRead?.length ?? 0;
  const modifiedCount = filesModified?.length ?? 0;
  if (readCount === 0 && modifiedCount === 0) return "";
  const parts: string[] = [];
  if (readCount > 0) parts.push(`${readCount} file${readCount === 1 ? "" : "s"} read`);
  if (modifiedCount > 0) {
    parts.push(`${modifiedCount} file${modifiedCount === 1 ? "" : "s"} modified`);
  }
  return ` (${parts.join(", ")})`;
}

/**
 * Renders one `compaction` transcript entry by composing the `Banner`
 * primitive (plan.md §10.3). `Banner` already gives a live, polite
 * `role="status"` region and non-colour status text; this component only
 * maps the framework-neutral `TranscriptEntry` onto that primitive's
 * props.
 */
function TranscriptCompactionRowImpl({ entry, testId }: TranscriptCompactionRowProps) {
  // Render-count instrumentation for `areCompactionRowPropsEqual` below —
  // same reasoning and shape as `message-row.tsx`'s
  // `TranscriptMessageRowImpl`: a `data-*` attribute has no visual or
  // accessible-tree effect, and it lets a test prove a field the memo
  // comparator watches actually causes (or, with the field removed from
  // the comparator, fails to cause) a re-render, rather than inferring it
  // from DOM node identity alone.
  const renderCount = useRef(0);
  renderCount.current += 1;

  return (
    <div data-render-count={renderCount.current}>
      <Banner tone={TONE_BY_STATUS[entry.status]} message={messageFor(entry)} testId={testId} />
    </div>
  );
}

/** Order-and-length-sensitive comparison for the string arrays T143 added
 * (`filesRead`/`filesModified`) — same reasoning as `message-row.tsx`'s
 * `imagesEqual`: these lists are small and set once per compaction, so a
 * per-slot compare is enough to catch a real change without a
 * `JSON.stringify` on every row compare. */
function stringArraysEqual(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return previous === next;
  if (previous.length !== next.length) return false;
  return previous.every((value, index) => value === next[index]);
}

/**
 * T143 added `summary`, `estimatedTokensAfter`, `filesRead` and
 * `filesModified` to `CompactionTranscriptEntry`, and `messageFor` now
 * reads all four (see above) — every one of them belongs in this memo
 * comparator, or a compaction whose summary arrives without a token
 * change would never re-render: carried, rendered in code, and still
 * invisible to the user.
 */
function areCompactionRowPropsEqual(
  previous: TranscriptCompactionRowProps,
  next: TranscriptCompactionRowProps,
): boolean {
  return (
    previous.entry.id === next.entry.id &&
    previous.entry.status === next.entry.status &&
    previous.entry.trigger === next.entry.trigger &&
    previous.entry.preTokens === next.entry.preTokens &&
    previous.entry.summary === next.entry.summary &&
    previous.entry.estimatedTokensAfter === next.entry.estimatedTokensAfter &&
    stringArraysEqual(previous.entry.filesRead, next.entry.filesRead) &&
    stringArraysEqual(previous.entry.filesModified, next.entry.filesModified) &&
    previous.testId === next.testId
  );
}

export const TranscriptCompactionRow = memo(
  TranscriptCompactionRowImpl,
  areCompactionRowPropsEqual,
);
