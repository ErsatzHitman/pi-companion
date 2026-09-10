import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T357 source-level contract for `ThinkingSection.tsx`. The recipe
 * imports `react-native`, so it cannot render under this workspace's
 * plain `vitest` setup; `readCode()` strips comments first, so a claim
 * made only in a doc comment can never satisfy an assertion.
 *
 * The three Reanimated-mechanism cases below MOVED here from
 * `../../features/transcript/thinking-row.test.ts` when T357 moved the
 * shimmer itself out of that row and onto the head's own words, where
 * `HANDOFF.md` §7.2 puts it. They are the same assertions, re-anchored,
 * not new coverage — and not deleted, which is what would have quietly
 * dropped the proof that the loop is a real repeating interpolation and
 * that it is reset rather than left running.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./ThinkingSection.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("ThinkingSection.tsx: the artifact's .thead (T357)", () => {
  it("draws the sparkle and the chevron as real vector paths, not text glyphs", () => {
    const code = readCode();
    expect(code).toMatch(/<VectorIcon name="sparkle" size=\{SPARKLE_SIZE\}/);
    expect(code).toMatch(/<VectorIcon name="chevron-down" size=\{CHEVRON_SIZE\}/);
    // The glyph this replaced. A rotated single-guillemet is a different
    // drawing at a different weight on every OEM font fallback.
    expect(code).not.toMatch(/\\u203a/);
  });

  it("carries the artifact's own head sizes", () => {
    const code = readCode();
    expect(code).toMatch(/const HEAD_FONT_SIZE = 12\.5;/);
    expect(code).toMatch(/const SPARKLE_SIZE = 14;/);
    expect(code).toMatch(/const CHEVRON_SIZE = 11;/);
  });

  it("tints the head ink-3 collapsed and ink-2 expanded, as the design specifies", () => {
    expect(readCode()).toMatch(
      /const headTint = expanded \? theme\.colors\["ink-2"\] : theme\.colors\["ink-3"\];/,
    );
  });

  it("shows the mono duration only while there is one to show", () => {
    // Once settled the caller empties it and the headline carries the
    // number instead — see `thinking-row.tsx`'s `useElapsedLabel`.
    expect(readCode()).toMatch(/durationLabel\.length > 0 \?/);
  });

  it("announces the caller's richer summary, not the head's two words", () => {
    const code = readCode();
    expect(code).toMatch(/accessibilityLabel=\{summary\}/);
    expect(code).toMatch(/accessibilityState=\{\{ expanded \}\}/);
  });

  it("drives the shimmer from react-native-reanimated's interpolateColor/withRepeat, not a CSS-only or one-shot effect", () => {
    const code = readCode();
    expect(code).toMatch(/from "react-native-reanimated"/);
    expect(code).toMatch(/interpolateColor\(/);
    expect(code).toMatch(/withRepeat\(/);
  });

  it("resets the shared value instead of leaving a stale loop running when the gate turns off", () => {
    expect(readCode()).toMatch(/if \(!shimmerEnabled\) \{\s*shimmer\.value = 0;/);
  });

  it("takes the gate as a prop rather than re-deriving it from a feature's model", () => {
    const code = readCode();
    expect(code).toMatch(/shimmer: shimmerEnabled = false/);
    expect(code).not.toMatch(/shouldAnimateShimmer/);
    expect(code).not.toMatch(/from "\.\.\/\.\.\/features/);
  });

  it("reads every colour from the theme and hardcodes no product colour", () => {
    const code = readCode();
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
