import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  INITIAL_COMPOSER_FOCUS_STATE,
  focusComposer,
  openSheet,
  resolveFocusOwner,
} from "../../features/composer/composer-focus-model";

/**
 * T32S5: `Sheet.tsx` no longer renders a React Native `Modal` (plan.md
 * §9.3 "use Portal rather than a detached Modal where required").
 *
 * `Sheet.tsx` imports `react-native`, which can't be rendered under this
 * workspace's plain `vitest` setup (the RolldownError on react-native's
 * own Flow-typed `index.js`, hit repeatedly across this codebase — see
 * `../recipes/recipe-accessibility.test.ts`'s doc comment), so this
 * statically verifies the source contract instead.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./Sheet.tsx", import.meta.url)), "utf8");
}

/**
 * `readSource` with comments stripped. `Sheet.tsx`'s own doc comment
 * talks about `Modal` at length (explaining why it's *not* used), so an
 * unanchored regex over the raw file text would pass even if the real
 * `<Modal>` JSX came back — see `../../features/transcript/
 * transcript-accessibility.test.ts`'s identical `readCode` helper and
 * its doc comment for the exact failure mode this avoids.
 */
function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("Sheet: no detached Modal (plan.md §9.3)", () => {
  it("imports nothing named Modal from react-native", () => {
    expect(readCode()).not.toMatch(/\bModal\b/);
  });

  it("renders its panel through the Portal primitive instead", () => {
    // Must match the *call*, not the `import { usePortalOutlet } from
    // "./Portal";` line — a bare `/usePortalOutlet/` was satisfied by the
    // import alone, so deleting the real call site left this green
    // (reproduced and fixed at the P5-W9 merge gate). Anchoring on the
    // argument list is what makes this assertion track the wiring.
    expect(readCode()).toMatch(
      /usePortalOutlet\(\s*`sheet-\$\{sheetId\}`\s*,\s*panel\s*,\s*open\s*\)/,
    );
  });
});

/**
 * "A sheet opening does not move focus ownership away from the
 * composer, proven against T33B4's resolveFocusOwner" (this task's
 * acceptance criterion). Two facts compose to prove it:
 *
 * 1. Above: `Sheet.tsx` opens no `<Modal>` — the only RN API in reach
 *    here that would actually move real keyboard/IME focus by opening a
 *    second native Window. Its other native call, inside
 *    `useModalBehavior`, is `AccessibilityInfo.setAccessibilityFocus`,
 *    which moves TalkBack's *reading* cursor, not IME focus.
 * 2. `composer-focus-model.ts`'s `resolveFocusOwner` (T33B4, unowned
 *    this wave — read, not edited, here) already proves opening an
 *    `"extension"` sheet is a no-op for whoever owns focus, exercised
 *    again below directly against the real function so this file does
 *    not just take that claim on faith.
 */
describe("Sheet opening does not move focus ownership away from the composer", () => {
  it("resolveFocusOwner stays 'composer' across an extension sheet open, given Sheet itself moves no real focus", () => {
    const focused = focusComposer(INITIAL_COMPOSER_FOCUS_STATE);
    expect(resolveFocusOwner(focused)).toBe("composer");

    const withSheetOpen = openSheet(focused, "extension");
    expect(resolveFocusOwner(withSheetOpen)).toBe("composer");
  });
});

describe("Sheet: the redesign's floating `.pop` variant (T361)", () => {
  it("defaults to the edge-anchored panel, so no existing caller moves", () => {
    expect(readCode()).toMatch(/variant = "edge"/);
  });

  it("insets and lifts the floating panel by the confirmed spec's own numbers", () => {
    const code = readCode();
    // CORRECTED, W14-PMENU: T387 quoted these from the STALE reference
    // checkout, not the confirmed spec. `android-spec.html`'s `.pop`
    // reads `left:10px;right:10px;bottom:78px`, so the inset is 10, not
    // the 12 this file shipped with. `POP_BOTTOM` is unchanged: the
    // artifact's 78px clears its own prompt bar.
    expect(code).toMatch(/const POP_INSET = 10;/);
    expect(code).toMatch(/const POP_BOTTOM = 78;/);
    expect(code).toMatch(
      /scrimFloating: \{ paddingHorizontal: POP_INSET, paddingBottom: POP_BOTTOM \}/,
    );
  });

  it("closes all four corners on the floating panel, at the shared overlay radius token", () => {
    const code = readCode();
    // CORRECTED, W14-PMENU: `android-spec.html`'s `.pop` reads
    // `padding:12px 14px;border-radius:var(--r-lg)` — the vertical
    // padding is 12, not T387's stale 13, and the radius is the shared
    // `EXPRESSIVE_RADIUS_LG` token (`../theme/expressive-shape.ts`), not
    // a private numeric literal.
    expect(code).toMatch(/panelFloating: \{\s*borderRadius: EXPRESSIVE_RADIUS_LG/);
    expect(code).not.toMatch(/const POP_RADIUS/);
    expect(code).toMatch(/const POP_PADDING_VERTICAL = 12;/);
    expect(code).toMatch(/const POP_PADDING_HORIZONTAL = 14;/);
  });

  it("keeps ONE scrim, portal, focus move and back gesture across all variants", () => {
    // The whole reason this is a variant and not a second component.
    const code = readCode();
    expect(code).toMatch(/useModalBehavior\(open, onClose\)/);
    expect(code).toMatch(/usePortalOutlet\(`sheet-\$\{sheetId\}`, panel, open\)/);
    const scrims = code.match(/styles\.scrim\b/g) ?? [];
    expect(scrims).toHaveLength(1);
  });

  it("draws the footer hint only when the caller gives one", () => {
    const code = readCode();
    expect(code).toMatch(/footerHint === undefined \|\| footerHint\.length === 0 \? null :/);
  });

  it("re-renders the memoised panel when the variant, the hint, or reduced motion changes", () => {
    // All three are read inside the `useMemo`; leaving one out of its
    // dependency list would freeze the first value a caller mounted.
    expect(readCode()).toMatch(/children,\s*variant,\s*footerHint,\s*reduceMotion,?\s*\]/);
  });

  it("still opens no Modal in any variant", () => {
    const code = readCode();
    expect(code).not.toMatch(/<Modal\b/);
  });
});

