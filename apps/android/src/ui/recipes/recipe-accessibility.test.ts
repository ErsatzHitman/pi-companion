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
  //
  // P10-GATE: `PixelLoader` joins it for the identical, stated reason,
  // not as a way around a failing assertion. Its cycle is the artifact's
  // `.pxl i{animation:pixel-on .65s ...}` — 650ms — while `motion.duration`
  // tops out at `entrance` = 600ms (checked in `packages/design-tokens`'s
  // own `MotionDurationTokens` table, not assumed), so there is no token
  // for it to read either. Like `ShimmerText` it carries a named exported
  // constant instead (`EXPRESSIVE_PIXEL_CYCLE_MS` and its siblings, in
  // `../theme/expressive-motion`), and the loop below asserts that of
  // every member of this set rather than taking an exemption on trust.
  //
  // A-MOTION-2: `StreamingMessage` joins it too, for its own resting-caret
  // blink (`EXPRESSIVE_CARET_BLINK_DURATION_MS` — the artifact's `1s`
  // `caret-blink`, likewise absent from `motion.duration`).
  const MOTION_TOKEN_EXEMPT = new Set(["ShimmerText", "PixelLoader", "StreamingMessage"]);
  /** Calls a Reanimated timing helper itself, rather than delegating to a shared hook that owns the duration. */
  const DECLARES_OWN_TIMING = /with(?:Timing|Repeat|Delay|Spring)\(/;
  const reanimated = RECIPE_FILES.filter((name) =>
    /react-native-reanimated/.test(readRecipeCode(name)),
  );
  const timingDeclaring = reanimated.filter((name) =>
    DECLARES_OWN_TIMING.test(readRecipeCode(name)),
  );
  const animated = timingDeclaring.filter((name) => !MOTION_TOKEN_EXEMPT.has(name));
  const delegating = reanimated.filter((name) => !DECLARES_OWN_TIMING.test(readRecipeCode(name)));

  it("finds the animated recipes by their own source, and still finds several", () => {
    // Floors, so a regex that stopped matching would empty these loops
    // into a silent pass rather than a failure.
    expect(reanimated.length).toBeGreaterThanOrEqual(4);
    // P10-GATE: this floor read `animated.length >= 3` — a count taken
    // AFTER the exemptions were subtracted — so registering a second
    // legitimate exemption broke it even though both regexes still match
    // everything they ever matched. Narrowed to the population the floor
    // actually protects, which is `DECLARES_OWN_TIMING` continuing to
    // match: if that regex rots, `timingDeclaring` is empty and this
    // fails, which is the entire stated reason the floor exists ("a regex
    // that stopped matching would empty these loops into a silent pass").
    // The post-exemption set is then pinned BY NAME below, which is
    // strictly stronger than the count it replaces — `>= 3` never said
    // which three, so it would have passed on the wrong three.
    expect(timingDeclaring.length).toBeGreaterThanOrEqual(3);
    expect(animated.length).toBeGreaterThanOrEqual(1);
    expect(animated).toContain("ThinkingSection");
    expect(animated).not.toContain("ShimmerText");
    expect(animated).not.toContain("PixelLoader");
    expect(animated).not.toContain("StreamingMessage");
  });

  for (const name of MOTION_TOKEN_EXEMPT) {
    it(`${name} is exempt because it animates and has no token to read, not because it is still`, () => {
      const code = readRecipeCode(name);
      expect(code).toMatch(DECLARES_OWN_TIMING);
      expect(code).not.toMatch(/motion\.duration/);
      // P10-GATE: and it must carry a NAMED exported duration instead, so
      // the exemption cannot be collected by a recipe that simply inlined
      // a magic number — which is what requiring `motion.duration` was
      // there to prevent in the first place.
      expect(code).toMatch(
        /SHIMMER_DURATION_MS|EXPRESSIVE_PIXEL_CYCLE_MS|EXPRESSIVE_CARET_BLINK_DURATION_MS/,
      );
      expect(code).not.toMatch(/duration:\s*\d/);
    });
  }

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

  // P10-GATE: this test was titled "StreamingMessage checks reduceMotion
  // before repeating its cursor animation" and asserted only that the word
  // `reduceMotion` appears somewhere. Both halves were falsified by that
  // wave: the artifact's `.stream-caret.is-streaming{animation:none}` means
  // the caret is SOLID while streaming, so there is no cursor animation
  // left to repeat, and the file no longer imported Reanimated at all. The
  // title was corrected rather than left standing (CLAUDE.md T124).
  //
  // A-MOTION-2 (CORRECTED here again, same rule): the file imports
  // Reanimated once more, for the resting-caret blink `showRestingCaret`
  // now wires up — see `../theme/expressive-motion.test.ts`'s own
  // consumer-contract block for the full shape of that blink. The
  // streaming-caret half this test already pinned (solid, not animated)
  // is unchanged; only the "no Reanimated at all" claim needed correcting.
  it("StreamingMessage holds its caret solid while streaming, hands its shimmer caption to ShimmerText, and owns only the resting caret's own timing", () => {
    const code = readRecipeCode("StreamingMessage");
    expect(code).toMatch(/reduceMotion/);
    // The shimmer caption is still delegated, gated on the device setting,
    // and owned by the recipe that holds that duration constant.
    expect(code).toMatch(/<ShimmerText\b[^>]*active=\{!reduceMotion\}/);
    // The streaming caret itself is still a plain, unanimated View.
    expect(code).toMatch(/<View style=\{styles\.cursor\} accessibilityElementsHidden \/>/);
    // Its only own Reanimated timing is the resting caret's hard blink,
    // behind the `showRestingCaret` opt-in — this file is a declared
    // MOTION_TOKEN_EXEMPT member below for exactly that reason.
    expect(code).toMatch(DECLARES_OWN_TIMING);
    expect(code).toMatch(/react-native-reanimated/);
  });

  // P10-GATE: this test was titled "renders every cell fully lit" and
  // asserted `opacity.value = 1`. That pinned a defect, not a contract:
  // the design artifact's own reduced-motion override, grepped directly
  // from `android-spec.html`, is `.pxl i{opacity:.15}` — uniformly DIM,
  // not lit. The expectation is corrected to match the artifact, rather
  // than the implementation being reverted to satisfy a wrong assertion.
  it("PixelLoader rests every cell at the artifact's dim opacity, and animates nothing, under reduced motion", () => {
    const code = readRecipeCode("PixelLoader");
    expect(code).toMatch(/animate=\{!reduceMotion\}/);
    expect(code).toMatch(/if \(!animate\) \{\s*opacity\.value = EXPRESSIVE_PIXEL_REST_OPACITY;/);
    // The rest value arrives from the shared module, not as a number
    // retyped here — and specifically is no longer full opacity.
    expect(code).not.toMatch(/opacity\.value = 1;/);
  });
});

