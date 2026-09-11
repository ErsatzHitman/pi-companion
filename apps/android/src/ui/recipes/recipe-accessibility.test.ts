import { readdirSync, readFileSync } from "node:fs";
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
/**
 * Every `.tsx` in this directory, read from disk rather than typed out.
 *
 * T377: this was a hand-maintained array of sixteen names against a
 * directory of seventeen files. The missing one was `ProgressRing`
 * (T360), the arc both the prompt bar's context meter and the todo
 * widget draw — and it was left out ON PURPOSE, with the reason written
 * down: it takes both its colours already resolved from a caller, so
 * the `useTheme()` assertion below is a rule it cannot follow.
 *
 * That reasoning is right. The INSTRUMENT was wrong, in two ways a
 * derived list fixes and an omission cannot. First, omitting a file
 * exempts it from every assertion here, not from the one it disputes:
 * `ProgressRing` also stopped being checked for a raw hex literal, and
 * the only thing that kept that covered is a separate case someone
 * remembered to write in `./ProgressRing.test.ts`. Second, and worse,
 * a deliberate exemption and a forgotten file are byte-identical in an
 * array — so the next recipe to land here would be audited or not
 * depending on whether its author remembered a file two directories
 * away, with no failure either way to say which happened.
 *
 * So the set is derived and the exemption is stated, as a named set an
 * assertion reads: the rule `ProgressRing` genuinely cannot follow is
 * skipped for it by name, every other rule still runs, and the claim
 * "this one resolves no colours of its own" is now something a test
 * fails if it stops being true.
 */
const RECIPE_FILES = readdirSync(fileURLToPath(new URL(".", import.meta.url)))
  .filter((entry) => entry.endsWith(".tsx"))
  .map((entry) => entry.slice(0, -".tsx".length))
  .sort();

/**
 * The recipes that resolve their own colours, and so must call
 * `useTheme()`.
 *
 * `ProgressRing` is the one that does not, deliberately: it is a pure
 * drawing whose `trackColor`/`arcColor` arrive as already-resolved
 * token colours from the caller, which is what lets two callers paint
 * the same arc in their own band colours without the drawing knowing
 * what a band is. It still has to carry no raw hex — that check runs
 * over every recipe — and its own doc comment states the contract.
 *
 * T360 wrote this reason down, in its ledger section. What it could
 * not do was put the reason anywhere a test would read: an absence
 * from an array carries no argument with it, and the next person to
 * add a recipe sees no absence at all. Named here, the exemption is
 * narrow (it skips one rule, not all of them) and it is checked — if
 * this file ever starts resolving its own colours, the case below
 * fails and the exemption has to be argued again or deleted.
 */
const THEME_EXEMPT_RECIPES = new Set(["ProgressRing"]);

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

    it(`${name} reads its styling from useTheme(), or is a stated exemption`, () => {
      const code = readRecipeCode(name);
      if (THEME_EXEMPT_RECIPES.has(name)) {
        // An exemption has to earn itself: the colours must arrive as
        // props, not be absent because the recipe paints nothing.
        expect(code).toMatch(/Color: string/);
        expect(code).not.toMatch(/useTheme\(\)/);
        return;
      }
      expect(code).toMatch(/useTheme\(\)/);
    });
  }
});

describe("§10.4 recipes: reduced-motion via shared motion tokens", () => {
  // `ShimmerText` is deliberately absent (T359): its 1.4s cycle has
  // no `motion.duration` token to read — that table tops out at
  // `entrance` = 600ms — so it carries a named exported constant
  // instead, pinned by `./ShimmerText.test.ts` along with the
  // reason. Listing it here would assert a rule it does not follow
  // and could not.
  //
  // T377: the set is derived, not typed out, for the same reason
  // `RECIPE_FILES` above now is — a recipe that starts animating is
  // caught by the import it has to add, rather than by someone
  // remembering to extend an array. `ShimmerText` stays an exemption,
  // stated here and asserted below, instead of an omission.
  const MOTION_TOKEN_EXEMPT = new Set(["ShimmerText"]);
  /** Calls a Reanimated timing helper itself, rather than delegating to a shared hook that owns the duration. */
  const DECLARES_OWN_TIMING = /with(?:Timing|Repeat|Delay|Spring)\(/;
  const reanimated = RECIPE_FILES.filter((name) =>
    /react-native-reanimated/.test(readRecipeCode(name)),
  );
  const animated = reanimated.filter(
    (name) => DECLARES_OWN_TIMING.test(readRecipeCode(name)) && !MOTION_TOKEN_EXEMPT.has(name),
  );
  const delegating = reanimated.filter((name) => !DECLARES_OWN_TIMING.test(readRecipeCode(name)));

  it("finds the animated recipes by their own source, and still finds several", () => {
    // Floors, so a regex that stopped matching would empty these loops
    // into a silent pass rather than a failure.
    expect(reanimated.length).toBeGreaterThanOrEqual(4);
    expect(animated.length).toBeGreaterThanOrEqual(3);
    expect(animated).toContain("ThinkingSection");
    expect(animated).not.toContain("ShimmerText");
  });

  it("ShimmerText is exempt because it animates and has no token to read, not because it is still", () => {
    const code = readRecipeCode("ShimmerText");
    expect(code).toMatch(DECLARES_OWN_TIMING);
    expect(code).not.toMatch(/motion\.duration/);
  });

  for (const name of delegating) {
    // T377: a recipe can import Reanimated and own no duration at all —
    // `ScreenBar` animates its bar actions entirely through
    // `usePressScale`, which reads `motion.duration.fast` and no-ops
    // under `reduceMotion`. Requiring `motion.duration` in its own text
    // would be asking it to restate a number it correctly does not own;
    // what it must not do is hardcode one.
    it(`${name} delegates its timing to a shared motion hook, and hardcodes no duration`, () => {
      const code = readRecipeCode(name);
      expect(code).toMatch(/use(?:PressScale|Theme)\(/);
      expect(code).not.toMatch(/duration:\s*\d/);
    });
  }
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

describe("BashBlock: the shell block states its state in words (T359)", () => {
  it("prints a literal $ and the literal word Running, so neither the green nor the shimmer is load-bearing", () => {
    const code = readRecipeCode("BashBlock");
    expect(code).toMatch(/\{`\$ \$\{command\}`\}/);
    expect(code).toMatch(/Running…/);
  });

  it("names the control that stops the command instead of a key this device has not got", () => {
    expect(readRecipeCode("BashBlock")).not.toMatch(/esc to cancel/);
  });
});

describe("ShimmerText: the words survive the animation being off (T359)", () => {
  it("renders its children either way, in a theme colour", () => {
    const code = readRecipeCode("ShimmerText");
    expect(code).toMatch(/\{children\}/);
    expect(code).toMatch(/active \? animatedStyle : null/);
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
