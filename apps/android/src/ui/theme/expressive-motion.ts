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
 *
 * **A-MOTION-2** wired three more of this file's own exports, each
 * behind an explicit caller opt-in prop rather than an inferred one —
 * the same "the caller decides" shape `StreamingMessage.tsx`'s
 * `showSpeakerLabel` already used, because none of these three states
 * can be told apart from the tone/text a component already receives
 * (see each consumer's own doc comment for why):
 *
 * - `EXPRESSIVE_RECORDS_PULSE_*` drives `../primitives/StatusPill.tsx`'s
 *   dot when a caller passes `pulseDot`, gated on `reduceMotion` the
 *   same way every other animated recipe in this tree is.
 * - `EXPRESSIVE_CARET_BLINK_DURATION_MS` drives
 *   `../recipes/StreamingMessage.tsx`'s resting caret when a caller
 *   passes `showRestingCaret`, as a hard on/off square wave (matching
 *   the artifact's `step-end` timing function, not a fade).
 * - `EXPRESSIVE_STREAM_TAIL_FADE_STOPS` / `EXPRESSIVE_STREAM_TAIL_CHAR_COUNT`
 *   drive the same file's streaming-tail opacity fade — the reachable
 *   half of `.stream-tail`; see that file's own doc comment for the
 *   `filter:blur()` half this app has no equivalent for and does not
 *   attempt.
 *
 * **No shipped caller passes `pulseDot` or `showRestingCaret` yet.**
 * Both need session/transcript-level state (which pill really means "a
 * turn is running", which turn is the most recently settled one) that
 * the files A-MOTION-2 owns do not have and should not reach for —
 * `../../features/transcript/header.tsx` and `../../features/transcript/
 * message-row.tsx` own that state and are outside this task's file list.
 * The mechanism is real and proven by its own tests; wiring a caller to
 * it is the next task's work, not a capability that doesn't exist.
 *
 * The remaining exports (every `EXPRESSIVE_PRESS_SCALE` target but
 * `icon`, `EXPRESSIVE_POP_IN_*`) have no consumer in this package today.
 * `.scr-btn`, `.pbtn`, `.row`, `.chip`, `.blk`/`.bash`/`.ov`,
 * `.dchip`/`.att`/`.dprev` all live in files A-MOTION does not own (a
 * navigation rail, the prompt bar's own buttons, transcript block chrome,
 * and tool-call detail chips).
 * `EXPRESSIVE_PRESS_SCALE.filePill` (`button.fp`'s own `:active{scale(.92)}`)
 * is the one target whose file — `../../features/composer/
 * FooterPills.tsx` — this package's own family DOES now touch
 * (A-MOTION-2); it stays unconsumed because that file's `MetadataPill`
 * drives its own drag/pop physics (`playPop`, `footer-pill-drag-model.ts`)
 * rather than the shared `usePressScale` hook this target is meant for,
 * and retrofitting that split is outside this task's scope.
 *
 * (CORRECTED, W12-ENTRANCE: this used to say every `EXPRESSIVE_FADE_UP_*`
 * export had no consumer, and that `fade-up`'s intended consumer was
 * `../recipes/StreamingMessage.tsx`, deliberately left unwired there —
 * The first was TRUE when written — nothing consumed those exports
 * then, and this change is what makes it false. The second was wrong
 * from the start, and the artifact says why:
 * `.t>*`, the selector `fade-up` targets, is every direct child of the
 * TRANSCRIPT, not one row kind's own recipe: message blocks, tool-call
 * blocks, thinking rows, and the todo overlay alike — so its home was
 * always the row wrapper, `../../features/transcript/
 * transcript-window.tsx`, which now wraps each entering row in an
 * `Animated.View` driven by `EXPRESSIVE_FADE_UP_EASING`,
 * `EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y`, and
 * `EXPRESSIVE_FADE_UP_DURATION_MS.transcriptTurn`, gated on
 * `@picompanion/frontend-core`'s `timeline.advanceTranscriptEntranceWatermark`/
 * `timeline.transcriptEntranceDelayMs` (`packages/frontend-core/src/
 * timeline/transcript-entrance.ts`) so a recycled `FlatList` cell never
 * replays the entrance. `StreamingMessage.tsx`'s own deferral comment,
 * which reasoned about the same wrong file, is outside this task's file
 * list and was reported rather than edited.)
 *
 * `EXPRESSIVE_PRESS_SCALE`'s remaining unconsumed targets are recorded
 * here anyway, exactly as `expressive-shape.ts` recorded `xs`/`sm`/`md`/
 * `lg` before any caller needed them, so the next package (or task) that
 * draws one of those elements has a measured number to read instead of a
 * fresh guess at the source CSS.
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
// Both halves are now ported in `../recipes/StreamingMessage.tsx`: solid
// while `streaming`, and this hard blink behind `showRestingCaret` — see
// that file's own doc comment for why the second half is a caller opt-in
// rather than something this component infers on its own.
// ---------------------------------------------------------------------------

/** `caret-blink 1s step-end infinite` — a hard, un-eased flip every half-cycle, not a fade. */
export const EXPRESSIVE_CARET_BLINK_DURATION_MS = 1000;

// ---------------------------------------------------------------------------
// stream-tail: `.stream-tail{filter:blur(1.6px);mask-image:linear-gradient(
// to right,#000 20%,rgba(0,0,0,.2))}`, reduced under
// `@media(prefers-reduced-motion:reduce)` to `filter:none;mask-image:none`.
//
// React Native has no `filter`/`mask-image` — no consumer of this module
// attempts the blur half. `EXPRESSIVE_STREAM_TAIL_FADE_STOPS` records the
// mask gradient's own (offset, alpha) stops for a consumer to interpolate
// an opacity ramp from, which is the reachable half.
// ---------------------------------------------------------------------------

/** One stop of the artifact's `mask-image` gradient: `offset` 0–1 along the mask axis, `opacity` its alpha at that point. */
export interface ExpressiveStreamTailFadeStop {
  readonly offset: number;
  readonly opacity: number;
}

/**
 * `linear-gradient(to right,#000 20%,rgba(0,0,0,.2))` as three stops: full
 * alpha from `0` to `.2`, then a straight ramp down to `.2` alpha by `1`.
 * CSS gradients hold a colour-stop's value flat until the NEXT stop, so
 * `0` and `.2` share the same `1` — this is not a rounding duplicate.
 */
export const EXPRESSIVE_STREAM_TAIL_FADE_STOPS: readonly ExpressiveStreamTailFadeStop[] = [
  { offset: 0, opacity: 1 },
  { offset: 0.2, opacity: 1 },
  { offset: 1, opacity: 0.2 },
];

/**
 * `TAIL` in the artifact's own streaming script (`const CPT=2,TICK=9,
 * TAIL=6,STAGGER=120`, quoted directly from `android-spec.html`, itself
 * quoting `D:/beautiful-ui`'s `StreamText.tsx`'s `blurTail 6`): the
 * character count of the live `.stream-tail` span trailing the settled
 * text while a line is still typing.
 */
export const EXPRESSIVE_STREAM_TAIL_CHAR_COUNT = 6;

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

// ---------------------------------------------------------------------------
// fade-up's stagger, and why this module does not own it.
// ---------------------------------------------------------------------------
/*
 * The artifact's own script constant, `const CPT=2,TICK=9,TAIL=6,
 * STAGGER=120` (see `EXPRESSIVE_STREAM_TAIL_CHAR_COUNT`'s doc comment for
 * the same script quoted in full): the per-row delay step the script
 * applies between one `.t>*` child entering and the next.
 *
 * Deliberately NOT re-declared here as a Reanimated-facing duration this
 * file's own `EXPRESSIVE_FADE_UP_*` group owns: `STAGGER` and the
 * measured 720ms cap it produces (`6 * STAGGER`) are consumed together
 * with the entrance WATERMARK rule that keeps a virtualizing list's
 * recycled rows from replaying the animation — a concern this RN-free,
 * theme-free module has no notion of at all. `packages/frontend-core`'s
 * `timeline/transcript-entrance.ts` (W12-ENTRANCE) owns both numbers as
 * `TRANSCRIPT_ENTRANCE_STAGGER_MS`/`TRANSCRIPT_ENTRANCE_STAGGER_CAP_MS`,
 * next to the watermark logic that actually needs them; restating either
 * figure here would create exactly the kind of second, driftable copy
 * this module's own header comment already argues against for
 * `EXPRESSIVE_POP_IN_EASING` versus `motion.easing.standard`.
 */