// P10-W17: none of these four caret constants is asserted anywhere in the
// repository (`git grep -ln` on each name returns only StreamingMessage.tsx
// itself), so a revert of any one back to its pre-fix value would pass
// every other check silently. Pinned against android-spec.html's own
// `.stream-caret{width:2px;height:1.05em;margin-left:1.5px;
// border-radius:1px;background:var(--ink)}`, read directly from
// StreamingMessage.tsx's source rather than retyped from this task's brief.
describe("StreamingMessage: the resting caret's own size/position constants match the artifact's .stream-caret (P10-W17)", () => {
  it("sizes the caret's height off the transcript font, at the spec's 1.05 ratio (CARET_HEIGHT_TO_FONT_SIZE_RATIO)", () => {
    const code = readRecipeCode("StreamingMessage");
    expect(code).toMatch(/const CARET_HEIGHT_TO_FONT_SIZE_RATIO = 1\.05;/);
    expect(code).toMatch(/const CARET_HEIGHT = LINE_FONT_SIZE \* CARET_HEIGHT_TO_FONT_SIZE_RATIO;/);
  });

  it("rounds the caret's corners by the spec's 1px (CARET_CORNER_RADIUS)", () => {
    const code = readRecipeCode("StreamingMessage");
    expect(code).toMatch(/const CARET_CORNER_RADIUS = 1;/);
    expect(code).toMatch(/borderRadius: CARET_CORNER_RADIUS,/);
  });

  it("offsets the caret from the text by the spec's 1.5px literal (CARET_MARGIN_LEFT)", () => {
    const code = readRecipeCode("StreamingMessage");
    expect(code).toMatch(/const CARET_MARGIN_LEFT = 1\.5;/);
    expect(code).toMatch(/marginLeft: CARET_MARGIN_LEFT,/);
  });

  it("draws the caret in theme.colors.ink, not the accent hue it used to borrow", () => {
    const code = readRecipeCode("StreamingMessage");
    expect(code).toMatch(/backgroundColor: theme\.colors\.ink,/);
    expect(code).not.toMatch(/backgroundColor: theme\.colors\.accent/);
  });
});

