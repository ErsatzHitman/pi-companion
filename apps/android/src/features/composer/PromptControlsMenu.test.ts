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
  //
  // CORRECTED at the W14-PMENU merge gate. This asserted that the source
  // still contained the phrase `panel is bottom-anchored`, and was left
  // passing on the grounds that the phrase survives inside W14-PMENU's
  // own historical quotation. That made the assertion and the title mean
  // two different things: the title claims the panel clears the
  // composer, while the assertion had come to pin the mere PRESENCE of a
  // sentence this wave proved false. A test that passes for a reason
  // unrelated to its name is the shape this repository's own gate
  // history exists to catch, so it is re-pointed at the live mechanism
  // instead. The historical quotation is still pinned, once, by
  // "marks the old bottom-anchored claim as corrected" below — which is
  // where that assertion belongs.
  it("clears the pill row and the prompt bar through Sheet's menu variant, not through the bottom-edge default", () => {
    const code = readCode("PromptControlsMenu");
    expect(code).toMatch(/variant="menu"/);
    expect(code).not.toMatch(/variant="edge"/);
  });
});

// W14-PMENU: the artifact draws `.pmenu` lifted `bottom:98px` clear of
// both the pill row and the prompt bar, and says outright it is "Not a
// bottom sheet" — this panel used to fall into `Sheet`'s bottom-anchored
// `"edge"` default by omitting a `variant` prop entirely. These pin the
// fix and, as a whole-file negative assertion, guard against a future
// edit silently dropping the prop back to that default.
describe("PromptControlsMenu: opens the lifted .pmenu shape, not a bottom sheet (W14-PMENU)", () => {
  it("passes Sheet the menu variant", () => {
    const code = readCode("PromptControlsMenu");
    expect(code).toMatch(/<Sheet[\s\S]*?variant="menu"[\s\S]*?>/);
  });

  it("is never rendered with the edge variant, and the one <Sheet> call always carries a variant", () => {
    const code = readCode("PromptControlsMenu");
    expect(code).not.toMatch(/variant="edge"/);
    // A `<Sheet ...>` open tag with no `variant=` at all would silently
    // fall back to `Sheet`'s own `"edge"` default — exactly the
    // regression this task fixes — so every opening tag in this file
    // must itself carry `variant="menu"`, not just the file as a whole.
    const sheetOpenTags = code.match(/<Sheet\b[\s\S]*?>/g) ?? [];
    expect(sheetOpenTags.length).toBeGreaterThan(0);
    for (const tag of sheetOpenTags) {
      expect(tag).toMatch(/variant="menu"/);
    }
  });

  it("marks the old bottom-anchored claim as corrected, with the T124 historical-quote marker", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./PromptControlsMenu.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toMatch(/CORRECTED, W14-PMENU:.*panel is bottom-anchored/s);
    expect(source).toMatch(/Not a bottom sheet/);
  });
});
