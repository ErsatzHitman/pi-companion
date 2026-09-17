/**
 * Streaming caret/blur identity for the two entry kinds plan.md §11.1
 * names as arriving incrementally ("assistant text and thinking
 * deltas"): a solid caret while an assistant line is still being appended to, a resting
 * blink once it settles, and — the cross-row rule this module exists to
 * enforce — the previous block's settled caret is retired the instant the
 * next stream opens, so at most one line in a transcript is ever "live" at
 * once.
 *
 * `apps/android/src/ui/recipes/StreamingMessage.tsx` (the caret/blur CSS
 * treatment) and `apps/android/src/features/transcript/thinking-row.tsx`
 * (the `live`-dependent elapsed readout and shimmer) both already accept a
 * boolean for exactly this; what neither app ever computed was *which*
 * entry's id that boolean should be true for. This module is that one
 * shared answer, so `apps/web` and `apps/android` derive it identically
 * rather than each guessing at the cross-row rule on its own.
 *
 * Repository invariant: this module must never import React, React Native,
 * Expo, DOM types, or browser globals.
 */
import type { TranscriptEntry } from "./transcript-view.js";

/**
 * Returns the `id` of the transcript entry that should render as
 * currently streaming, or `null` when nothing is.
 *
 * `turnActive === false` always answers `null`: a settled transcript has no
 * live line, regardless of what its last entry's `kind` is.
 *
 * Otherwise only the LAST entry of `entries` is ever considered. This is
 * the retire-the-previous-caret rule stated positively rather than as a
 * convention every call site has to remember: once a tool call, a todo
 * update, or an error lands after the assistant's text, that text has
 * settled — the daemon has moved on to something else, whether or not the
 * turn as a whole is still running — so it is no longer the row receiving
 * deltas. Looking only at the tail entry makes "at most one live entry"
 * true by construction, not by every renderer independently agreeing not
 * to light up an earlier row.
 *
 * The last entry counts only when its `kind` is `"assistant-message"` or
 * `"thinking"` — the two kinds this domain's `StreamText` treatment
 * applies to (plan.md §11.1). A trailing `user-message`, `tool-call`,
 * `todo`, `error`, `compaction`, `extension-snapshot`, or `unknown` entry
 * answers `null`: none of those kinds render a caret.
 *
 * `turnActive` is a required parameter rather than something derived from
 * `entries` itself. This was measured, not assumed: no field on
 * `TranscriptEntry` distinguishes "the assistant is still appending to
 * this row" from "this row is simply the last thing said". The closest
 * candidate, `TranscriptEntryBase.pending`, is documented as the LOCAL
 * optimistic-row flag for a user message awaiting daemon reconciliation —
 * it goes `false` as soon as the daemon acks the user's own message, which
 * happens well before the assistant has even started its reply, let alone
 * finished streaming it. So the entry list alone can never answer this
 * question, which is exactly why this rule was never wired anywhere before:
 * a caller has to bring its own turn-boundary signal (e.g. `apps/android`'s
 * `turn-running-signal.ts`, built from real `turn_started`/
 * `turn_completed`/`turn_failed`/`turn_canceled` wire events) and hand it
 * in here.
 *
 * The returned value is the entry's `id`, deliberately never its `key`.
 * The two call sites this function feeds both compare against `.id` —
 * web's existing `entry.id === streamingEntryId` in `transcript.tsx`, and
 * the Android `entry.id === streamingEntryId` this module's own consumer
 * writes — and `id` is unique within one entry list, so it identifies a
 * specific entry exactly as well as `key` would. `TranscriptEntryBase`'s
 * own doc comment is explicit that `key` is "the field to key a RENDERED
 * LIST by", i.e. React/`FlatList` reconciliation identity, which survives
 * pagination and coalescing; what this function does is an identity
 * comparison ("is this the one live row"), not a list key, so reaching for
 * `key` here would be borrowing the wrong field for the job.
 */
export function streamingTranscriptEntryId(
  entries: readonly TranscriptEntry[],
  turnActive: boolean,
): string | null {
  if (!turnActive || entries.length === 0) {
    return null;
  }
  const last = entries[entries.length - 1];
  if (last.kind === "assistant-message" || last.kind === "thinking") {
    return last.id;
  }
  return null;
}
