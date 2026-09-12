/**
 * Stable timeline row identity (T388, plan.md §7.4).
 *
 * Every timeline row already carries `TimelineRow.id`, and that id is a
 * perfectly good **reducer** identity: it is what `ingestEntry` dedupes on
 * (`${epoch}:${seqStart}` for confirmed rows, `optimistic:${clientMessageId}`
 * for local ones — see `./reducer.ts`). It is not, by itself, the identity a
 * *renderer* should key a list by, for two reasons this module exists to fix:
 *
 * 1. **A row's `(epoch, seqStart)` is not the only thing that identifies it.**
 *    A `fetch_agent_timeline_response` window is "projected" server-side
 *    (`packages/server/src/server/agent/timeline-projection.ts` may collapse
 *    several source sequence numbers into one row before it is sent — see
 *    `./types.ts`'s doc comment). A live row with `seqStart: 10` and its
 *    replay in a later window can therefore describe the same logical item
 *    under a different sequence number. The item's own durable identity
 *    (`callId`, `messageId`, `clientMessageId`) does not change across that
 *    boundary; the sequence number can.
 * 2. **A list needs one key per row, stable across every state transition** —
 *    appending, prepending a page, a coalesced stream update, a reconnect or
 *    gap-recovery replay, and a full re-derivation from the same input. An
 *    array index satisfies none of those (a prepend shifts every index), and
 *    the raw `(epoch, seqStart)` pair is only stable for (3) and (5).
 *
 * The ladder below prefers the most durable identity a row's item actually
 * carries, and falls back to the sequence identity only when it has none.
 * Every rung is chosen to be **injective over the rows a timeline can
 * hold** — a key is a list key, so two rows in one state must never collide:
 *
 * - `client:` a user message, keyed by the submission's own
 *   `clientMessageId`. Deliberately **not** the row's reducer id: a pending
 *   optimistic row's reducer id is `optimistic:${clientMessageId}`, while its
 *   confirmed daemon row's is `${epoch}:${seq}`, so keying on the reducer id
 *   would remount the row at the exact moment reconciliation removes it. The
 *   confirmed item carries the same `clientMessageId` (that is what
 *   `reconcilePendingRows` matches on), so this key spans both. A confirmed
 *   user message with no `clientMessageId` falls back to its `messageId`.
 * - `tool:` a tool call, keyed by its daemon-assigned `callId`. The reducer
 *   already merges every later status/result update for one `callId` into the
 *   same row, so `callId` is unique per row by construction.
 * - `message:` a confirmed user message with no `clientMessageId`, keyed by
 *   its `messageId`. User messages are never streamed as separate deltas, so
 *   one message id is one row.
 * - `assistant:` a confirmed assistant message, keyed by its `messageId`
 *   **plus `seqStart`**. The sequence number is required here: one assistant
 *   message genuinely spans many rows in a live turn (the server's 60 ms
 *   `agent-stream-coalescer` flushes each window as its own row — see
 *   `./coalescer.ts`'s module doc comment), and all of them share one
 *   `messageId`. Including the row's `seqStart` keeps those rows distinct
 *   while still surviving a `replaceMessageId` correction, which the reducer
 *   applies in place at the existing row's sequence.
 * - `seq:` the fallback for every item with no durable identity of its own
 *   (`reasoning`, `todo`, `error`, `compaction`, `pi_ui_snapshot`, and a
 *   user/assistant message the daemon sent without an id).
 *
 * `source` is exposed alongside the key so a caller can tell *why* a row got
 * the identity it did (diagnostics, and tests that assert the ladder rather
 * than a string).
 *
 * Repository invariant: this module must never import React, React Native,
 * Expo, DOM types, or browser globals.
 */
import type { AgentTimelineItem } from "@picompanion/protocol/agent-types";

/** The minimum shape `deriveTimelineRowKey` needs: a `TimelineRow` satisfies
 * it structurally, and so does any projection that kept the row's identity
 * fields (`TranscriptEntry` does — see `./transcript-view.ts`). */
export interface TimelineRowKeyInput {
  readonly epoch: string;
  readonly seqStart: number;
  readonly pending?: boolean;
  readonly item: AgentTimelineItem;
}

/** Which rung of the identity ladder produced a key. */
export type TimelineRowKeySource =
  | "optimistic"
  | "tool-call"
  | "user-message"
  | "assistant-message"
  | "sequence";

export interface TimelineRowKey {
  readonly key: string;
  readonly source: TimelineRowKeySource;
}

function sequenceKey(epoch: string, seqStart: number): string {
  return `seq:${epoch}:${seqStart}`;
}

function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.length > 0 ? value : null;
}

/**
 * Derives the stable, renderer-facing identity for one timeline row. Pure and
 * deterministic: the same row fields always produce the same key, and the key
 * never depends on the row's position in any array.
 */
export function deriveTimelineRowKey(row: TimelineRowKeyInput): TimelineRowKey {
  const item = row.item;

  if (item.type === "user_message") {
    const clientMessageId = nonEmpty(item.clientMessageId);
    if (clientMessageId !== null) {
      // One key text for both the pending and the confirmed row, so the
      // optimistic-to-confirmed reconciliation is invisible to a list key.
      return {
        key: `client:${clientMessageId}`,
        source: row.pending === true ? "optimistic" : "user-message",
      };
    }
    const messageId = nonEmpty(item.messageId);
    if (messageId !== null) {
      return { key: `message:${messageId}`, source: "user-message" };
    }
    return { key: sequenceKey(row.epoch, row.seqStart), source: "sequence" };
  }

  if (item.type === "tool_call") {
    const callId = nonEmpty(item.callId);
    if (callId !== null) {
      return { key: `tool:${callId}`, source: "tool-call" };
    }
    return { key: sequenceKey(row.epoch, row.seqStart), source: "sequence" };
  }

  if (item.type === "assistant_message") {
    // `replaceMessageId` is the id of the message this row *corrects*; the
    // reducer keeps the corrected row at its original position, so keying by
    // it (when the correcting item omits its own `messageId`) keeps the
    // pre- and post-correction rows on one key.
    const identity = nonEmpty(item.messageId) ?? nonEmpty(item.replaceMessageId);
    if (identity !== null) {
      return {
        key: `assistant:${identity}:${row.seqStart}`,
        source: "assistant-message",
      };
    }
    return { key: sequenceKey(row.epoch, row.seqStart), source: "sequence" };
  }

  return { key: sequenceKey(row.epoch, row.seqStart), source: "sequence" };
}

/** Convenience form of `deriveTimelineRowKey` for callers that only want the
 * string. */
export function stableRowKey(row: TimelineRowKeyInput): string {
  return deriveTimelineRowKey(row).key;
}
