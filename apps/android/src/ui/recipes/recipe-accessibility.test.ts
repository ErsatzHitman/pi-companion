import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T26B accessibility/motion/theming source checks for the §10.4 recipe
 * layer (plan.md §10.5, T26B "TalkBack roles and states verified on
 * critical components", "Reduced-motion and dark/light verified").
 *
 * As with `../../dev/component-lab.test.ts` and
 * `../primitives/touch-targets.test.ts`, `react-native` components can't
 * be rendered under this workspace's plain-`vitest` setup, so this
 * statically verifies the source contracts a render/TalkBack pass would
 * otherwise check:
 *
 * - every recipe reads colour/spacing/typography/motion from
 *   `useTheme()`, not a raw hex literal (plan.md §10 "no raw hex" rule,
 *   and implicitly dark/light: every colour comes from the theme object
 *   that already resolves against `useColorScheme()`);
 * - every recipe with a Reanimated animation drives its duration from
 *   `motion.duration` (which `getNativeMotion(reduceMotion)` already
 *   collapses under reduced motion — see `theme-context.tsx`), never a
 *   hardcoded millisecond constant;
 * - every interactive/stateful recipe sets an `accessibilityRole` and,
 *   where it has a boolean/selectable state, an `accessibilityState` or
 *   `accessibilityLabel` that names that state as visible text (not
 *   colour alone).
 */
const RECIPE_FILES = [
  "ThinkingSection",
  "StreamingMessage",
  "ApprovalForm",
  "ToolChips",
  "TaskRows",
  "PromptBar",
  "DiffSummary",
  "CommandSearch",
  "WorkflowSteps",
  "CodeListing",
  "SelectionActions",
  // T350: the redesign's shared top bar, mounted by the Live screen and
  // by every other redesigned screen as they land.
  "ScreenBar",
  // T350: the redesign's running mark, drawn as the artifact's 3x3
  // staggered grid rather than a spinner.
  "PixelLoader",
  // T358: the redesign's diff bands, and the search hit that
  // shares their treatment.
  "DiffLines",
];

function readRecipeSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}.tsx`, import.meta.url)), "utf8");
}

/**
 * `readRecipeSource` with comments stripped (P5-W16/T57B). Every recipe
 * here carries a doc comment that documents its accessibility contract
 * in prose quoting the exact prop strings the assertions below check
 * for (e.g. `ThinkingSection`'s doc comment names
 * `accessibilityRole="button"` and `accessibilityState.expanded`;
 * `PromptBar`'s names `accessibilityLiveRegion="polite"` verbatim), so
 * an unanchored regex over the raw file text can stay green even after
 * the real prop is deleted from the JSX — the exact `header.tsx`/
 * `Composer.tsx` failure mode documented in `../../features/transcript/
 * transcript-accessibility.test.ts`'s and `../../features/composer/
 * composer-accessibility.test.ts`'s identical `readCode()` helpers.
 * Every assertion that must reach real code reads through this instead.
 */
function readRecipeCode(name: string): string {
  return readRecipeSource(name)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("§10.4 recipes: theme-only colour, no raw hex", () => {
  for (const name of RECIPE_FILES) {
    it(`${name} contains no raw hex colour literal`, () => {
      const code = readRecipeCode(name);
      expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });

    it(`${name} reads its styling from useTheme()`, () => {
      const code = readRecipeCode(name);
      expect(code).toMatch(/useTheme\(\)/);
    });
  }
});

describe("§10.4 recipes: reduced-motion via shared motion tokens", () => {
  const animated = ["ThinkingSection", "StreamingMessage", "PixelLoader"];
  for (const name of animated) {
    it(`${name} drives Reanimated timing from theme motion tokens`, () => {
      const code = readRecipeCode(name);
      expect(code).toMatch(/motion\.duration/);
      expect(code).toMatch(/react-native-reanimated/);
    });
  }

  it("StreamingMessage checks reduceMotion before repeating its cursor animation", () => {
    const code = readRecipeCode("StreamingMessage");
    expect(code).toMatch(/reduceMotion/);
  });

  it("PixelLoader renders every cell fully lit, and animates nothing, under reduced motion", () => {
    const code = readRecipeCode("PixelLoader");
    expect(code).toMatch(/animate=\{!reduceMotion\}/);
    expect(code).toMatch(/if \(!animate\) \{\s*opacity\.value = 1;/);
  });
});

describe("DiffLines: colour is never the only signal (T358)", () => {
  it("names each band in words, from the model's own table", () => {
    const code = readRecipeCode("DiffLines");
    expect(code).toMatch(/diffLineAnnouncement\(line\.tone\)/);
    expect(code).toMatch(/accessible\b/);
  });

  it("keeps the +/- marker as visible text, not only as a colour", () => {
    const code = readRecipeCode("DiffLines");
    expect(code).toMatch(/\{line\.marker\}/);
  });

  it("announces a whole line rather than one fragment per inverted span", () => {
    // A per-span announcement would chop an identifier in half and say
    // "highlighted" in the middle of it.
    const code = readRecipeCode("DiffLines");
    expect(code).toMatch(/const plain = line\.spans\.map\(\(span\) => span\.text\)\.join\(""\);/);
    expect(code).toMatch(/accessibilityLabel=\{`\$\{diffLineAnnouncement\(line\.tone\)\}/);
  });

  it("reads every fill and every ink from a token key the model returns", () => {
    const code = readRecipeCode("DiffLines");
    expect(code).toMatch(/theme\.colors\[diffLineInk\(line\.tone\)\]/);
    expect(code).toMatch(/theme\.colors\[surface\]/);
    expect(code).toMatch(/theme\.colors\["accent-highlight"\]/);
  });

  it("branches on the unfilled context band rather than inventing a third fill", () => {
    expect(readRecipeCode("DiffLines")).toMatch(/surface === null \? null :/);
  });

  it("animates nothing, so it needs no reduced-motion gate", () => {
    expect(readRecipeCode("DiffLines")).not.toMatch(/react-native-reanimated/);
  });
});

