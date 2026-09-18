/**
 * The one block shape the redesigned session screen draws everything in
 * (T356) — the confirmed spec's `.blk`.
 *
 * (CORRECTED: this comment used to quote the CSS below as "the artifact's
 * own CSS, which is the authority for every figure below" —
 *
 * ```css
 * .blk { border-radius: 14px; padding: 9px 11px; box-shadow: var(--sh-hairline); }
 * .t   { padding: 12px 12px 4px; gap: 9px; }
 * .blk.usr { background: var(--usr-bg); box-shadow: none; }
 * ```
 *
 * — but that is `docs/ui-reference/pi-companion-app.html`'s stale
 * reconstruction, not the confirmed design: `grep -c -- '--sh-hairline'`
 * returns 9 there and 0 over the confirmed spec,
 * `C:/Users/aksha/Downloads/pi-ui-goal/android-spec.html`. The confirmed
 * spec is the real authority; its own text, read directly out of the
 * file, is:)
 *
 * ```css
 * .blk { border-radius: var(--r-blk); padding: 9px 12px; margin: 10px 0; }
 * .t   { flex: 1; min-height: 0; overflow: auto; padding: 4px 10px 10px;
 *        font: 12.5px/1.62 'JetBrains Mono', ui-monospace, monospace;
 *        scrollbar-width: thin; }
 * .blk.usr { background: var(--usr-bg); }
 * ```
 *
 * `--r-blk` is `14px` — the one figure the stale reconstruction happened
 * to get right. There is no `box-shadow` and no `border` on `.blk`
 * anywhere in the confirmed spec, in any state, not even `.blk.err` — see
 * `blockRing` below for what that means for the hairline ring this file
 * used to draw. `.blk`'s own `margin: 10px 0` (not a `gap` on `.t`,
 * which the confirmed spec never declares) is the real source of the
 * space between stacked blocks: adjacent blocks' 10px top/bottom margins
 * collapse to a single 10px in the reference's own box model, which
 * `BLOCK_GAP` below reproduces as a single number.
 *
 * `--usr-bg` is itself `var(--field)` (the artifact's own comment on that
 * declaration reads `userMessageBg #343541`) — the confirmed design paints
 * the user block on the same surface role `TextField`/`TextArea`/`SearchField`
 * already draw their own fields on, not on the accent tint. `blockSurface`
 * below returns `"field"`, the `theme.colors` key that resolves to, for
 * exactly that reason.
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

/** Radius of every block (`.blk`'s `border-radius: var(--r-blk)`, `14px`). */
export const BLOCK_RADIUS = 14;
/** `.blk`'s `padding: 9px 12px`, in the confirmed spec's own order.
 * (CORRECTED: this was `11`, docs/ui-reference/pi-companion-app.html's
 * stale `9px 11px` — see the module doc comment above.) */
export const BLOCK_PADDING_VERTICAL = 9;
export const BLOCK_PADDING_HORIZONTAL = 12;
/** The space between stacked blocks — `.blk`'s own `margin: 10px 0`
 * collapsing between adjacent siblings, not a `gap` on `.t` (the
 * confirmed spec's `.t` declares none). (CORRECTED: this was `9`, quoting
 * docs/ui-reference/pi-companion-app.html's stale `.t { gap: 9px }` — see
 * the module doc comment above.) */
export const BLOCK_GAP = 10;

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
  | "field"
  | "inset"
  | "tool-success-bg"
  | "tool-error-bg"
  | "extension-bg";

export function blockSurface(kind: BlockKind): BlockSurfaceToken | null {
  switch (kind) {
    case "user":
      // `.blk.usr { background: var(--usr-bg) }`, and `--usr-bg:
      // var(--field)` — the user's own prompt sits on the same field
      // surface every text input does, not on the accent tint.
      return "field";
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
 * Always `null`: the confirmed spec draws no ring, shadow, or border on
 * `.blk`, in any state — not `pending`, not `tool-ok`, not `extension`,
 * not even `tool-error` (whose own red outline is `blockOutline` above,
 * a separate and independently-justified decision this correction does
 * not touch — see that function's own doc comment).
 *
 * (CORRECTED: this function used to return `"line"` for every filled
 * kind except `usr`, and this comment used to justify it as "the
 * artifact's own hairline ring — `.blk`'s `box-shadow: var(
 * --sh-hairline)`", explaining only WHY it was drawn as an RN border
 * rather than a CSS box-shadow, never independently why a ring should
 * exist at all. That rule, and the `--sh-hairline` token it names, exist
 * only in `docs/ui-reference/pi-companion-app.html`'s stale
 * reconstruction — `grep -c -- '--sh-hairline'` returns 9 there and 0
 * over the confirmed spec, `C:/Users/aksha/Downloads/pi-ui-goal/
 * android-spec.html`. Because the only reason ever given was matching
 * that reference, and the reference was the wrong one, there is no
 * accessibility, contrast, or dark-theme legibility constraint this
 * correction regresses — this function's own prior text is the entire
 * justification that existed, and it named no such constraint.)
 *
 * Kept as a function, not deleted, and `BlockRingToken` kept as a type:
 * both are still called across `tool-call-row.tsx` in this same package
 * and, in other packages this task does not own,
 * `apps/android/src/features/composer/entry-block-model.ts` and
 * `apps/android/src/ui/recipes/StreamingMessage.tsx`. Their two calls in
 * `StreamingMessage.tsx` were already always `null` (`"user"`/
 * `"assistant"`, both already-null kinds) and are unaffected;
 * `entry-block-model.ts`'s `entryBlockRing("pending")` was `"line"` and
 * is now `null` too — a real behaviour change in a file this task may
 * only read, reported rather than resolved here.
 */
export type BlockRingToken = "line";

export function blockRing(_kind: BlockKind): BlockRingToken | null {
  return null;
}
