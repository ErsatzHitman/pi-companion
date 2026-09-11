import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T359 source-level contract for `BashBlock.tsx`. The recipe imports
 * `react-native`, so it cannot render under this workspace's plain
 * `vitest` setup; `readCode()` strips comments first, so a claim made
 * only in a doc comment can never satisfy an assertion.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./BashBlock.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("BashBlock.tsx: the artifact's .bash (T359)", () => {
  it("draws a rule above AND below, at the artifact's half strength", () => {
    const code = readCode();
    const rules =
      code.match(/<View style=\{\[styles\.rule, \{ backgroundColor: tone \}\]\} \/>/g) ?? [];
    expect(rules).toHaveLength(2);
    expect(code).toMatch(/export const RULE_OPACITY = 0\.5;/);
    expect(code).toMatch(/opacity: RULE_OPACITY/);
  });

  it("is the rules and nothing else — no card, no fill, no radius", () => {
    // A shell command is the one thing §7.2 does not box. Giving it a
    // card as well would make it read as a tool result.
    const code = readCode();
    expect(code).not.toMatch(/borderRadius/);
    expect(code).not.toMatch(/backgroundColor: theme\.colors\.(surface|field|inset)/);
  });

  it("carries the artifact's own inner padding, which is not a block's", () => {
    const code = readCode();
    expect(code).toMatch(/export const BASH_PADDING_VERTICAL = 7;/);
    expect(code).toMatch(/export const BASH_PADDING_HORIZONTAL = 12;/);
  });

  it("prints a literal $ before the command, so the green is not the only thing saying 'shell'", () => {
    expect(readCode()).toMatch(/\{`\$ \$\{command\}`\}/);
  });

  it("switches the whole tone to ink-3 for a dimmed block, rather than recolouring each part", () => {
    const code = readCode();
    expect(code).toMatch(/const tone = dimmed \? theme\.colors\["ink-3"\] : theme\.colors\.green;/);
  });

  it("puts the output in ink-2 between the rules", () => {
    expect(readCode()).toMatch(/output: \{ color: theme\.colors\["ink-2"\] \}/);
  });

  it("reuses the app's shared running mark rather than a second loader", () => {
    const code = readCode();
    expect(code).toMatch(/<PixelLoader cellSize=\{LOADER_CELL\}/);
    expect(code).toMatch(/const LOADER_CELL = 4;/);
  });

  it("says the literal word Running, shimmer or no shimmer", () => {
    const code = readCode();
    expect(code).toMatch(/<ShimmerText active=\{shimmer\}/);
    expect(code).toMatch(/Running…/);
  });

  it("draws the running row only while running", () => {
    expect(readCode()).toMatch(/\{running \? \(/);
  });

  it("omits the elapsed readout and the hint rather than drawing an empty one", () => {
    const code = readCode();
    expect(code).toMatch(/elapsedLabel !== undefined && elapsedLabel\.length > 0 \?/);
    expect(code).toMatch(/cancelHint !== undefined && cancelHint\.length > 0 \?/);
  });

  it('ships no "esc to cancel": a touch device has no esc key', () => {
    // The artifact is a desktop mock. Printing its keyboard hint here
    // would be a visible instruction the reader cannot follow, so the
    // hint is a prop and the caller passes this platform's own control
    // name. See this file's doc comment.
    const code = readCode();
    expect(code).not.toMatch(/esc to cancel/);
    expect(code).toMatch(/cancelHint\?: string;/);
  });

  it("reads every colour from the theme and hardcodes no product colour", () => {
    const code = readCode();
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
  });

  it("owns no animation of its own — the shimmer and the loader each have one home", () => {
    expect(readCode()).not.toMatch(/react-native-reanimated/);
  });
});
