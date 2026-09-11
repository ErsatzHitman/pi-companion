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
    expect(code).toMatch(/const HEAD_FONT_SIZE = 11\.5;/);
    expect(code).toMatch(/const SPARKLE_SIZE = 14;/);
    expect(code).toMatch(/const CHEVRON_SIZE = 11;/);
  });

  it("tints the head ink-3, expanded or not, as `.thead { color: var(--ink-3) }` specifies", () => {
    expect(readCode()).toMatch(/const headTint = theme\.colors\["ink-3"\];/);
  });

  it("draws the artifact's single .think rule and inset on the wrapper, not on the body", () => {
    const code = readCode();
    expect(code).toMatch(/borderLeftWidth: THINK_RULE_WIDTH/);
    expect(code).toMatch(/borderLeftColor: theme\.colors\["line-strong"\]/);
    expect(code).toMatch(/paddingLeft: THINK_PADDING_LEFT/);
    expect(code).toMatch(/const THINK_RULE_WIDTH = 2;/);
    expect(code).toMatch(/const THINK_PADDING_LEFT = 11;/);
  });

  it("draws the reasoning body in the transcript's italic ink-3 mono", () => {
    const code = readCode();
    expect(code).toMatch(/const LINE_FONT_SIZE = 12;/);
    expect(code).toMatch(/const LINE_HEIGHT = LINE_FONT_SIZE \* 1\.62;/);
    expect(code).toMatch(/fontStyle: "italic"/);
    expect(code).toMatch(/fontFamily: theme\.typography\.variant\.code\.fontFamily/);
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

  // The two Reanimated-mechanism cases that used to sit here MOVED to
  // `./ShimmerText.test.ts` at T359, when the bash block needed the
  // same treatment and the loop became one shared recipe. They are the
  // same assertions at the new address; see that file's doc comment for
  // the full path this pair has taken. What stays here is the part that
  // is still this recipe's decision — that it delegates rather than
  // keeping a second copy.
  it("T359: delegates the shimmer to the shared recipe instead of running its own loop", () => {
    const code = readCode();
    expect(code).toMatch(/<ShimmerText\s+active=\{shimmerEnabled\}/);
    expect(code).not.toMatch(/withRepeat\(/);
    expect(code).not.toMatch(/interpolateColor\(/);
  });

  it("T359: still hands the shimmer the colour the head rests at, so the two agree when it stops", () => {
    expect(readCode()).toMatch(/settled=\{headTint\}/);
  });

  it("takes the gate as a prop rather than re-deriving it from a feature's model", () => {
    const code = readCode();
    expect(code).toMatch(/shimmer: shimmerEnabled = false/);
    expect(code).not.toMatch(/shouldAnimateShimmer/);
    expect(code).not.toMatch(/from "\.\.\/\.\.\/features/);
  });

  it("still animates the chevron from a motion token, which is the animation it does own", () => {
    const code = readCode();
    expect(code).toMatch(/duration: motion\.duration\.fast/);
    expect(code).toMatch(/rotate: `\$\{progress\.value \* 180\}deg`/);
  });

  it("reads every colour from the theme and hardcodes no product colour", () => {
    const code = readCode();
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
