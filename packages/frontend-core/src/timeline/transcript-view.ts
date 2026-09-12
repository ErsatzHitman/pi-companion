/**
 * Transcript view model — plan.md §7.4, §11.1, §11.6.
 *
 * T28A1 turns `TimelineState` (T20A/T20B's confirmed + pending rows) into a
 * framework-neutral, render-ready list of `TranscriptEntry` values: one
 * typed entry per §11.1 lifecycle state this domain's `AgentTimelineItem`
 * union can carry today —
 *
 *  - `user_message`     -> `"user-message"`, including a still-pending
 *    local optimistic row (§7.4 "reconcile optimistic user rows with
 *    accepted daemon rows"), and any `images` the item carries (T52A2 —
 *    see below);
 *  - `assistant_message` -> `"assistant-message"`, with `corrected: true`
 *    once a `replaceMessageId` delivery has replaced the row in place
 *    (§11.1 "final message_end replacement"; §7.4), and any `images` the
 *    item carries (T52A2);
 *  - `reasoning`         -> `"thinking"` (§11.1 "thinking deltas");
 *  - `tool_call`         -> `"tool-call"`, covering every wire status —
 *    `running`, `completed`, `failed`, `canceled` — the daemon re-emits
 *    across a call's lifecycle (§11.1 "tool start/update/end"; §11.6),
 *    carrying the same typed `ToolCallViewModel` the tools domain (T23)
 *    already builds for every known family plus the safe generic fallback;
 *  - `todo`              -> `"todo"`;
 *  - `error`              -> `"error"`;
 *  - `compaction`         -> `"compaction"`, covering both `loading` and
 *    `completed` (§11.1 "compaction and summarization retry");
 *  - `pi_ui_snapshot`     -> `"extension-snapshot"`, a durable Pi UI Bridge
 *    snapshot that became a timeline item (§11.5 "durable snapshots become
 *    timeline items").
 *
 * §11.1 also lists lifecycle states with no `AgentTimelineItem` shape at
 * all today — agent/turn start/end/settled, steer/follow-up queue changes,
 * auto-retry, summarization retry, extension errors, and model/thinking
 * changes are `AgentStreamEvent` variants outside `type: "timeline"`, and
 * `ingestAgentStreamMessage` is explicit that those belong to other,
 * not-yet-built frontend-core domains (sessions/turn state, extensions).
 * This file only projects what `TimelineState` actually carries; it does
 * not invent rows for state that has no data behind it yet. A daemon
 * timeline item this build has never seen (a forward-compatibility case,
 * not a normal one) still produces a visible `"unknown"` diagnostic entry
 * rather than throwing or silently dropping the row — the same "never fail
 * the transcript" rule the tools domain's safe generic card follows
 * (§11.2, §11.6).
 *
 * T52A2 ("carry attachments through the transcript view model") threads
 * `AgentTimelineImageRef[]` — the referenced, not-inlined, image blocks
 * T52A1's history mapper now recovers from Pi's user/custom message
 * content (`packages/protocol/src/agent-types.ts`) — onto `user-message`
 * and `assistant-message` entries as an optional `images` field, present
 * only when the source item actually carries at least one image. No
 * separate structured "attachment" shape exists on `AgentTimelineItem` to
 * carry here: T52A1 confirmed every `AgentAttachment` variant (forge
 * PR/issue, review comments, uploaded files) is already flattened to text
 * before Pi ever sees it, so images are the only binary content a
 * timeline item can carry. A platform renderer resolves `path` to bytes
 * over daemon RPC (plan.md §12.4) — this file never reads or fetches the
 * bytes itself, keeping it framework- and I/O-neutral.
 *
 * Deliberately stateless and pure: no `Clock`, no registry, no hidden
 * memoization. Every call is a fresh projection of its input, so a
 * recorded session run twice produces byte-identical entries, and callers
 * that want cross-render tool-call timing continuity own that themselves
 * (e.g. layering a `ToolCallViewModelRegistry` — T23 — on top, keyed by the
 * same `callId` this file already threads through unchanged).
 *
 * No React, no DOM (repository invariant, enforced by
 * `../import-guard.test.ts`).
 */
import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";
import type { PiUiState } from "@picompanion/protocol/pi-ui-bridge/schema";

import { buildToolCallViewModel } from "../tools/view-model.js";
import type { ToolCallBuildOptions, ToolCallViewModel } from "../tools/types.js";
import { getVisibleTimelineRows } from "./reducer.js";
import { deriveTimelineRowKey } from "./row-key.js";
import type { TimelineGap, TimelineRow, TimelineState } from "./types.js";

