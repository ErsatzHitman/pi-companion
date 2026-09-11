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
 * `TranscriptToolCallRow`), and `TodoTranscriptEntry` (T360's
 * `TranscriptTodoRow`) — in one pass, preserving
 * `buildTranscriptEntries`'s own order exactly. Every other kind
 * (`error`, `compaction`, `extension-snapshot`, `unknown`) has no Android
 * row yet and is left out rather than rendered wrong — a later task adds
 * its own row and its own case here, not a silent drop of this list's
 * ordering guarantee.
 *
 * **T360 mounted `todo`.** CORRECTED: the paragraph above used to name
 * `todo` among the kinds with no Android row. That was true until T360
 * shipped `../features/transcript/todo-row.tsx` — the artifact's `.ov`
 * widget — and this filter was, exactly as that sentence predicted of
 * `tool-call` one wave earlier, the only thing keeping it off screen.
 * The todo entry stays IN ORDER here rather than being hoisted to a
 * pinned position at the top of the transcript: the daemon emits a new
 * todo row every time the list changes, so where it sits is when the
 * agent last revised its plan, and moving it would lose that.
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
 * Imports the three entry kinds' own RN-free model modules directly, not
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
  | ToolCallTranscriptEntry
  | TodoTranscriptEntry;

/** `true` for the four entry kinds this route renders a row for. */
export function isSessionTranscriptEntry(
  entry: timeline.TranscriptEntry,
): entry is SessionTranscriptEntry {
  return (
    isCoreMessageEntry(entry) ||
    isThinkingEntry(entry) ||
    isToolCallEntry(entry) ||
    isTodoEntry(entry)
  );
}

/**
 * Filters `entries` (already time-ordered by `buildTranscriptEntries`)
 * down to the message, thinking, tool-call and todo rows this route knows
 * how to render, in the same order — never re-sorted, never grouped by
 * kind.
 */
export function buildSessionTranscriptEntries(
  entries: readonly timeline.TranscriptEntry[],
): SessionTranscriptEntry[] {
  return entries.filter(isSessionTranscriptEntry);
}
