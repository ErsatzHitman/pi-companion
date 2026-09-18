import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T360 source-level contract for `ProgressRing.tsx`. The recipe imports
 * `react-native-svg`, so it cannot render under this workspace's plain
 * `vitest` setup; `readCode()` strips comments first, so a claim made
 * only in a doc comment can never satisfy an assertion.
 *
 * The three cases below MOVED here from
 * `../../features/composer/context-ring.test.ts` when T360 pulled the
 * drawing out of that control (that file no longer exists: A-COMPOSER
 * deleted it with `ContextRing.tsx` at P10-W2, which is precisely why
 * these cases needed a home that did not depend on it) — the todo widget became this app's
 * second ring, and a second copy of the arc (the twelve-o'clock
 * rotation in particular, which is easy to get wrong and invisible when
 * you do) is the duplication T356, T358 and T359 each removed for a
 * shape. Same assertions, new address: not widened, not dropped.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./ProgressRing.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("ProgressRing.tsx: one arc drawing for every fractional readout (T360)", () => {
  it("draws real SVG circles rather than a rotated box or a text glyph", () => {
    const code = readCode();
    expect(code).toMatch(/from "react-native-svg"/);
    expect(code).toMatch(/<Circle\b/);
  });

  it("draws a track behind the arc, so an empty ring is still a ring", () => {
    // The arc is the one Reanimated-backed `AnimatedCircle` (T360 follow-up,
    // motion); a plain `/<Circle\b/g` count would silently drop to 1 the
    // moment the arc became animated, so this counts both the plain track
    // and the wrapped arc rather than assuming both still share one tag.
    const circles = readCode().match(/<(?:Animated)?Circle\b/g) ?? [];
    expect(circles).toHaveLength(2);
  });

  it("starts the arc at the top, not at an unrotated circle's three o'clock", () => {
    expect(readCode()).toMatch(/transform=\{`rotate\(-90, \$\{centre\}, \$\{centre\}\)`\}/);
  });

  it("computes nothing — every number arrives from a caller's own model, and only interpolates over time", () => {
    const code = readCode();
    expect(code).toMatch(/strokeDasharray=\{circumference\}/);
    // The offset itself is fed straight through, unmodified, on both the
    // reduced-motion (snap) and animated (tween) paths below — neither
    // branch derives a new number from `dashOffset`.
    expect(code).toMatch(/animatedDashOffset\.value = dashOffset;/);
    expect(code).toMatch(/withTiming\(dashOffset, \{/);
    expect(code).not.toMatch(/Math\.PI/);
  });

  it("takes both colours already resolved, and writes none of its own", () => {
    const code = readCode();
    expect(code).toMatch(/stroke=\{trackColor\}/);
    expect(code).toMatch(/stroke=\{arcColor\}/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/useTheme/);
  });

  it("is decorative: it carries no accessible name of its own", () => {
    // Every caller states the same quantity in text beside it, because
    // a fill level has to survive being unseen.
    expect(readCode()).not.toMatch(/accessibilityLabel/);
  });
});

/**
 * T360 follow-up (motion): the arc used to jump straight to a new
 * `dashOffset` every render. `.ring .p{transition:stroke-dashoffset .4s
 * cubic-bezier(.23,1,.32,1)}` (android-spec.html) means the design eases
 * that change; nothing before this pinned the ring's own transition, so
 * a revert back to a plain, unanimated `strokeDashoffset={dashOffset}`
 * prop would pass every case above and every reader
 * (`todo-row.test.ts`, `recipe-accessibility.test.ts`) silently.
 */
describe("ProgressRing.tsx: the arc eases its offset, following the artifact's own transition (motion)", () => {
  it("takes already-resolved motion tokens and the device's reduce-motion flag as props, never useTheme() itself", () => {
    const code = readCode();
    expect(code).toMatch(/motion: NativeMotion;/);
    expect(code).toMatch(/reduceMotion: boolean;/);
    expect(code).not.toMatch(/useTheme\(\)/);
  });

  it("drives the arc's own offset from a Reanimated shared value, fed to the SVG circle via animatedProps", () => {
    const code = readCode();
    expect(code).toMatch(/from "react-native-reanimated"/);
    expect(code).toMatch(/const animatedDashOffset = useSharedValue\(dashOffset\);/);
    expect(code).toMatch(
      /useAnimatedProps\(\(\) => \(\{\s*strokeDashoffset: animatedDashOffset\.value,/,
    );
    expect(code).toMatch(/animatedProps=\{animatedArcProps\}/);
  });

  it("tweens over the artifact's own 400ms / cubic-bezier(.23,1,.32,1), read from the resolved motion tokens, not a hardcoded literal", () => {
    const code = readCode();
    expect(code).toMatch(/duration: motion\.duration\.slower,/);
    expect(code).toMatch(/easing: Easing\.bezier\(\.\.\.motion\.easing\.standard\),/);
    // A hardcoded 400 would keep playing under reduced motion, since only
    // a token read through `useTheme()`'s `getNativeMotion(reduceMotion)`
    // collapses automatically — see this file's own `reduceMotion` case.
    expect(code).not.toMatch(/duration:\s*400\b/);
  });

  it("snaps straight to the new offset under reduced motion, rather than playing a near-instant tween", () => {
    const code = readCode();
    expect(code).toMatch(/if \(reduceMotion\) \{\s*animatedDashOffset\.value = dashOffset;/);
  });

  it("introduces no accessibility node: AnimatedCircle wraps the same undecorated react-native-svg Circle", () => {
    const code = readCode();
    expect(code).toMatch(/const AnimatedCircle = Animated\.createAnimatedComponent\(Circle\);/);
    expect(code).not.toMatch(/accessibilityLabel/);
    expect(code).not.toMatch(/accessible=/);
  });
});
