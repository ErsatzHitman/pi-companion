import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PAD-FADEUP: `PadEntrance.tsx` imports `react-native`/`react-native-reanimated`,
 * which cannot be rendered under this workspace's plain `vitest` setup (the
 * RolldownError on react-native's own Flow-typed `index.js` — see
 * `../recipes/recipe-accessibility.test.ts`'s doc comment, and `Sheet.test.ts`'s
 * identical `readSource`/`readCode` pair for the established idiom this file
 * reuses verbatim). This statically verifies the source contract instead; the
 * actual delay/kind rule is proven by real execution in
 * `pad-entrance-model.test.ts`.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./PadEntrance.tsx", import.meta.url)), "utf8");
}

/**
 * `readSource` with comments stripped, so a doc comment merely MENTIONING a
 * literal (e.g. explaining why a number is NOT retyped here) can never
 * satisfy an assertion meant to pin the real code using it — see
 * `Sheet.test.ts`'s `readCode` doc comment for the exact failure mode this
 * avoids.
 */
function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("PadEntrance: duration/easing/translate come from EXPRESSIVE_FADE_UP_*, never restated as literals", () => {
  it("imports EXPRESSIVE_FADE_UP_DURATION_MS, EXPRESSIVE_FADE_UP_EASING, and EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y from the shared motion tokens", () => {
    const code = readCode();
    expect(code).toMatch(
      /import\s*\{\s*EXPRESSIVE_FADE_UP_DURATION_MS,\s*EXPRESSIVE_FADE_UP_EASING,\s*EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y,?\s*\}\s*from\s*"\.\.\/theme\/expressive-motion"/,
    );
  });

  it("reads the duration off EXPRESSIVE_FADE_UP_DURATION_MS.listRow, the `.pad>.row,.pad>.card` target, not a private number", () => {
    expect(readCode()).toMatch(/duration:\s*EXPRESSIVE_FADE_UP_DURATION_MS\.listRow/);
  });

  it("builds the easing from EXPRESSIVE_FADE_UP_EASING via Easing.bezier, not a private cubic-bezier tuple", () => {
    expect(readCode()).toMatch(/Easing\.bezier\(\s*\.\.\.EXPRESSIVE_FADE_UP_EASING\s*\)/);
  });

  it("initial transform reads EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y, not a private 8", () => {
    expect(readCode()).toMatch(/translateY:\s*EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y\s*\}/);
  });

  it("declares no bare 8px-shaped magic number where the translateY value belongs", () => {
    // The only numeric literal this file should ever need for the fade-up
    // shape itself is the entrance's own initial opacity (0) and the final
    // opacity/translate (1 / none) — never a restated 8.
    expect(readCode()).not.toMatch(/translateY:\s*8\b/);
  });
});

describe("PadEntrance: gated on reduceMotion, same as every other animated primitive in this tree", () => {
  it("destructures reduceMotion from useTheme()", () => {
    expect(readCode()).toMatch(/const\s*\{\s*reduceMotion\s*\}\s*=\s*useTheme\(\)/);
  });

  it("checks reduceMotion before choosing to wrap children in the entering Animated.View", () => {
    expect(readCode()).toMatch(/reduceMotion/);
    // The bare-render branch must consult isPadEntranceChildAnimated,
    // the resolved delay, AND reduceMotion together — proven as a single
    // guard clause rather than three independent, possibly-inconsistent
    // checks scattered through the component.
    expect(readCode()).toMatch(
      /if\s*\(\s*!isPadEntranceChildAnimated\(kind\)\s*\|\|\s*delayMs\s*===\s*null\s*\|\|\s*reduceMotion\s*\)/,
    );
  });
});

describe("PadEntrance: delegates the delay/kind rule to pad-entrance-model.ts rather than re-deriving it", () => {
  it("imports padEntranceDelayForChild and isPadEntranceChildAnimated from ./pad-entrance-model", () => {
    const code = readCode();
    expect(code).toMatch(/from\s*"\.\/pad-entrance-model"/);
    expect(code).toMatch(/padEntranceDelayForChild/);
    expect(code).toMatch(/isPadEntranceChildAnimated/);
  });

  it("computes delayMs by calling padEntranceDelayForChild(kind, position), not a private nth-child calculation", () => {
    expect(readCode()).toMatch(/padEntranceDelayForChild\(\s*kind,\s*position\s*\)/);
  });

  it("declares no local nth-child or 45ms-stepped stagger constant of its own", () => {
    const code = readCode();
    expect(code).not.toMatch(/nth-?child/i);
    expect(code).not.toMatch(/=\s*45\b/);
  });
});

describe("PadEntrance: delays via withDelay, so the shared duration/easing config is never mutated per row", () => {
  it("wraps both the opacity and transform animations in withDelay(delayMs, ...)", () => {
    const code = readCode();
    expect(code).toMatch(/opacity:\s*withDelay\(delayMs,\s*withTiming\(1,\s*config\)\)/);
    expect(code).toMatch(
      /transform:\s*\[\s*\{\s*translateY:\s*withDelay\(delayMs,\s*withTiming\(0,\s*config\)\)\s*\}\s*\]/,
    );
  });
});
