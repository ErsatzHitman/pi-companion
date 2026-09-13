import { memo, useRef } from "react";
import type { AgentStreamEvent } from "@picompanion/protocol/agent-types";

import { Banner } from "../../ui/primitives/index.js";
import type { StatusTone } from "../../ui/primitives/index.js";

/** The daemon's retry signal: `AgentStreamEvent`'s `pi_retry` variant
 * (`packages/protocol/src/agent-types.ts`). A top-level stream event, not
 * an `AgentTimelineItem` — there has never been a wire shape for "a retry,
 * as a row in the conversation", which is why no `TranscriptEntry` kind
 * covers it today. */
export type PiRetryStreamEvent = Extract<AgentStreamEvent, { type: "pi_retry" }>;

export type RetryPhase = PiRetryStreamEvent["phase"];

/**
 * A web-local retry entry: the row `transcript.tsx` renders for a
 * `pi_retry` auto-retry or summarization retry.
 *
 * It deliberately mirrors `TranscriptEntryBase`'s identity fields (`id`,
 * `key`, `epoch`, `seqStart`, `seqEnd`, `timestamp`, `provider`,
 * `pending`, `stale`) so the transcript's list-keying, virtualization,
 * and work-group plumbing treat it exactly like any other entry. It is
 * not a member of `timeline.TranscriptEntry` — that union lives in
 * `packages/frontend-core`, which this task does not touch — so the
 * transcript accepts `WebTranscriptEntry` (see `transcript.tsx`) and
 * `retryEntryFromPiRetryEvent` below bridges a real wire event onto this
 * shape without inventing data. Closing the remaining core gap (projecting
 * `pi_retry` into timeline state upstream, the way `compaction` already
 * flows through `CompactionTimelineItem`) needs a small frontend-core
 * change outside this task; this row is the renderer waiting for it, fed
 * today by the bridge below rather than by a fabricated fixture.
 */
export interface RetryTranscriptEntry {
  readonly kind: "retry";
  readonly id: string;
  readonly key?: string;
  readonly epoch: string;
  readonly seqStart: number;
  readonly seqEnd: number;
  readonly timestamp: string;
  readonly provider: string;
  readonly pending: boolean;
  readonly stale: boolean;
  readonly phase: RetryPhase;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly delayMs?: number;
  readonly error?: string;
}

export function isRetryEntry(
  entry: { readonly kind: string } | null | undefined,
): entry is RetryTranscriptEntry {
  return entry?.kind === "retry";
}

export interface TranscriptRetryRowProps {
  entry: RetryTranscriptEntry;
  testId?: string;
}

const TONE: StatusTone = "info";

/**
 * Builds a `RetryTranscriptEntry` from a real `pi_retry` wire event plus
 * the timeline identity the caller already has for where the retry sits.
 * Every retry field comes straight off the event — nothing is inferred —
 * so a row built this way renders a real retry, never a guess at one.
 */
export function retryEntryFromPiRetryEvent(
  event: PiRetryStreamEvent,
  base: {
    readonly id: string;
    readonly epoch: string;
    readonly seqStart: number;
    readonly seqEnd: number;
    readonly timestamp: string;
    readonly stale?: boolean;
    readonly key?: string;
  },
): RetryTranscriptEntry {
  return {
    kind: "retry",
    id: base.id,
    ...(base.key !== undefined ? { key: base.key } : {}),
    epoch: base.epoch,
    seqStart: base.seqStart,
    seqEnd: base.seqEnd,
    timestamp: base.timestamp,
    provider: event.provider,
    pending: false,
    stale: base.stale ?? false,
    phase: event.phase,
    attempt: event.attempt,
    maxAttempts: event.maxAttempts,
    ...(event.delayMs !== undefined ? { delayMs: event.delayMs } : {}),
    ...(event.error !== undefined ? { error: event.error } : {}),
  };
}

function phaseLabel(phase: RetryPhase): string {
  if (phase === "compaction" || phase === "branchSummary") {
    return "Summarization retry";
  }
  return "Automatic retry";
}

/**
 * Same bounding rule as `error-row.tsx`: a daemon-supplied error string
 * can run long, so what this row renders is capped while the stored entry
 * keeps the whole value.
 */
const MAX_ERROR_CHARS = 2000;
const TRUNCATION_SUFFIX = "… (truncated for display)";

function boundedError(error: string): string {
  const trimmed = error.trim();
  if (trimmed.length <= MAX_ERROR_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, MAX_ERROR_CHARS - TRUNCATION_SUFFIX.length))}${TRUNCATION_SUFFIX}`;
}

function formatDelay(delayMs: number): string {
  if (delayMs <= 0) {
    return "retrying now";
  }
  const seconds = delayMs / 1000;
  if (seconds < 60) {
    return `retrying in ${seconds % 1 === 0 ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `retrying in ${minutes}m ${rest}s`;
}

function messageFor(entry: RetryTranscriptEntry): string {
  const attemptNote =
    entry.maxAttempts > 0
      ? `attempt ${Math.max(1, entry.attempt)} of ${entry.maxAttempts}`
      : `attempt ${Math.max(1, entry.attempt)}`;
  const delayNote =
    entry.delayMs !== undefined ? ` — ${formatDelay(entry.delayMs)}` : " — retrying";
  const errorText = entry.error?.trim();
  const errorNote = errorText ? ` Last error: ${boundedError(errorText)}` : "";
  return `${phaseLabel(entry.phase)} — ${attemptNote}${delayNote}.${errorNote}`;
}

/**
 * Renders one retry entry by composing the `Banner` primitive (plan.md
 * §10.3) — the same "system event, not a chat turn" treatment
 * `compaction-row.tsx` and `error-row.tsx` use, so a retry reads as
 * visually distinct from every speaker-attributed row around it while
 * sharing their status-row language.
 */
function TranscriptRetryRowImpl({ entry, testId }: TranscriptRetryRowProps) {
  // Same render-count instrumentation as `TranscriptErrorRow`, for the
  // same reason — see that component's doc comment.
  const renderCount = useRef(0);
  renderCount.current += 1;

  return (
    <div data-render-count={renderCount.current}>
      <Banner tone={TONE} message={messageFor(entry)} testId={testId} />
    </div>
  );
}

function areRetryRowPropsEqual(
  previous: TranscriptRetryRowProps,
  next: TranscriptRetryRowProps,
): boolean {
  return (
    previous.entry.id === next.entry.id &&
    previous.entry.phase === next.entry.phase &&
    previous.entry.attempt === next.entry.attempt &&
    previous.entry.maxAttempts === next.entry.maxAttempts &&
    previous.entry.delayMs === next.entry.delayMs &&
    previous.entry.error === next.entry.error &&
    previous.testId === next.testId
  );
}

export const TranscriptRetryRow = memo(TranscriptRetryRowImpl, areRetryRowPropsEqual);