export interface TranscriptEntryBase {
  /** Same identity as the source `TimelineRow.id` — the *reducer's* dedupe
   * identity (`(epoch, seqStart)` for confirmed rows). Kept for traceability
   * and for callers that need to correlate an entry back to its row; **not**
   * the field to key a rendered list by (see `key`). */
  readonly id: string;
  /** The stable, renderer-facing list key for this entry (T388). Derived by
   * `deriveTimelineRowKey` from the row's own durable identity — `callId`,
   * `clientMessageId`, `messageId` — falling back to `(epoch, seqStart)` only
   * when the item carries none. Unlike `id`, it survives a projected-window
   * replay that renumbers a row's sequence, and it is unchanged across
   * optimistic-row reconciliation. Always unique within one entry list.
   * Renderers must key on this, never on `id` or an array index. */
  readonly key: string;
  readonly epoch: string;
  readonly seqStart: number;
  readonly seqEnd: number;
  /** Daemon timestamp, preserved verbatim (plan.md §7.4). */
  readonly timestamp: string;
  readonly provider: string;
  /** `true` for a local optimistic row awaiting daemon reconciliation
   * (§7.4 "reconcile optimistic user rows with accepted daemon rows"). */
  readonly pending: boolean;
  /** `true` when this entry was produced while `TimelineState.stale` was
   * set — a restored offline-cache tail not yet confirmed by an
   * authoritative fetch (§7.4 "restore a stale cached tail without
   * marking it authoritative"; §12.5). Applies to every entry in the
   * view uniformly, since staleness is a property of the whole loaded
   * window, not one row. */
  readonly stale: boolean;
}

export type TranscriptEntry =
  | (TranscriptEntryBase & {
      readonly kind: "user-message";
      readonly text: string;
      readonly messageId?: string;
      readonly clientMessageId?: string;
      /** Referenced (not inlined) image attachments carried on this
       * message, in source order. Omitted — not an empty array — when
       * the source item carries none, so existing text-only renderers
       * are unaffected (T52A2). */
      readonly images?: ReadonlyArray<AgentTimelineImageRef>;
    })
  | (TranscriptEntryBase & {
      readonly kind: "assistant-message";
      readonly text: string;
      readonly messageId?: string;
      /** `true` once a `replaceMessageId` correction has replaced the
       * originally streamed text in place. */
      readonly corrected: boolean;
      /** See `user-message`'s `images` (T52A2). Pi's own wire format never
       * puts an image block on an assistant-authored message today, but
       * this mirrors the same optional field so a future provider path
       * (or a `custom` message mapped to `assistant-message`, which can
       * carry images per `history-mapper.ts`) is not a breaking type
       * change to add later. */
      readonly images?: ReadonlyArray<AgentTimelineImageRef>;
    })
  | (TranscriptEntryBase & {
      readonly kind: "thinking";
      readonly text: string;
    })
  | (TranscriptEntryBase & {
      readonly kind: "tool-call";
      readonly tool: ToolCallViewModel;
    })
  | (TranscriptEntryBase & {
      readonly kind: "todo";
      readonly items: ReadonlyArray<{ readonly text: string; readonly completed: boolean }>;
    })
  | (TranscriptEntryBase & {
      readonly kind: "error";
      readonly message: string;
    })
  | (TranscriptEntryBase & {
      readonly kind: "compaction";
      readonly status: "loading" | "completed";
      readonly trigger?: "auto" | "manual";
      readonly preTokens?: number;
      /** T143: Pi's own compaction summary, when the daemon has it
       * (`CompactionTimelineItem.summary`). */
      readonly summary?: string;
      /** T143: `CompactionTimelineItem.estimatedTokensAfter`. */
      readonly estimatedTokensAfter?: number;
      /** T143: `CompactionTimelineItem.filesRead`, when the daemon
       * recovered that best-effort shape. */
      readonly filesRead?: ReadonlyArray<string>;
      /** T143: `CompactionTimelineItem.filesModified`, same caveat. */
      readonly filesModified?: ReadonlyArray<string>;
    })
  | (TranscriptEntryBase & {
      readonly kind: "extension-snapshot";
      readonly state: PiUiState;
    })
  | (TranscriptEntryBase & {
      /** Forward-compatibility fallback for a timeline item type this
       * build does not recognize (a newer daemon/protocol version). Never
       * thrown away, and never rendered as raw payload — same "safe
       * diagnostic" rule as an unrecognized Pi UI Bridge kind (§11.2,
       * §11.4). */
      readonly kind: "unknown";
      readonly rawType: string;
      readonly raw: unknown;
    });

export type TranscriptEntryKind = TranscriptEntry["kind"];

/** One combined, render-ready projection of a `TimelineState`: the entry
 * list plus the two pieces of loading/backfill context a transcript needs
 * to render alongside it (§7.4). */
export interface TranscriptView {
  readonly entries: TranscriptEntry[];
  /** Mirrors `TimelineState.gap`: a hole in the loaded window still being
   * backfilled, or `null` once closed. */
  readonly gap: TimelineGap | null;
  /** Mirrors `TimelineState.stale`. */
  readonly stale: boolean;
}

export interface TranscriptViewOptions {
  /** Forwarded to `buildToolCallViewModel` for every `tool-call` entry
   * (working directory to strip from displayed file paths). */
  readonly cwd?: string;
}

/**
 * The stable list key for a transcript entry (T388). Returns the entry's own
 * `key` when it was built by `buildTranscriptEntry`, falling back to `id`
 * only for a hand-built entry that predates/omits the field (test fixtures
 * do; every real entry has one). Renderers must key on this, never on `id`
 * or an array index — see `./row-key.ts` for what instability each of those
 * has.
 */
