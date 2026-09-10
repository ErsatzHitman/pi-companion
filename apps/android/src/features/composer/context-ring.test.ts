import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T353 source-level contract for `ContextRing.tsx` and
 * `PromptControlsMenu.tsx`. Both import `react-native`, so neither can
 * render under this workspace's plain `vitest` setup (see
 * `../extensions/renderers/log-model.ts`'s doc comment). Every number
 * and every string they draw is decided by
 * `./context-ring-model.ts` and `../telemetry`'s
 * `buildContextCardViewModel`, both of which are proven by execution in
 * their own test files; what these cases pin is the drawing itself.
 *
 * `readCode()` strips comments first, so a claim made only in a doc
 * comment can never satisfy an assertion.
 */
function readCode(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}.tsx`, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("ContextRing source", () => {
  it("takes every number from the model, computing no geometry of its own", () => {
    const code = readCode("ContextRing");
    expect(code).toMatch(/buildContextRingViewModel\(usage\)/);
    expect(code).toMatch(/strokeDasharray=\{model\.circumference\}/);
    expect(code).toMatch(/strokeDashoffset=\{model\.dashOffset\}/);
    expect(code).not.toMatch(/Math\.PI/);
  });

  it("draws real SVG circles rather than a rotated box or a text glyph", () => {
    const code = readCode("ContextRing");
    expect(code).toMatch(/from "react-native-svg"/);
    expect(code).toMatch(/<Circle\b/);
  });

  it("starts the arc at the top, not at an unrotated circle's three o'clock", () => {
    expect(readCode("ContextRing")).toMatch(/transform=\{`rotate\(-90,/);
  });

  it("puts the percentage in visible text, so fill level is never the only signal", () => {
    const code = readCode("ContextRing");
    expect(code).toMatch(/\{model\.shortLabel\}/);
  });

  it("names and hints itself as a button, and hides its own graphics from assistive tech", () => {
    const code = readCode("ContextRing");
    expect(code).toMatch(/accessibilityRole="button"/);
    expect(code).toMatch(/accessibilityLabel=\{model\.accessibilityLabel\}/);
    expect(code).toMatch(/accessibilityHint=\{model\.accessibilityHint\}/);
    expect(code).toMatch(/accessibilityElementsHidden/);
  });

  it("keeps a full 48dp touch target around an 18dp ring", () => {
    const code = readCode("ContextRing");
    expect(code).toMatch(/minHeight: 48/);
  });

  it("reads every colour from the theme and hardcodes no product colour", () => {
    const code = readCode("ContextRing");
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
  });
});

describe("PromptControlsMenu source", () => {
  it("hosts itself in the shared Sheet rather than a hand-built scrim and overlay", () => {
    const code = readCode("PromptControlsMenu");
    expect(code).toMatch(/<Sheet\b/);
    expect(code).not.toMatch(/from "react-native".*Modal/);
    expect(code).not.toMatch(/<Modal\b/);
  });

  it("renders each control as a slot, saying nothing about one it was not given", () => {
    const code = readCode("PromptControlsMenu");
    expect(code).toMatch(/\{modeControl \? \(/);
    expect(code).toMatch(/\{modelControl \? \(/);
    expect(code).toMatch(/\{queueControl \? \(/);
  });

  it("reads its context numbers from the same model the Live screen's card uses", () => {
    const code = readCode("PromptControlsMenu");
    expect(code).toMatch(/buildContextCardViewModel\(\{ usage, autoCompaction \}\)/);
    expect(code).toMatch(/\{context\.summary\}/);
  });

  it("draws an empty track when the provider has reported no window, never a full one", () => {
    expect(readCode("PromptControlsMenu")).toMatch(/context\.fraction === null \? null :/);
  });

  it("speaks the context reading, so its colour band is never the only signal", () => {
    expect(readCode("PromptControlsMenu")).toMatch(
      /accessibilityLabel=\{context\.accessibilityLabel\}/,
    );
  });

  it("reads every colour from the theme and hardcodes no product colour", () => {
    const code = readCode("PromptControlsMenu");
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
  });
});
