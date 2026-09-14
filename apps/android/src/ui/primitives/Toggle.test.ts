import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * UI-A2 source-level contract for `Toggle.tsx`. The primitive imports
 * `react-native`/`react-native-reanimated`, so it cannot render under
 * this workspace's plain `vitest` setup (the same constraint
 * `Sheet.test.ts`'s doc comment names); `readCode()` strips comments
 * first, so a claim made only in a doc comment can never satisfy an
 * assertion.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./Toggle.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("Toggle: track width matches the reference's own .sw (UI-A2: 40, not 44)", () => {
  it("declares TRACK_WIDTH as 40", () => {
    expect(readCode()).toMatch(/const TRACK_WIDTH = 40;/);
  });

  it("draws the track at TRACK_WIDTH, not a second, independent number", () => {
    expect(readCode()).toMatch(/track: \{\s*width: TRACK_WIDTH,/);
  });
});

describe("Toggle: keeps its 48dp touch floor around the visually smaller track", () => {
  it("declares a 48dp minimum on both axes of the touch area", () => {
    expect(readCode()).toMatch(
      /touchArea: \{ minHeight: 48, minWidth: 48, alignItems: "center", justifyContent: "center" \}/,
    );
  });
});

describe("Toggle: reads every colour from the theme and hardcodes no product colour", () => {
  it("calls useTheme() and never a raw hex or rgba literal", () => {
    const code = readCode();
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
  });
});
