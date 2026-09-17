import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T353 source-level contract for `PromptControlsMenu.tsx`, split out of
 * `context-ring.test.ts` (deleted by A-COMPOSER along with
 * `ContextRing.tsx`) into its own file. Every case below is UNCHANGED
 * from that file — per this task's brief, "the controls menu SURVIVES
 * unchanged in content... only its TRIGGER moves, from the ring to the
 * [footer] pills", and none of these cases pin the trigger. What moved
 * is `FooterPills.test.ts`'s own new cases for the trigger side of that
 * change.
 *
 * `PromptControlsMenu.tsx` imports `react-native`, so it can't render
 * under this workspace's plain `vitest` setup (see
 * `../extensions/renderers/log-model.ts`'s doc comment). Every number
 * and every string it draws is decided by `../telemetry`'s
 * `buildContextCardViewModel`, proven by execution in its own test
 * file; what these cases pin is the drawing itself.
 *
 * `readCode()` strips comments first, so a claim made only in a doc
 * comment can never satisfy an assertion.
 */
function readCode(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}.tsx`, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

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

  // UI-A4: the artifact's `.pm-lbl` is a two-part row (label + trailing
  // mono value). These pin that every group's value is read back off
  // real state this panel is handed, never invented.
  it("gives each group label a trailing value read from that slot's own element state, never a literal", () => {
    const code = readCode("PromptControlsMenu");
    expect(code).toMatch(/function readControlState\(node: ReactNode\)/);
    expect(code).toMatch(/value=\{modeGroupValue\(modeControl\)\}/);
    expect(code).toMatch(/value=\{modelGroupValue\(modelControl\)\}/);
    expect(code).toMatch(/value=\{queueGroupValue\(queueControl\)\}/);
    expect(code).toMatch(/value=\{context\.summary\}/);
  });

  it("renders no group value at all when a slot's state can't be read, rather than a guess", () => {
    const code = readCode("PromptControlsMenu");
    expect(code).toMatch(/\{value \? \(/);
  });

  it("sizes the group label and its trailing value at the artifact's 9.5px, not the old 10px", () => {
    const code = readCode("PromptControlsMenu");
    expect(code).toMatch(/const GROUP_LABEL_SIZE = 9\.5;/);
    expect(code).not.toMatch(/GROUP_LABEL_SIZE = 10;/);
  });

  it("draws a Compact now row at the end of the Context group, honestly disabled when no onCompactNow is given", () => {
    const code = readCode("PromptControlsMenu");
    expect(code).toMatch(/testID=\{`\$\{testId\}-context-compact`\}/);
    expect(code).toMatch(/disabled=\{!onCompactNow\}/);
    expect(code).toMatch(/no wire path — \/compact is a slash command, not a menu action/);
  });

  // A-COMPOSER: the panel this trigger opens is unchanged, but the
  // ANCHOR it clears is — the pill row now sits above `.cmp`, not a ring
  // inside it, so the sheet must still clear both.
  it("still anchors above the composer, per its own doc comment, rather than assuming Sheet already handles that", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./PromptControlsMenu.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toMatch(/panel is bottom-anchored/);
  });
});
