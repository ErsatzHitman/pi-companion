/**
 * Android's MD3 Expressive motion numbers (A-MOTION) — the design
 * artifact's own `transition`/`animation`/`@keyframes` rules, read
 * directly from its committed CSS rather than approximated from the
 * shared Beautiful UI `motion` tokens in `@picompanion/design-tokens`.
 *
 * ## Why this module exists, and why it is separate from `motion`
 *
 * `packages/design-tokens`'s `motion` table (durations 100/150/…/600ms,
 * a handful of `ease-out`-shaped curves, one flat `pressScale: 0.96`) is
 * Beautiful UI's own signature, and it is correct as it stands — nothing
 * here edits it, and nothing here should. The Android design artifact
 * layers a SECOND, genuinely different motion language on top of it: a
 * spring with visible overshoot for every press (`cubic-bezier(.34,1.7,
 * .5,1)` — the `1.7` control point is >1, which is what produces the
 * overshoot; no curve in the shared table does this), a 3×3 pixel grid
 * loader with its own asymmetric keyframe shape, and a handful of named
 * keyframes (`pop-in`, `records-pulse`, `fade-up`) the shared table has
 * no entries for at all. Exactly the split `./expressive-shape.ts`
 * already made for the Android radius scale, applied here to motion.
 *
 * RN-free and theme-free, in the same sense `expressive-shape.ts` is:
 * this file exports numbers, cubic-bezier tuples and plain object
 * mappings, never a component or a Reanimated call, so every claim made
 * about a curve or a duration is provable by importing and asserting on
 * it directly rather than by grepping a component's source text.
 *
 * ## What is wired up this wave, and what is only recorded here
 *
 * `EXPRESSIVE_PRESS_SPRING_*` and `EXPRESSIVE_PRESS_SCALE.icon` drive
 * `./use-press-scale.ts`'s `"icon"` variant, consumed by
 * `../primitives/IconButton.tsx` and `../recipes/ScreenBar.tsx`.
 * `EXPRESSIVE_PIXEL_*` drives `../recipes/PixelLoader.tsx` in full.
 * `EXPRESSIVE_CARET_BLINK_DURATION_MS` is recorded but NOT wired to an
 * animation — see `../recipes/StreamingMessage.tsx`'s own doc comment
 * for why the "blinks at rest" phase needs session-level state this
 * package does not own.
 *
 * The remaining exports (`EXPRESSIVE_PRESS_SCALE`'s five other targets,
 * `EXPRESSIVE_POP_IN_*`, `EXPRESSIVE_RECORDS_PULSE_*`, every
 * `EXPRESSIVE_FADE_UP_*` export) have no consumer in this package today.
 * `.scr-btn`, `.pbtn`, `.row`, `.chip`, `.blk`/`.bash`/`.ov`, `.fp`,
 * `.dchip`/`.att`/`.dprev` and `.pill.run .dot` all live in files
 * A-MOTION does not own (a navigation rail, the prompt bar's own
 * buttons, transcript block chrome, the composer's file pills, tool-call
 * detail chips, and the status pill's running dot). `fade-up`'s own
 * intended consumer, the transcript turn's entrance (the artifact's
 * `.t>*`), IS a file this package owns — `../recipes/StreamingMessage.tsx`
 * — but is deliberately NOT wired there this wave; see that file's own
 * doc comment for why. All of these are recorded here anyway, exactly as
 * `expressive-shape.ts` recorded `xs`/`sm`/`md`/`lg` before any caller
 * needed them, so the next package (or task) that draws one of these
 * elements has a measured number to read instead of a fresh guess at the
 * source CSS.
 */

/** A CSS-style cubic-bezier control-point tuple: `[x1, y1, x2, y2]`. */
export type CubicBezier = readonly [number, number, number, number];

// ---------------------------------------------------------------------------
// Press: `transition:transform .42s cubic-bezier(.34,1.7,.5,1)`, shared by
// every pressable surface the artifact draws (`.ic`, `.scr-btn`, `.pbtn`,
// `.row`, `.chip`, `.blk`/`.bash`/`.ov`, `.cmp-box .ic`, `.fp`, `button.fp`),
// with a per-surface `:active{transform:scale(N)}` depth.
// ---------------------------------------------------------------------------

