/**
 * T343/T344 — the height the composer must never be shrunk below.
 *
 * T338 made the composer shrinkable (`flexShrink: 1`) so the keyboard
 * inset could reach it, scrolling its controls and keeping the prompt bar
 * put. That holds as long as the composer is the only shrinkable slot in
 * the shell. Maestro run 34493338438's `extension-sheets` added a second
 * claimant: with a roster card and a panel card pinned (T342's cap, 855px
 * on the emulator) and the keyboard up, the shell had 84px left for the
 * composer — heading only, `composer-root` 19px tall, no input, no send
 * button — because the pinned slot could not shrink at all and the
 * composer could shrink without limit.
 *
 * Two changes close that, and this module is the pure half of the first:
 * the composer reserves a minimum height equal to everything in it that
 * does not scroll (the section heading, its gaps, and the prompt bar),
 * measured at runtime rather than guessed, and `compact-shell.tsx`'s
 * live-extension slot becomes shrinkable too, so the pinned area gives
 * way before the prompt bar does.
 *
 * The measurement is a SUM of the two views that never shrink — the
 * `Section`'s heading and the `PromptBar` (both keep React Native's
 * default `flexShrink: 0`, so their `onLayout` height is their natural
 * height whatever the shell is doing) — plus the section's two gaps.
 *
 * (CORRECTED at T344: T343 measured this as a DIFFERENCE instead — the
 * section's height less its scrolling `ScrollView`'s — and Maestro run
 * 34497459568 showed the flaw: the two `onLayout` readings arrive as
 * separate events, and after the keyboard closed the section's new full
 * height paired with the scroll view's stale, squeezed height, so the
 * floor came out as the whole section. From then on the composer could
 * not shrink at all, and with the keyboard closed the pinned area took
 * every pixel of overflow, clipping the loop panel's sections that T342
 * had just uncovered. A sum of two natural heights has no such pair: a
 * stale reading can only make the floor briefly low, never too high.)
 */
export interface ComposerMeasuredHeights {
  /** The `Section`'s heading text. */
  titleHeight: number;
  /** The `PromptBar` (input and send button). */
  promptBarHeight: number;
  /** The section's `gap` — applied twice: heading→controls and controls→prompt bar. */
  gap: number;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * The composer root's `minHeight`: heading + prompt bar + two gaps, or
 * `0` (no floor) until both views have reported a height.
 */
export function resolveComposerMinHeight(measured: ComposerMeasuredHeights): number {
  if (!isPositiveFinite(measured.titleHeight) || !isPositiveFinite(measured.promptBarHeight)) {
    return 0;
  }
  const gap = isPositiveFinite(measured.gap) ? measured.gap : 0;
  return measured.titleHeight + measured.promptBarHeight + gap * 2;
}