describe("Sheet: the redesign's lifted `.pmenu` variant (W14-PMENU)", () => {
  it("SheetVariant includes 'menu'", () => {
    expect(readCode()).toMatch(/export type SheetVariant = "edge" \| "floating" \| "menu";/);
  });

  it("clears both the pill row and the prompt bar, per the spec's own stated reason", () => {
    const code = readCode();
    // `android-spec.html`'s `.pmenu` reads `bottom:98px;padding:8px` —
    // clearing more than `.pop`'s 78px because the menu also has to
    // clear the pill row sitting above the prompt bar.
    expect(code).toMatch(/const MENU_BOTTOM = 98;/);
    expect(code).toMatch(/const MENU_PADDING = 8;/);
    expect(code).toMatch(
      /scrimMenu: \{ paddingHorizontal: POP_INSET, paddingBottom: MENU_BOTTOM \}/,
    );
    expect(code).toMatch(/panelMenu: \{[\s\S]*?padding: MENU_PADDING,?\s*\}/);
  });

  it("shares the floating variant's side inset and radius token rather than repeating them", () => {
    const code = readCode();
    // Both `scrimFloating`/`scrimMenu` read `POP_INSET`, and both
    // `panelFloating`/`panelMenu` read `EXPRESSIVE_RADIUS_LG` — exactly
    // two style declarations, no second inset or radius constant.
    const radiusUses = code.match(/borderRadius: EXPRESSIVE_RADIUS_LG/g) ?? [];
    expect(radiusUses).toHaveLength(2);
    const insetUses = code.match(/paddingHorizontal: POP_INSET/g) ?? [];
    expect(insetUses).toHaveLength(2);
  });

  it("is NOT rendered with the edge default's radius, since it opens its own panelMenu style instead", () => {
    const code = readCode();
    expect(code).toMatch(
      /variant === "floating" \? styles\.panelFloating : variant === "menu" \? styles\.panelMenu : null/,
    );
  });

  it("fades and lifts in on open, from the shared fade-up tokens, scoped to the menu variant alone", () => {
    const code = readCode();
    expect(code).toMatch(/function menuPanelEntering\(\): EntryExitAnimationFunction/);
    expect(code).toMatch(/duration: EXPRESSIVE_FADE_UP_DURATION_MS\.menu/);
    expect(code).toMatch(/easing: Easing\.bezier\(\.\.\.EXPRESSIVE_FADE_UP_EASING\)/);
    expect(code).toMatch(/translateY: EXPRESSIVE_FADE_UP_FROM_TRANSLATE_Y/);
    // Only the menu variant's panel is ever handed the entering builder.
    expect(code).toMatch(/variant === "menu" && !reduceMotion/);
    expect(code).toMatch(
      /<Animated\.View entering=\{menuPanelEntering\(\)\}>\{panelView\}<\/Animated\.View>/,
    );
  });

  // `panel` is the BASE style for every variant, and it names
  // `borderTopLeftRadius`/`borderTopRightRadius` so the edge variant
  // draws a square-bottomed sheet. React Native resolves a per-corner
  // longhand ahead of the `borderRadius` shorthand regardless of which
  // object in the style array set it, so a lifted variant that declared
  // only `borderRadius` would keep `panel`'s much smaller top corners
  // and draw lopsided. Nothing about that is ill-typed and no render
  // test in this workspace could catch it, so it is pinned here at the
  // source level for BOTH lifted variants.
  it("names all four corners on each lifted variant, so panel's edge-variant longhands cannot override them", () => {
    const code = readCode();
    expect(code).toMatch(
      /panelFloating: \{\s*borderRadius: EXPRESSIVE_RADIUS_LG,\s*borderTopLeftRadius: EXPRESSIVE_RADIUS_LG,\s*borderTopRightRadius: EXPRESSIVE_RADIUS_LG,/,
    );
    expect(code).toMatch(
      /panelMenu: \{\s*borderRadius: EXPRESSIVE_RADIUS_LG,\s*borderTopLeftRadius: EXPRESSIVE_RADIUS_LG,\s*borderTopRightRadius: EXPRESSIVE_RADIUS_LG,/,
    );
    // The base panel still carries them, which is the whole reason the
    // two above have to: deleting them there would square the edge
    // variant's own top corners.
    expect(code).toMatch(/panel: \{[\s\S]*?borderTopLeftRadius: theme\.radii\.window,/);
  });

  it("skips the entrance under reduced motion, the same gate every other animated primitive uses", () => {
    const code = readCode();
    expect(code).toMatch(/const \{ theme, reduceMotion \} = useTheme\(\);/);
    expect(code).toMatch(/variant === "menu" && !reduceMotion \? \(/);
  });
});
