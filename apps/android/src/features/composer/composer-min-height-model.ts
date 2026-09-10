/**
 * T343 — the height the composer must never be shrunk below.
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
 * The measurement is `sectionHeight - controlsHeight`: the composer's
 * `Section` less its scrolling `ScrollView`. Inside the section only the
 * scroll view shrinks (`flexShrink: 1`; the heading and `PromptBar` keep
 * React Native's default of 0), so while the scroll view still has any
 * height the difference is exactly the un-scrolling chrome. Once the
 * scroll view has been squeezed to nothing the difference stops meaning
 * that — the next thing to give is the prompt bar itself — so a reading
 * with a zero-height scroll view keeps the previous answer instead of
 * lowering the floor. `Composer.tsx` feeds this from `onLayout` on both
 * views and applies the result as the root's `minHeight`.
 */
export interface ComposerMeasuredHeights {
  /** The `Section` wrapping heading, controls and prompt bar. */
  sectionHeight: number;
  /** The scrolling controls `ScrollView` inside it. */
  controlsHeight: number;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * The composer root's `minHeight`, given the latest layout of its section
 * and controls and the previously resolved value. See the module doc for
 * why a zero-height controls view returns `previous` unchanged.
 */
export function resolveComposerMinHeight(
  measured: ComposerMeasuredHeights,
  previous: number,
): number {
  if (!isPositiveFinite(measured.sectionHeight) || !isPositiveFinite(measured.controlsHeight)) {
    return previous;
  }
  const chrome = measured.sectionHeight - measured.controlsHeight;
  return chrome > 0 ? chrome : previous;
}
