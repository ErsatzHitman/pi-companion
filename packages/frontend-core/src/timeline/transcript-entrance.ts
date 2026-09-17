/**
 * Transcript turn-entrance watermark (W12-ENTRANCE) — the one shared rule
 * behind the android spec's `@keyframes fade-up{from{opacity:0;transform:
 * translateY(8px)}to{opacity:1;transform:none}}`, applied to `.t>*` (every
 * direct child of the transcript) as `animation:fade-up .32s cubic-bezier(
 * .23,1,.32,1) both`, with the spec's own script staggering arrivals by
 * `STAGGER=120`ms.
 *
 * `apps/web`'s `transcript.tsx` (`enteringFromRowRef` / `enteredRowCountRef`
 * / `enteringStaggerBase`) already proved this rule out against a real
 * virtualizing list and documents the defect its first version shipped
 * with; this module is that same rule, ported so `apps/android`'s own
 * virtualizing `FlatList` can reuse it rather than re-deriving it (and
 * re-discovering the same defect) on its own.
 *
 * ## The hazard this module exists to avoid
 *
 * A virtualizing list (web's `@tanstack/react-virtual`, Android's
 * `FlatList`) mounts and unmounts rows as the window moves. Keying the
 * entrance animation off a row's POSITION (`:nth-child`, a `FlatList`
 * cell's recycled slot) is wrong for exactly this reason: the same
 * rendered slot is reused for many different logical entries as the list
 * scrolls, so a naive implementation replays the fade-up every time an
 * old row scrolls back into view — worse than no entrance animation at
 * all. The fix is a **watermark**: a boundary index below which every row
 * has already been seen, advanced only when the transcript actually grows
 * (the row count changes), never by scroll position.
 *
 * ## Why this is a count, not a set of seen indices
 *
 * The transcript only ever grows (rows are appended, never removed or
 * reordered ahead of the watermark), so any index below the count as it
 * stood before the current batch was necessarily rendered already. A
 * single number captures that exactly as well as a `Set` of every index
 * ever seen would, at O(1) instead of O(n) per advance.
 *
 * ## Why the advance happens once per batch, and must be idempotent
 *
 * A caller (a component's render body) may run this more than once for
 * the same underlying state change — React's own double-invoke in
 * StrictMode, or a virtualizing list re-rendering several times for one
 * logical arrival before anything paints. `advanceTranscriptEntranceWatermark`
 * only opens a new batch when `totalRowCount` differs from the state's own
 * `settledRowCount`; called again with the same `totalRowCount`, it
 * returns a value equal to its input, so replaying it is always safe.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */

/**
 * The spec's own `STAGGER` script constant: the per-row delay step between
 * one entering row and the next, in milliseconds.
 */
export const TRANSCRIPT_ENTRANCE_STAGGER_MS = 120;

/**
 * The measured cap on the stagger delay, in milliseconds — `6 *
 * TRANSCRIPT_ENTRANCE_STAGGER_MS`. Web's implementation found that keying
 * the stagger to a row's ABSOLUTE transcript index (rather than its
 * position within the current entrance batch) drove every turn past the
 * seventh to this same flat delay regardless of how long the transcript
 * had grown — a single new turn arriving late in a long session would sit
 * invisible for the better part of a second before appearing. This module
 * avoids that by measuring stagger position relative to
 * `TranscriptEntranceWatermark.settledRowCount` (see
 * `transcriptEntranceDelayMs` below), so the cap is reached only by a
 * genuinely large single batch, never by transcript length.
 */
export const TRANSCRIPT_ENTRANCE_STAGGER_CAP_MS = TRANSCRIPT_ENTRANCE_STAGGER_MS * 6;

/**
 * The watermark state a caller holds (in a ref, across renders — see this
 * module's own doc comment for why an effect cannot substitute for a
 * render-phase advance). `settledRowCount` is the row count as of the most
 * recent advance; `enteringFromRow` is the first absolute row index that
 * belongs to the batch currently entering.
 */
export interface TranscriptEntranceWatermark {
  readonly enteringFromRow: number;
  readonly settledRowCount: number;
}

/**
 * The initial watermark, before any batch has ever been observed: nothing
 * has settled yet, so the very first batch treats `enteringFromRow` as
 * `0` (see `advanceTranscriptEntranceWatermark` below).
 */
export const INITIAL_TRANSCRIPT_ENTRANCE_WATERMARK: TranscriptEntranceWatermark = {
  enteringFromRow: 0,
  settledRowCount: -1,
};

/**
 * Advances the watermark for the current row count. Opens a new entrance
 * batch — `enteringFromRow` becomes the row count as it stood for the
 * PREVIOUS batch — only when `totalRowCount` differs from
 * `state.settledRowCount`; called again with an unchanged `totalRowCount`
 * it returns `state` itself (not merely an equal value — the same
 * reference, so a caller can skip a state update on no-op advances),
 * which is what makes this safe to call unconditionally, every render,
 * without guarding the call site.
 *
 * The very first call (`state.settledRowCount < 0`, i.e. still
 * `INITIAL_TRANSCRIPT_ENTRANCE_WATERMARK`) treats `enteringFromRow` as `0`
 * rather than as the sentinel `-1`, so the transcript's very first batch
 * of rows is itself treated as entering.
 */
export function advanceTranscriptEntranceWatermark(
  state: TranscriptEntranceWatermark,
  totalRowCount: number,
): TranscriptEntranceWatermark {
  if (totalRowCount === state.settledRowCount) {
    return state;
  }
  const enteringFromRow = state.settledRowCount < 0 ? 0 : state.settledRowCount;
  return { enteringFromRow, settledRowCount: totalRowCount };
}

/**
 * Answers the stagger delay, in milliseconds, for the row at absolute
 * index `rowIndex`, given the watermark's current `enteringFromRow` — or
 * `null` when the row is not part of the entering batch at all (it settled
 * in an earlier batch), so a caller can never mistake "not entering" for
 * "entering with a zero delay".
 *
 * The delay is relative to the BATCH (`rowIndex - enteringFromRow`), never
 * to the row's absolute transcript position — see
 * `TRANSCRIPT_ENTRANCE_STAGGER_CAP_MS`'s own doc comment for the shipped
 * defect this guards against. The first entering row always answers `0`,
 * the second answers `TRANSCRIPT_ENTRANCE_STAGGER_MS`, and so on, capped at
 * `TRANSCRIPT_ENTRANCE_STAGGER_CAP_MS`.
 */
export function transcriptEntranceDelayMs(
  rowIndex: number,
  enteringFromRow: number,
): number | null {
  if (rowIndex < enteringFromRow) {
    return null;
  }
  return Math.min(
    Math.max(rowIndex - enteringFromRow, 0) * TRANSCRIPT_ENTRANCE_STAGGER_MS,
    TRANSCRIPT_ENTRANCE_STAGGER_CAP_MS,
  );
}
