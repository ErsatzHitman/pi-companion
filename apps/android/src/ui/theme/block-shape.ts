/**
 * The one block shape the redesigned session screen draws everything in
 * (T356) — the artifact's `.blk`.
 *
 * The design artifact's `.blk` gives it once and then reuses it for
 * every kind of thing the screen stacks. Quoting the artifact's own
 * CSS, which is the authority for every figure below:
 *
 * ```css
 * .blk { border-radius: 14px; padding: 9px 11px; box-shadow: var(--sh-hairline); }
 * .t   { padding: 12px 12px 4px; gap: 9px; }
 * .blk.usr { background: var(--accent-tint); box-shadow: none; }
 * ```
 *
 * `usr` is a prompt the user sent, `pend` one still queued, `ok` and
 * `err` a tool call that finished either way, `ext` an extension's own
 * element. A user prompt in the composer's queue and the same prompt in
 * the transcript are the same shape, which is the whole point of the
 * design having one.
 *
 * ## Why this lives in `ui/theme` and not in a feature
 *
 * T355 put the geometry in `features/composer/entry-block-model.ts`,
 * which was right while the composer's entry list was the only thing
 * using it. It is not any more: the transcript's tool cards, its
 * messages and the extension elements all draw the same block, and
 * three features reaching into a fourth feature's model is the shape
 * this repository's own layering rules exist to prevent. The numbers
 * and the surface table live here; each feature keeps its own mapping
 * from ITS domain (an entry status, a tool status) onto a `BlockKind`,
 * because that mapping is a feature decision and this file should not
 * know what a `ComposerEntryStatus` is.
 *
 * RN-free and theme-free: `blockSurface` returns a `theme.colors` KEY,
 * never a colour, so no product colour is written down outside
 * `@picompanion/design-tokens` and every function here is provable by
 * execution rather than by a source-regex pin.
 */

/** Radius of every block (`.blk`'s `border-radius: 14px`). */
export const BLOCK_RADIUS = 14;
/** `.blk`'s `padding: 9px 11px`, in the artifact's own order. */
export const BLOCK_PADDING_VERTICAL = 9;
export const BLOCK_PADDING_HORIZONTAL = 11;
/** `.t`'s `gap: 9px` — the space between stacked blocks. */
export const BLOCK_GAP = 9;

/**
 * What a block IS. Named after the artifact's own class suffixes where
 * it has one (`usr`, `pend`, `ok`, `err`, `ext`); `assistant` is this
 * app's addition, for the one case the artifact draws with no fill at
 * all — see `blockSurface` below.
 */
export type BlockKind = "user" | "assistant" | "pending" | "tool-ok" | "tool-error" | "extension";

/**
 * The `theme.colors` key a block's background reads from, or `null` for
 * a block that is deliberately unfilled.
 *
 * `assistant` is the `null` case, and that is a design fact rather than
 * an omission: the artifact's transcript draws the model's own prose as
 * bare text on the canvas, with only the user's prompts, the tool calls
 * and the extension elements boxed. Filling assistant text too would
 * make the transcript a wall of boxes and lose exactly the contrast the
 * boxes are for.
 */
export type BlockSurfaceToken =
  | "accent-tint"
  | "inset"
  | "tool-success-bg"
  | "tool-error-bg"
  | "extension-bg";

export function blockSurface(kind: BlockKind): BlockSurfaceToken | null {
  switch (kind) {
    case "user":
      // `.blk.usr { background: var(--accent-tint) }` — the user's own
      // prompt is the one block tinted with the accent, so a reader can
      // find what they sent in a wall of tool output.
      return "accent-tint";
    case "assistant":
      return null;
    case "pending":
      return "inset";
    case "tool-ok":
      return "tool-success-bg";
    case "tool-error":
      return "tool-error-bg";
    case "extension":
      return "extension-bg";
  }
}

/**
 * `true` when a block is outlined as well as filled, and the
 * `theme.colors` key to outline it in.
 *
 * Only the error block is. An outline is the cheapest way to make the
 * one block that needs an action findable in a stack of otherwise
 * identical ones, and spending it everywhere would make it mean
 * nothing. It is always drawn beside text that already says what
 * happened, never instead of it (plan.md §10.5).
 */
export type BlockOutlineToken = "red";

export function blockOutline(kind: BlockKind): BlockOutlineToken | null {
  return kind === "tool-error" ? "red" : null;
}

/**
 * `true` when a block carries the artifact's own hairline ring —
 * `.blk`'s `box-shadow: var(--sh-hairline)` — and the `theme.colors`
 * key to draw it in.
 *
 * Every FILLED block except `usr` has one (`.blk.usr` is the one rule
 * that turns it off), and so does every unfilled outline this app
 * draws a border on. It is drawn as a 1px `line` border rather than a
 * shadow because React Native has no hairline box-shadow and a 1px
 * border is the same pixel at the same weight on both platforms.
 *
 * Two kinds return `null` here for two different reasons, and a caller
 * must not read either as "this block has no border": `user` draws
 * none at all, exactly as the artifact specifies, while `tool-error`'s
 * single border is claimed by `blockOutline` above (a block can only
 * have one border colour, and the error's is the red one).
 */
export type BlockRingToken = "line";

export function blockRing(kind: BlockKind): BlockRingToken | null {
  switch (kind) {
    case "user":
      return null;
    case "assistant":
      // Not a block at all — the model's prose is bare text on the
      // canvas, so there is no box to ring.
      return null;
    case "tool-error":
      return null;
    case "pending":
    case "tool-ok":
    case "extension":
      return "line";
  }
}