describe("BashBlock: the shell block states its state in words (T359)", () => {
  it("prints a literal $ and the literal word Running, so neither colour nor the shimmer is load-bearing", () => {
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

  // P10-W17: `MARK_BUTTON_SIZE` is asserted nowhere else in the repository
  // (`git grep -ln MARK_BUTTON_SIZE` returns only this recipe's own file),
  // so a revert of its 34->36 fix (matching android-spec.html's
  // `.ic{width:36px;height:36px}`) would pass every other check silently.
  it("ScreenBar sizes its mark box (MARK_BUTTON_SIZE) at the artifact's 36dp .ic square", () => {
    const code = readRecipeCode("ScreenBar");
    expect(code).toMatch(/const MARK_BUTTON_SIZE = 36;/);
  });

  // P10-W17: the title's fontWeight was moved from `semibold` to `medium`
  // to match android-spec.html's `.bar-t{font:500 13.5px/1.3
  // Inter,sans-serif}`; nothing else in the repository names this field.
  it("ScreenBar's title uses the artifact's 500-weight (fontWeight.medium), not semibold", () => {
    const code = readRecipeCode("ScreenBar");
    expect(code).toMatch(/fontWeight: asFontWeight\(theme\.typography\.fontWeight\.medium\)/);
    expect(code).not.toMatch(/fontWeight\.semibold/);
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

  // UI-A3: the mockup's `.blk`/`.blk.usr` (docs/ui-reference/
  // pi-companion-app.html) distinguishes a turn's speaker by tint alone
  // and draws no "You"/"Pi" label -- this recipe used to render one
  // unconditionally. TalkBack must keep announcing the speaker either way.
  it("StreamingMessage always announces the speaker via accessibilityLabel, and only draws it as visible text when a caller opts in", () => {
    const code = readRecipeCode("StreamingMessage");
    expect(code).toMatch(
      /accessibilityLabel=\{`\$\{speakerLabel\}\$\{streaming \? " \(responding\)" : ""\}: \$\{text\}`\}/,
    );
    expect(code).toMatch(/showSpeakerLabel\?: boolean;/);
    expect(code).toMatch(/showSpeakerLabel = false,/);
    expect(code).toMatch(
      /\{showSpeakerLabel \? <Text style=\{styles\.speaker\}>\{speakerLabel\}<\/Text> : null\}/,
    );
  });
});

/**
 * A-MOTION-2: `StatusPill` (`../primitives/StatusPill.tsx`) is not a
 * recipe — it is outside `RECIPE_FILES`, and outside `../primitives`'
 * own `touch-targets.test.ts` and `component-lab.test.ts` coverage too —
 * so its own `records-pulse` animation has no home in either of this
 * file's derived loops. Extended here by explicit request (this task's
 * brief): read directly, the same `readFileSync`-plus-comment-stripping
 * shape every check above already uses, not folded into `RECIPE_FILES`
 * itself, since that set is genuinely `ui/recipes`-only and widening its
 * `readdirSync` root to cover a primitives directory too would change
 * what every OTHER assertion above means for every other recipe.
 */
function readPrimitiveCode(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../primitives/${name}.tsx`, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("StatusPill (../primitives): the records-pulse is a caller opt-in, reduced-motion gated (A-MOTION-2)", () => {
  const code = () => readPrimitiveCode("StatusPill");

  it("drives the pulse from react-native-reanimated, using the shared records-pulse numbers rather than a re-derived literal", () => {
    const src = code();
    expect(src).toMatch(/from "react-native-reanimated"/);
    expect(src).toMatch(/EXPRESSIVE_RECORDS_PULSE_DURATION_MS/);
    expect(src).toMatch(/EXPRESSIVE_RECORDS_PULSE_EASING/);
    expect(src).toMatch(/EXPRESSIVE_RECORDS_PULSE_REST/);
    expect(src).toMatch(/EXPRESSIVE_RECORDS_PULSE_PEAK/);
  });

  it("takes pulseDot as an explicit caller opt-in and infers nothing from tone", () => {
    const src = code();
    expect(src).toMatch(/pulseDot\?: boolean;/);
    expect(src).toMatch(/pulseDot = false,/);
  });

  it("never pulses under reduced motion, regardless of what the caller asked for", () => {
    expect(code()).toMatch(/pulseDot && showDot && !reduceMotion/);
  });
});
