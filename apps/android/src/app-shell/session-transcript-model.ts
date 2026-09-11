/**
 * Pure composition of `timeline.TranscriptEntry[]` into the interleaved
 * render list `SessionTranscript` (`../app/h/[serverId]/session/
 * [agentId]/index.tsx`) maps over — kept out of that `.tsx`, and out of
 * the router root entirely (`router-root.test.ts` asserts the router
 * root holds only real routes and two disclosed exceptions; this is
 * neither), so this ordering decision is unit-testable under this
 * workspace's `vitest`, which cannot parse `react-native` (see
 * `CLAUDE.md`). Lives alongside `./session-route-model.ts` — the
 * session route's other pure, RN-free model module — rather than inside
 * `app/`, for the identical reason.
 *
 * T33A2's `TranscriptMessageBatcher.getState()` (`../features/transcript/
 * transcript-message-batcher.ts`) already exposes a correctly
 * time-ordered `timeline.TranscriptEntry[]` via
 * `coreTimeline.buildTranscriptEntries` — thinking and tool-call entries
 * included; only that batcher's own `getMessageEntries()`/`subscribe()`
 * narrow the result down to `user-message`/`assistant-message` rows.
 * This module's only job is selecting which entry kinds this Android
 * transcript already has a row for — `CoreMessageEntry` (T33A2's
 * `TranscriptMessageRow`), `ThinkingTranscriptEntry` (T33A3's
 * `TranscriptThinkingRow`), and `ToolCallTranscriptEntry` (T33A4's
 * `TranscriptToolCallRow`) — in one pass, preserving
 * `buildTranscriptEntries`'s own order exactly. Every other kind
 * (`error`, `compaction`, `extension-snapshot`, `todo`, `unknown`) has
 * no Android transcript row and is left out rather than rendered wrong —
 * a later task adds its own row and its own case here, not a silent drop
 * of this list's ordering guarantee.
 *
 * **T360 mounted `todo`; this task moved it out again.** CORRECTED: the
 * paragraph above used to name `todo` among the kinds with no Android
 * row, and T360 shipped `../features/transcript/todo-row.tsx` (the
 * artifact's `.ov`) and kept it IN ORDER here. The design does not put
 * it in the transcript at all: `.ovslot` is the pinned area above the
 * composer, because the widget is a standing summary of the whole turn
 * and must stay readable at any scroll position. It is therefore a
 * pinned-slot element rather than a transcript row, and this filter goes
 * back to excluding it — `selectLatestTodoEntry` below is what the
 * pinned slot reads instead. The transcript does not lose the fact a
 * todo changed; the pinned widget is redrawn from the same timeline.
 *
 * **T32S6 mounted `tool-call`.** T33A4 (P5-W9) shipped
 * `TranscriptToolCallRow`/`isToolCallEntry`
 * (`../features/transcript/tool-call-row.tsx`) in the same wave this
 * file shipped filtering it out — this filter, and `SessionTranscript`'s
 * missing branch, were the only things keeping it off screen. Both are
 * fixed here: `SessionTranscriptEntry` widened, `isToolCallEntry` added
 * to `isSessionTranscriptEntry`, and `SessionTranscript`
 * (`../app/h/[serverId]/session/[agentId]/index.tsx`) branches on
 * `entry.kind === "tool-call"`.
 *
 * Imports the four entry kinds' own RN-free model modules directly, not
 * `features/transcript`'s barrel — that barrel's `index.ts` also
 * re-exports the `.tsx` row components themselves (`thinking-row.tsx`
 * reaches `react-native-reanimated`), which would pull this otherwise
 * plain-`vitest`-safe module into the same Flow-parse failure
 * `CLAUDE.md`'s "VITEST LIMITATION" describes.
 */
import type { timeline } from "@picompanion/frontend-core";

import {
  isCoreMessageEntry,
  type CoreMessageEntry,
} from "../features/transcript/message-row-model";
import {
  isThinkingEntry,
  type ThinkingTranscriptEntry,
} from "../features/transcript/thinking-row-model";
import { isTodoEntry, type TodoTranscriptEntry } from "../features/transcript/todo-row-model";
import {
  isToolCallEntry,
  type ToolCallTranscriptEntry,
} from "../features/transcript/tool-call-row-model";

export type SessionTranscriptEntry =
  | CoreMessageEntry
  | ThinkingTranscriptEntry
  | ToolCallTranscriptEntry;

/** `true` for the three entry kinds this route renders a transcript row for. */
export function isSessionTranscriptEntry(
  entry: timeline.TranscriptEntry,
): entry is SessionTranscriptEntry {
  return isCoreMessageEntry(entry) || isThinkingEntry(entry) || isToolCallEntry(entry);
}

/**
 * Filters `entries` (already time-ordered by `buildTranscriptEntries`)
 * down to the message, thinking and tool-call rows this route knows how
 * to render, in the same order — never re-sorted, never grouped by
 * kind.
 */
export function buildSessionTranscriptEntries(
  entries: readonly timeline.TranscriptEntry[],
): SessionTranscriptEntry[] {
  return entries.filter(isSessionTranscriptEntry);
}

/**
 * The newest `todo` entry in a time-ordered timeline, or `null` when
 * there is none — what the pinned `.ov` widget draws. Scans from the
 * end, so it reports the agent's LATEST revision of its plan rather than
 * the first one this client happened to see. Kept here, beside the
 * transcript filter, because both answer the same question (which entry
 * kinds the session route draws, and where).
 */
export function selectLatestTodoEntry(
  entries: readonly timeline.TranscriptEntry[],
): TodoTranscriptEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry !== undefined && isTodoEntry(entry)) return entry;
  }
  return null;
}