/** The artifact's own press duration, `.42s`, on every pressable surface. */
export const EXPRESSIVE_PRESS_SPRING_DURATION_MS = 420;

/**
 * `cubic-bezier(.34,1.7,.5,1)`. The `1.7` second control point sits above
 * `1`, which is what makes this a spring with real overshoot rather than
 * an ease-out: the animated value crosses its target and settles back,
 * instead of approaching it monotonically the way every curve in the
 * shared `motion.easing` table does.
 */
export const EXPRESSIVE_PRESS_SPRING_EASING: CubicBezier = [0.34, 1.7, 0.5, 1];

/** Every surface the artifact gives its own `:active{transform:scale(N)}` depth. */
export type ExpressivePressTarget =
  | "icon" // `.ic`, `.cmp-box .ic` — :active{scale(.88)}
  | "screenRailItem" // `.scr-btn` — :active{scale(.93)}
  | "promptButton" // `.pbtn` — :active{scale(.9)}
  | "row" // `.row` — :active{scale(.97)}
  | "chip" // `.chip` — :active{scale(.9)}
  | "block" // `.blk`,`.bash`,`.ov` — :active{scale(.985)}
  | "filePill"; // `button.fp` — :active{scale(.92)}

/**
 * The artifact's own per-surface press depth, keyed by target. Every
 * surface shares `EXPRESSIVE_PRESS_SPRING_DURATION_MS` and
 * `EXPRESSIVE_PRESS_SPRING_EASING` — only the scale differs.
 */
export const EXPRESSIVE_PRESS_SCALE: Readonly<Record<ExpressivePressTarget, number>> = {
  icon: 0.88,
  screenRailItem: 0.93,
  promptButton: 0.9,
  row: 0.97,
  chip: 0.9,
  block: 0.985,
  filePill: 0.92,
};

// ---------------------------------------------------------------------------
// pixel-on: the `.pxl` 3×3 grid loader.
//
// `@keyframes pixel-on{0%,100%{opacity:.15}18%,42%{opacity:1}62%{opacity:.15}}`,
// run `.65s ease-in-out infinite` per cell, each cell delayed by its own
// `animation-delay` (the artifact's `nth-child` list). The shape is NOT a
// symmetric fade between two values — it ramps up over the first 18% of the
// cycle, holds lit until 42%, ramps back down by 62%, then holds dim for the
// remaining 38% — so a caller must replay the four keyframe segments in
// sequence rather than ping-pong between the endpoints.
// ---------------------------------------------------------------------------

/** The artifact's own cycle length, `.65s` — not a `motion.duration` token. */
export const EXPRESSIVE_PIXEL_CYCLE_MS = 650;

/** CSS `ease-in-out`, i.e. `cubic-bezier(.42,0,.58,1)` — the artifact's per-segment timing function. */
export const EXPRESSIVE_PIXEL_EASING: CubicBezier = [0.42, 0, 0.58, 1];

export interface ExpressivePixelKeyframe {
  /** Fraction of one `EXPRESSIVE_PIXEL_CYCLE_MS` cycle, `0`–`1`. */
  readonly offset: number;
  readonly opacity: number;
}

/** The artifact's `pixel-on` keyframe stops, in cycle order. */
export const EXPRESSIVE_PIXEL_KEYFRAMES: readonly ExpressivePixelKeyframe[] = [
  { offset: 0, opacity: 0.15 },
  { offset: 0.18, opacity: 1 },
  { offset: 0.42, opacity: 1 },
  { offset: 0.62, opacity: 0.15 },
  { offset: 1, opacity: 0.15 },
];

/**
 * `.15` — both the `pixel-on` keyframe's own dim value AND the artifact's
 * `prefers-reduced-motion` override (`.pxl i{opacity:.15}`, same file,
 * `@media (prefers-reduced-motion:reduce)`): under reduced motion every
 * cell sits at this single dim value, uniformly, with no animation — NOT
 * full opacity. The grid stays recognisably a grid (nine faint squares,
 * not nine invisible ones) without moving, and every caller of the
 * loader already states "running" in words beside it, so no information
 * is lost either way (plan.md §10.5).
 */
