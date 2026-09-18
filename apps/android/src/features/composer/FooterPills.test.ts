import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A-COMPOSER source-level contract for `FooterPills.tsx`, replacing
 * `context-ring.test.ts`'s "ContextRing source" describe block (deleted
 * along with `ContextRing.tsx`). `FooterPills.tsx` imports
 * `react-native`/`react-native-reanimated`, so it can't render under
 * this workspace's plain `vitest` setup — same limitation, same
 * source-contract style as that old file and as
 * `../../ui/primitives/touch-targets.test.ts`.
 *
 * Of the old "ContextRing source" describe block's six cases:
 *
 * REMOVED, genuinely gone (3 cases — the ring itself is gone):
 *  - "takes every number from the model, computing no geometry of its
 *    own" (`buildContextRingViewModel`/`circumference`/`dashOffset`) —
 *    no arc, no `circumference`, nothing to pin.
 *  - "delegates the drawing rather than keeping a second copy of the
 *    arc" (`<ProgressRing`/no `<Circle`) — no ring primitive is drawn
 *    here at all.
 *  - "keeps a full 48dp touch target around an 18dp ring" — replaced by
 *    THIS file's own `hitSlop={12}` case below, which pins the pill's
 *    own 24dp box plus slop rather than the ring's 18dp one.
 *
 * INVERTED, not moved (1 case): "names and hints itself as a button,
 * and hides its own graphics from assistive tech" pinned that the RING
 * was a button. The context pill is the one footer pill that is NOT
 * one — see this file's own "the context pill is a readout, not a
 * button" case below, which pins the opposite fact on purpose.
 *
 * MOVED here, adapted to the pill's own shape (2 cases): "puts the
 * percentage in visible text" (now `contextPill.percentLabel`, not
 * `model.shortLabel`) and "reads every colour from the theme and
 * hardcodes no product colour" (generically applicable to any themed
 * component, re-pinned against this file).
 */
