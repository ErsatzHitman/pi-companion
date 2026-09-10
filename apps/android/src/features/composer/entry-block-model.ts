import {
  BLOCK_GAP,
  BLOCK_PADDING_HORIZONTAL,
  BLOCK_PADDING_VERTICAL,
  BLOCK_RADIUS,
  blockOutline,
  blockSurface,
  type BlockKind,
} from "../../ui/theme/block-shape";
import type { ComposerEntryStatus } from "./composer-model";

/**
 * The composer's queued-entry blocks (T355) — the redesign's `.blk`.
 *
 * The artifact draws everything the session screen stacks as one block
 * shape: radius 14, padding 9×12, 10 between blocks, and a background
 * that says what KIND of thing it is — `.usr` on `field` for a prompt
 * the user sent, `.pend` on `inset` for one still queued, `.err` on
 * `tool-error-bg` for one that failed. The composer's own entry list
 * used to be a flat row per entry with a chip on the right; this module
 * is the part of turning it into that block shape that can be proven
 * without rendering.
 *
 * RN-free on purpose, like every `-model.ts` beside it: the mapping
 * below is the whole decision, and it is worth a real behavioural test
 * rather than a source-regex pin.
 *
 * **T356 moved the shape itself out of this file.** The geometry and
 * the surface table now live in `../../ui/theme/block-shape.ts`,
 * because the transcript's tool cards, its messages and the extension
 * elements draw the same block and three features reaching into a
 * fourth feature's model is the layering this repository's own rules
 * exist to prevent. What stays here is the part that is genuinely the
 * composer's: which `BlockKind` a `ComposerEntryStatus` is. The
 * constants below are re-exported unchanged so nothing that already
 * imported them had to move.
 *
 * ## Why `failed` is its own surface and not just a red chip
 *
 * The chip already says "Failed" in words, so the surface is not
 * carrying the meaning alone (plan.md §10.5) — but a failed entry is
 * the one entry in the list that needs an action from the reader, and
 * it is the one the eye has to find in a stack of otherwise identical
 * blocks. `tool-error-bg` is the token the transcript already uses for
 * exactly that, so the composer borrows it rather than inventing a
 * fourth surface. `.usr` and `.pend` are the artifact's own two names.
 */

/** Radius of every block the redesign draws (`.blk`). */
export const ENTRY_BLOCK_RADIUS = BLOCK_RADIUS;
/** `.blk` padding, in the artifact's own order (9px top/bottom, 12px left/right). */
export const ENTRY_BLOCK_PADDING_VERTICAL = BLOCK_PADDING_VERTICAL;
export const ENTRY_BLOCK_PADDING_HORIZONTAL = BLOCK_PADDING_HORIZONTAL;
/** `.blk`'s `margin: 10px 0` — expressed as the gap between stacked blocks. */
export const ENTRY_BLOCK_GAP = BLOCK_GAP;

/**
 * The `theme.colors` key a block's background reads from. A key rather
 * than a colour, so this module stays RN-free and theme-free and no
 * product colour is ever written down outside `@picompanion/design-tokens`.
 */
export type EntryBlockSurface = "field" | "inset" | "tool-error-bg";

/** Which kind of block one entry status is. The composer's own decision, hence its home here. */
export function entryBlockKind(status: ComposerEntryStatus): BlockKind {
  switch (status) {
    case "sent":
      return "user";
    case "pending":
      return "pending";
    case "failed":
      return "tool-error";
  }
}

export function entryBlockSurface(status: ComposerEntryStatus): EntryBlockSurface {
  // Never `null` for any entry status: every kind above is a filled
  // one, and only `assistant` — which no entry can be — is unfilled.
  return blockSurface(entryBlockKind(status)) as EntryBlockSurface;
}

/**
 * `true` when a block should be outlined as well as filled. Only the
 * failed one is: an outline is the cheapest way to make the one block
 * that needs an action findable at a glance, and spending it on all
 * three would make it mean nothing. The outline is drawn in `red`,
 * beside a chip that already reads "Failed".
 */
export function entryBlockIsOutlined(status: ComposerEntryStatus): boolean {
  return blockOutline(entryBlockKind(status)) !== null;
}