export const EXPRESSIVE_PIXEL_REST_OPACITY = 0.15;

/**
 * The artifact's own per-cell `animation-delay`, in the artifact's
 * `nth-child(1)`…`nth-child(9)` order, in milliseconds.
 */
export const EXPRESSIVE_PIXEL_CELL_DELAYS_MS: readonly number[] = [
  90, 180, 270, 0, 90, 180, 90, 180, 270,
];

// ---------------------------------------------------------------------------
// caret-blink: `.stream-caret{animation:caret-blink 1s step-end infinite}`,
// `.stream-caret.is-streaming{animation:none}`.
//
// Recorded, not wired: see `../recipes/StreamingMessage.tsx`'s own doc
// comment for why only the `is-streaming` half (no animation — a solid
// caret) is ported this wave.
// ---------------------------------------------------------------------------

/** `caret-blink 1s step-end infinite` — a hard, un-eased flip every half-cycle, not a fade. */
export const EXPRESSIVE_CARET_BLINK_DURATION_MS = 1000;

// ---------------------------------------------------------------------------
// pop-in: `@keyframes pop-in{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:none}}`.
// ---------------------------------------------------------------------------

/** `cubic-bezier(.23,1,.32,1)` — coincides with the shared `motion.easing.standard` token, kept local for a self-contained module. */
export const EXPRESSIVE_POP_IN_EASING: CubicBezier = [0.23, 1, 0.32, 1];
export const EXPRESSIVE_POP_IN_FROM_SCALE = 0.95;
export const EXPRESSIVE_POP_IN_FROM_OPACITY = 0;

/** The artifact's own per-surface `pop-in` duration. */
export type ExpressivePopInTarget = "chip" | "pill" | "preview"; // `.dchip` / `.att` / `.dprev`
export const EXPRESSIVE_POP_IN_DURATION_MS: Readonly<Record<ExpressivePopInTarget, number>> = {
  chip: 250, // `.dchip`
  pill: 200, // `.att`
  preview: 160, // `.dprev`
};

// ---------------------------------------------------------------------------
// records-pulse: `@keyframes records-pulse{0%,100%{opacity:.35;transform:
// scale(.8)}50%{opacity:1;transform:scale(1)}}`, on `.pill.run .dot`.
// ---------------------------------------------------------------------------

export const EXPRESSIVE_RECORDS_PULSE_DURATION_MS = 1100;
export const EXPRESSIVE_RECORDS_PULSE_EASING: CubicBezier = [0.42, 0, 0.58, 1]; // ease-in-out
export const EXPRESSIVE_RECORDS_PULSE_REST = { opacity: 0.35, scale: 0.8 } as const;
export const EXPRESSIVE_RECORDS_PULSE_PEAK = { opacity: 1, scale: 1 } as const;

// ---------------------------------------------------------------------------
// fade-up: `@keyframes fade-up{from{opacity:0;transform:translateY(8px)}
// to{opacity:1;transform:none}}`.
// ---------------------------------------------------------------------------

/** `cubic-bezier(.23,1,.32,1)` — the same curve as `pop-in`, kept as a separate named export so each keyframe's own source citation stays intact. */
export const EXPRESSIVE_FADE_UP_EASING: CubicBezier = [0.23, 1, 0.32, 1];
export const EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y = 8;

/** The artifact's own per-surface `fade-up` duration. */
export type ExpressiveFadeUpTarget = "transcriptTurn" | "listRow" | "menu"; // `.t>*` / `.pad>.row,.pad>.card` / `.pmenu`
export const EXPRESSIVE_FADE_UP_DURATION_MS: Readonly<Record<ExpressiveFadeUpTarget, number>> = {
  transcriptTurn: 320, // `.t>*`
  listRow: 300, // `.pad>.row,.pad>.card`
  menu: 240, // `.pmenu`
};
