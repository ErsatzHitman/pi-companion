/**
 * Android's MD3 Expressive radius scale (A-SHAPE) — the design artifact's
 * `--r-*` custom properties:
 *
 * ```css
 * :root{
 *   --r-xs:10px; --r-sm:16px; --r-md:22px; --r-lg:28px; --r-full:9999px;
 *   --r-blk:14px;
 * }
 * .ic{...border-radius:var(--r-full)}
 * .chip{...border-radius:var(--r-full)}
 * .pill{...border-radius:var(--r-full)}
 * .fp{...border-radius:var(--r-full)}
 * .cmp-box{...border-radius:var(--r-full)}
 * .sw{...border-radius:var(--r-full)}
 * ```
 *
 * `.ic`, `.chip`, `.pill`, `.fp`, `.cmp-box` and `.sw` are all drawn at
 * `--r-full` — every piece of app chrome is a full pill. `--r-blk` is the
 * one point on this scale that is NOT chrome: it is the transcript block
 * shape (`./block-shape.ts`'s `BLOCK_RADIUS`), and this module reads that
 * constant rather than repeating its own `14` so the two can never drift
 * apart silently.
 *
 * ## Android only — the web spec does not get this scale
 *
 * The shared `radii` scale in `packages/design-tokens/src/tokens.ts`
 * (`chip 6 / control 8 / card 10 / window 14`) **must not change**: the
 * web spec measures 8px controls, so the two surfaces genuinely diverge,
 * and this module exists specifically so that divergence has an
 * Android-only home instead of pressure to retune the shared scale.
 *
 * The design artifact states its own rationale for the split: expressive
 * on the chrome, restrained on the transcript, because Pi's blocks are
 * rectangles whose `├─` tree glyphs and diff gutters read by alignment,
 * and a 22px corner fights them. `--r-full` (a true pill on any square,
 * regardless of side length) already coincides with the shared scale's
 * `radii.full: 9999` and needs no Android-only entry of its own; the
 * primitives in `../primitives` read `theme.radii.full` directly for
 * exactly that reason. This module supplies the OTHER four points
 * (`xs`/`sm`/`md`/`lg`) plus `blk`, for callers that draw outside the
 * `--r-full` chrome — the composer's `.fp`/`.cmp-box` metadata pills and
 * prompt box, and any card/overlay/dense-chip surface a later package
 * adds. None of those callers live in this package (A-SHAPE); this module
 * is the shared numeric source they will read from.
 *
 * RN-free and theme-free, in the same sense `block-shape.ts` is: this
 * file exports numbers and a plain object mapping, never a colour or a
 * component, so every figure here is provable by execution rather than by
 * a source-regex pin.
 */
import { BLOCK_RADIUS } from "./block-shape";

/** The design artifact's own token names for each point on this scale. */
export type ExpressiveRadiusToken = "xs" | "sm" | "md" | "lg" | "full" | "blk";

/** `--r-xs:10px` — the dense chip / menu-row corner. */
export const EXPRESSIVE_RADIUS_XS = 10;
/** `--r-sm:16px` — the snackbar corner. */
export const EXPRESSIVE_RADIUS_SM = 16;
/** `--r-md:22px` — the card / list-row corner. */
export const EXPRESSIVE_RADIUS_MD = 22;
/** `--r-lg:28px` — the overlay / popover corner. */
export const EXPRESSIVE_RADIUS_LG = 28;
/** `--r-full:9999px` — a true pill regardless of the element's own size. */
export const EXPRESSIVE_RADIUS_FULL = 9999;
/**
 * `--r-blk:14px` — already equal to the shared `radii.window` alias and
 * to `block-shape.ts`'s own `BLOCK_RADIUS`. Read from that export rather
 * than repeating the literal `14`, so a future change to the block shape
 * cannot silently leave this scale's `blk` point contradicting it.
 */
export const EXPRESSIVE_RADIUS_BLK: number = BLOCK_RADIUS;

/**
 * The same six numbers above, keyed by the artifact's own `--r-*` token
 * names, for a caller that has a token name rather than a specific
 * constant in hand (the shape `theme.radii` itself takes, one scale
 * over).
 */
export const EXPRESSIVE_RADII: Readonly<Record<ExpressiveRadiusToken, number>> = {
  xs: EXPRESSIVE_RADIUS_XS,
  sm: EXPRESSIVE_RADIUS_SM,
  md: EXPRESSIVE_RADIUS_MD,
  lg: EXPRESSIVE_RADIUS_LG,
  full: EXPRESSIVE_RADIUS_FULL,
  blk: EXPRESSIVE_RADIUS_BLK,
};
