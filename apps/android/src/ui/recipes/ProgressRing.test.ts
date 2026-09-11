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
 * drawing out of that control — the todo widget became this app's
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
    const circles = readCode().match(/<Circle\b/g) ?? [];
    expect(circles).toHaveLength(2);
  });

  it("starts the arc at the top, not at an unrotated circle's three o'clock", () => {
    expect(readCode()).toMatch(/transform=\{`rotate\(-90, \$\{centre\}, \$\{centre\}\)`\}/);
  });

  it("computes nothing — every number arrives from a caller's own model", () => {
    const code = readCode();
    expect(code).toMatch(/strokeDasharray=\{circumference\}/);
    expect(code).toMatch(/strokeDashoffset=\{dashOffset\}/);
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