describe("§10.4 recipes: TalkBack roles, states, and non-colour status text", () => {
  it("ThinkingSection exposes a button role with expanded state", () => {
    const code = readRecipeCode("ThinkingSection");
    expect(code).toMatch(/accessibilityRole="button"/);
    expect(code).toMatch(/accessibilityState=\{\{\s*expanded\s*\}\}/);
  });

  it("ApprovalForm exposes both actions as accessible buttons and a visible danger warning", () => {
    const code = readRecipeCode("ApprovalForm");
    expect(code).toMatch(/label="Deny"/);
    expect(code).toMatch(/label="Approve"/);
    expect(code).toMatch(/Requires extra caution/);
  });

  it("ToolChips gives every chip a visible status-text accessible label, not tone alone", () => {
    const code = readRecipeCode("ToolChips");
    expect(code).toMatch(/accessibilityLabel=\{`\$\{item\.label\}: \$\{item\.statusText\}`\}/);
  });

  it("ScreenBar names every bar action, and hides the decorative mark it draws", () => {
    const code = readRecipeCode("ScreenBar");
    expect(code).toMatch(/accessibilityRole="button"/);
    expect(code).toMatch(/accessibilityLabel=\{action\.accessibleName\}/);
    expect(code).toMatch(/accessibilityElementsHidden/);
    expect(code).toMatch(/importantForAccessibility="no-hide-descendants"/);
    // The bar itself is the screen's heading, so TalkBack can jump to it.
    expect(code).toMatch(/accessibilityRole="header"/);
  });

  it("TaskRows folds each row's status word into its accessible label", () => {
    const code = readRecipeCode("TaskRows");
    expect(code).toMatch(/statusText\[item\.status\]/);
  });

  it("PromptBar announces the queued count through an accessibilityLiveRegion", () => {
    const code = readRecipeCode("PromptBar");
    expect(code).toMatch(/accessibilityLiveRegion="polite"/);
  });

  it("DiffSummary exposes a single accessible label summarising counts in words", () => {
    const code = readRecipeCode("DiffSummary");
    expect(code).toMatch(/accessibilityLabel=\{summary\}/);
  });

  it("CommandSearch exposes combobox role/expanded state and menu items with combined labels", () => {
    const code = readRecipeCode("CommandSearch");
    expect(code).toMatch(/accessibilityRole="combobox"/);
    expect(code).toMatch(/accessibilityState=\{\{\s*expanded:/);
    expect(code).toMatch(/accessibilityRole="menuitem"/);
  });

  it("WorkflowSteps marks the active step selected and names every step's status", () => {
    const code = readRecipeCode("WorkflowSteps");
    expect(code).toMatch(/accessibilityState=\{\{\s*selected:/);
    expect(code).toMatch(/statusText\[item\.status\]/);
  });

  it("CodeListing suffixes the highlighted line's accessible label rather than colour alone", () => {
    const code = readRecipeCode("CodeListing");
    expect(code).toMatch(/\(changed line\)/);
  });

  it("SelectionActions exposes a toolbar role with a visible selection summary", () => {
    const code = readRecipeCode("SelectionActions");
    expect(code).toMatch(/accessibilityRole="toolbar"/);
  });
});
