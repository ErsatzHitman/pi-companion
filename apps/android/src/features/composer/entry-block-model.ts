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
export const ENTRY_BLOCK_RADIUS = 14;
/** `.blk` padding, in the artifact's own order (9px top/bottom, 12px left/right). */
export const ENTRY_BLOCK_PADDING_VERTICAL = 9;
export const ENTRY_BLOCK_PADDING_HORIZONTAL = 12;
/** `.blk`'s `margin: 10px 0` — expressed as the gap between stacked blocks. */
export const ENTRY_BLOCK_GAP = 10;

/**
 * The `theme.colors` key a block's background reads from. A key rather
 * than a colour, so this module stays RN-free and theme-free and no
 * product colour is ever written down outside `@picompanion/design-tokens`.
 */
export type EntryBlockSurface = "field" | "inset" | "tool-error-bg";

export function entryBlockSurface(status: ComposerEntryStatus): EntryBlockSurface {
  switch (status) {
    case "sent":
      return "field";
    case "pending":
      return "inset";
    case "failed":
      return "tool-error-bg";
  }
}

/**
 * `true` when a block should be outlined as well as filled. Only the
 * failed one is: an outline is the cheapest way to make the one block
 * that needs an action findable at a glance, and spending it on all
 * three would make it mean nothing. The outline is drawn in `red`,
 * beside a chip that already reads "Failed".
 */
export function entryBlockIsOutlined(status: ComposerEntryStatus): boolean {
  return status === "failed";
}