export function transcriptEntryListKey(entry: {
  readonly key?: string;
  readonly id: string;
}): string {
  return entry.key ?? entry.id;
}

function baseFields(row: TimelineRow, stale: boolean): TranscriptEntryBase {
  return {
    id: row.id,
    key: deriveTimelineRowKey(row).key,
    epoch: row.epoch,
    seqStart: row.seqStart,
    seqEnd: row.seqEnd,
    timestamp: row.timestamp,
    provider: row.provider,
    pending: row.pending ?? false,
    stale,
  };
}

function toolCallOptionsFor(options: TranscriptViewOptions): ToolCallBuildOptions {
  return options.cwd !== undefined ? { cwd: options.cwd } : {};
}

/**
 * Builds one `TranscriptEntry` from one `TimelineRow`. Exposed alongside
 * `buildTranscriptView` so a caller that only needs to re-derive a single
 * changed row (e.g. a live streaming update to one tool call) does not have
 * to rebuild the whole list — see `T28A2`'s "streaming text updates
 * incrementally" requirement.
 *
 * Never throws: an `AgentTimelineItem` type this build has never seen
 * resolves to a `"unknown"` diagnostic entry instead (see the module
 * doc comment).
 */
export function buildTranscriptEntry(
  row: TimelineRow,
  stale = false,
  options: TranscriptViewOptions = {},
): TranscriptEntry {
  const base = baseFields(row, stale);
  const item = row.item;
  switch (item.type) {
    case "user_message":
      return {
        ...base,
        kind: "user-message",
        text: item.text,
        ...(item.messageId !== undefined ? { messageId: item.messageId } : {}),
        ...(item.clientMessageId !== undefined ? { clientMessageId: item.clientMessageId } : {}),
        ...(item.images && item.images.length > 0 ? { images: item.images } : {}),
      };
    case "assistant_message":
      return {
        ...base,
        kind: "assistant-message",
        text: item.text,
        ...(item.messageId !== undefined ? { messageId: item.messageId } : {}),
        corrected: item.corrected === true,
        ...(item.images && item.images.length > 0 ? { images: item.images } : {}),
      };
    case "reasoning":
      return { ...base, kind: "thinking", text: item.text };
    case "tool_call":
      return {
        ...base,
        kind: "tool-call",
        tool: buildToolCallViewModel(item, toolCallOptionsFor(options)),
      };
    case "todo":
      return { ...base, kind: "todo", items: item.items };
    case "error":
      return { ...base, kind: "error", message: item.message };
    case "compaction":
      return {
        ...base,
        kind: "compaction",
        status: item.status,
        ...(item.trigger !== undefined ? { trigger: item.trigger } : {}),
        ...(item.preTokens !== undefined ? { preTokens: item.preTokens } : {}),
        ...(item.summary !== undefined ? { summary: item.summary } : {}),
        ...(item.estimatedTokensAfter !== undefined
          ? { estimatedTokensAfter: item.estimatedTokensAfter }
          : {}),
        ...(item.filesRead !== undefined ? { filesRead: item.filesRead } : {}),
        ...(item.filesModified !== undefined ? { filesModified: item.filesModified } : {}),
      };
    case "pi_ui_snapshot":
      return { ...base, kind: "extension-snapshot", state: item.state };
    default: {
      // Exhaustiveness guard: if `AgentTimelineItem` grows a new member
      // this becomes a compile error here, not a runtime throw for a
      // client on an older build that receives the new shape over the
      // wire (same pattern as `tools/view-model.ts`'s detail-type guard).
      const neverItem: never = item;
      const raw = neverItem as { type?: unknown };
      return {
        ...base,
        kind: "unknown",
        rawType: typeof raw?.type === "string" ? raw.type : "unknown",
        raw: neverItem,
      };
    }
  }
}

/**
 * Turns a `TimelineState` into a `TranscriptEntry[]`: confirmed rows
 * followed by any not-yet-reconciled optimistic rows, in the same combined
 * order `getVisibleTimelineRows` already defines (T20B). Pure and
 * deterministic — the same `TimelineState` always produces the same
 * entries, which is what makes a recorded session's entry list stable
 * across repeated runs in plain Node.
 */
export function buildTranscriptEntries(
  state: TimelineState,
  options: TranscriptViewOptions = {},
): TranscriptEntry[] {
  return getVisibleTimelineRows(state).map((row) =>
    buildTranscriptEntry(row, state.stale, options),
  );
}

/**
 * Convenience wrapper around `buildTranscriptEntries` that also carries the
 * `gap`/`stale` context a transcript renders alongside its entries (a
 * "loading more history" banner for `gap`, a "reconnecting" banner for
 * `stale`) without a caller having to read `TimelineState` directly.
 */
export function buildTranscriptView(
  state: TimelineState,
  options: TranscriptViewOptions = {},
): TranscriptView {
  return {
    entries: buildTranscriptEntries(state, options),
    gap: state.gap,
    stale: state.stale,
  };
}
