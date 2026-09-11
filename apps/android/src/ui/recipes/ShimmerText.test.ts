import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T359 source-level contract for `ShimmerText.tsx`. The recipe imports
 * `react-native`, so it cannot render under this workspace's plain
 * `vitest` setup; `readCode()` strips comments first, so a claim made
 * only in a doc comment can never satisfy an assertion.
 *
 * The two Reanimated-mechanism cases below have MOVED twice, and both
 * moves are the same decision rather than a drift. They began in
 * `../../features/transcript/thinking-row.test.ts`, moved to
 * `./ThinkingSection.test.ts` at T357 when the shimmer moved onto the
 * head's own words, and moved here at T359 when the bash block needed
 * the same treatment and the loop became one shared recipe. Each time
 * they are the same assertions at the new address — re-anchored, never
 * widened to whatever the old file still happens to say, and never
 * deleted, which is what would quietly drop the proof that the loop is
 * a real repeating interpolation and that it is reset rather than left
 * running.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./ShimmerText.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("ShimmerText.tsx: the artifact's .shim (T359)", () => {
  it("drives the shimmer from react-native-reanimated's interpolateColor/withRepeat, not a CSS-only or one-shot effect", () => {
    const code = readCode();
    expect(code).toMatch(/from "react-native-reanimated"/);
    expect(code).toMatch(/interpolateColor\(/);
    expect(code).toMatch(/withRepeat\(/);
  });

  it("resets the shared value instead of leaving a stale loop running when the gate turns off", () => {
    expect(readCode()).toMatch(/if \(!active\) \{\s*progress\.value = 0;/);
  });

  it("carries the reference's 1.4s cycle as one exported, named constant", () => {
    // Not a `motion.duration` token, and deliberately so: that table
    // tops out at `entrance` = 600ms, so there is nothing to read it
    // from. The same gap `./StreamingMessage.tsx` documents.
    expect(readCode()).toMatch(/export const SHIMMER_DURATION_MS = 1400;/);
    expect(readCode()).toMatch(/duration: SHIMMER_DURATION_MS/);
  });

  it("takes the gate as a prop and re-derives no reduced-motion rule of its own", () => {
    const code = readCode();
    expect(code).toMatch(/active,/);
    expect(code).not.toMatch(/reduceMotion/);
    expect(code).not.toMatch(/shouldAnimateShimmer/);
    // A `ui/` recipe reaching into a feature's model is the layering
    // this repository's own rules exist to prevent.
    expect(code).not.toMatch(/from "\.\.\/\.\.\/features/);
  });

  it("still renders the words, in the settled colour, with the animation off", () => {
    // The whole reason reduced motion is safe here: every caller's
    // label states the state in words.
    const code = readCode();
    expect(code).toMatch(/style=\{\[style, \{ color: from \}, active \? animatedStyle : null\]\}/);
    expect(code).toMatch(/\{children\}/);
  });

  it("reads both ends of the interpolation from the theme when the caller names neither", () => {
    const code = readCode();
    expect(code).toMatch(/settled \?\? theme\.colors\["ink-3"\]/);
    expect(code).toMatch(/peak \?\? theme\.colors\.ink/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