function readCode(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}.tsx`, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("FooterPills source", () => {
  const code = readCode("FooterPills");

  it("draws the mode/model/effort pills and the context readout, in the artifact's own order", () => {
    expect(code).toMatch(/variant="mode"[\s\S]*?variant="model"[\s\S]*?variant="eff"/);
    expect(code.indexOf('variant="eff"')).toBeLessThan(code.indexOf("ctxPill"));
  });

  it("puts the context percentage in visible text, so fill level is never the only signal", () => {
    expect(code).toMatch(/\{contextPill\.percentLabel\}/);
  });

  it("the context pill is a readout, not a button — no accessibilityRole, no onPress, no responder handlers on it", () => {
    const anchor = code.indexOf("testID={`${testId}-ctx`}");
    expect(anchor).toBeGreaterThan(-1);
    // The readout's own View opens a few lines above its testID and
    // closes a few lines below the bar fill — a window comfortably
    // inside those bounds without reaching into `MetadataPill` (whose
    // OWN accessibilityRole/responder props this file's other cases
    // pin as present).
    const ctxSection = code.slice(code.indexOf("styles.ctxPill"), anchor + 600);
    expect(ctxSection).toMatch(/styles\.ctxBarFill/);
    expect(ctxSection).not.toMatch(/accessibilityRole="button"/);
    expect(ctxSection).not.toMatch(/onStartShouldSetResponder/);
    expect(ctxSection).not.toMatch(/onPress=/);
  });

  it("the three interactive pills are real buttons for assistive tech, with an accessibility-tap fallback for a gesture that never becomes a real touch", () => {
    expect(code).toMatch(/accessibilityRole="button"/);
    expect(code).toMatch(/onAccessibilityTap=\{disabled \? undefined : onPress\}/);
  });

  it("keeps a full touch target around the pill's own 24dp box (hitSlop, not an inflated pill)", () => {
    expect(code).toMatch(/hitSlop=\{12\}/);
    expect(code).toMatch(/const PILL_HEIGHT = 24;/);
  });

  it("draws the pills as full pills, reading the shared radii.full token rather than a literal", () => {
    expect(code).toMatch(/borderRadius: theme\.radii\.full/);
  });

  it("carries the artifact's fp-swap overshoot (0.86 → 1.06 → 1), not just a slide-and-fade (A-MOTION-2)", () => {
    // A-MOTION-2: a prior version of this file hardcoded `{ scale: 1 }`
    // on the label transform, which is `fp-swap`'s 0% and 100% value but
    // silently dropped its 70% keyframe (`scale(1.06)`) — the squash
    // overshoot every other ported keyframe in this file keeps. Pinned by
    // both the shared value existing and the label style actually
    // reading it, so a future edit cannot quietly revert to `{ scale: 1 }`.
    expect(code).toMatch(/const swapScale = useSharedValue\(1\);/);
    expect(code).toMatch(
      /transform: \[\{ translateX: swapX\.value \}, \{ scale: swapScale\.value \}\]/,
    );
    expect(code).toMatch(/swapScale\.value = 0\.86;/);
    expect(code).toMatch(/withTiming\(1\.06, \{ duration: 294, easing: bezier \}\)/);
  });

  // P10-GATE: the three swap durations are derived from the artifact's own
  // `.fp .fpl.fp-swap{animation:fp-swap 420ms ...}` and its keyframe
  // percentages -- 42% -> 176ms, 70% -> 294ms, the remaining 30% -> 126ms.
  // Only 294 was pinned above, so the other two could have drifted with
  // nothing failing. They are inline literals here rather than named
  // constants because every ported keyframe in `FooterPills.tsx` already
  // is (the `fp-bubble`/`fp-halo` sequences predate this file's swap work);
  // pinning the literals is the coverage that convention can still carry.
  it("pins each fp-swap keyframe to its own percentage of the artifact's 420ms", () => {
    expect(code).toMatch(/withTiming\(1, \{ duration: 176, easing: bezier \}\)/);
    expect(code).toMatch(/withTiming\(0, \{ duration: 294, easing: bezier \}\)/);
    expect(code).toMatch(/withTiming\(1, \{ duration: 126, easing: bezier \}\)/);
    expect(code).toMatch(/swapX\.value = direction > 0 \? 9 : -9;/);
  });

  it("only plays the bubble/halo/swap pop from a resolved drag, never from a plain tap", () => {
    // stepPill is the artifact's only caller of bubble(); toggleMode/
    // openMenu (this file's onPress path) never call it.
    const tapBranch = code.slice(
      code.indexOf("if (!armed) {"),
      code.indexOf("const step = resolveSwipeStep"),
    );
    expect(tapBranch).toMatch(/onPress\(\);/);
    expect(tapBranch).not.toMatch(/playPop/);
  });

  it("reads every colour from the theme and hardcodes no product colour", () => {
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
  });

  it("takes its drag physics from footer-pill-drag-model.ts rather than re-deriving them", () => {
    expect(code).toMatch(/from "\.\/footer-pill-drag-model"/);
    expect(code).not.toMatch(/Math\.tanh/);
  });

  it("takes the context pill's numbers from context-pill-model.ts rather than computing them inline", () => {
    expect(code).toMatch(/buildContextPillViewModel\(usage\)/);
  });

  // AND-FOOT: `.fbar i{...transition:width .4s cubic-bezier(.23,1,.32,1)}`
  // (`android-spec.html`, `.fp.f-ctx .fbar i`) — the fill animates its own
  // width instead of snapping to a new percentage. `.4s` is
  // `motion.duration.slower` and `cubic-bezier(.23,1,.32,1)` is
  // `motion.easing.easeOutStrong`, both read from `useTheme()`'s `motion`
  // rather than retyped as literals.
  it("animates the context bar fill's width from motion.duration.slower / motion.easing.easeOutStrong, not literal numbers", () => {
    expect(code).toMatch(/const \{ theme, motion, reduceMotion \} = useTheme\(\);/);
    expect(code).toMatch(
      /duration: motion\.duration\.slower,\s*easing: Easing\.bezier\(\.\.\.motion\.easing\.easeOutStrong\)/,
    );
    expect(code).not.toMatch(/duration: 400/);
    expect(code).not.toMatch(/0\.23,\s*1,\s*0\.32,\s*1/);
  });

  it("drives the fill from a shared value animated width, not a plain percentage style", () => {
    expect(code).toMatch(/const ctxBarFraction = useSharedValue\(contextPill\.barFraction\);/);
    expect(code).toMatch(/const ctxBarFillStyle = useAnimatedStyle\(\(\) => \(\{/);
    expect(code).toMatch(/width: `\$\{ctxBarFraction\.value \* 100\}%`/);
    expect(code).toMatch(/<Animated\.View[\s\S]{0,80}styles\.ctxBarFill/);
    expect(code).not.toMatch(/width: `\$\{contextPill\.barFraction \* 100\}%`/);
  });

  it("gates the fill animation on reduceMotion — snaps instead of animating, the same gate every other animated primitive in this tree uses", () => {
    const effect = code.slice(
      code.indexOf("useEffect(() => {\n    if (reduceMotion) {"),
      code.indexOf("const ctxBarFillStyle"),
    );
    expect(effect).toMatch(
      /if \(reduceMotion\) \{\s*ctxBarFraction\.value = contextPill\.barFraction;/,
    );
    expect(effect).toMatch(/ctxBarFraction\.value = withTiming\(contextPill\.barFraction, \{/);
  });
});
