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

  it("insets and lifts the floating panel by the artifact's own numbers", () => {
    const code = readCode();
    expect(code).toMatch(/const POP_INSET = 10;/);
    expect(code).toMatch(/const POP_BOTTOM = 78;/);
    expect(code).toMatch(
      /scrimFloating: \{ paddingHorizontal: POP_INSET, paddingBottom: POP_BOTTOM \}/,
    );
  });

  it("closes all four corners on the floating panel, not just the top two", () => {
    const code = readCode();
    expect(code).toMatch(/panelFloating: \{\s*borderRadius: theme\.radii\.window/);
  });

  it("keeps ONE scrim, portal, focus move and back gesture for both variants", () => {
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

  it("re-renders the memoised panel when the variant or the hint changes", () => {
    // Both are read inside the `useMemo`; leaving them out of its
    // dependency list would freeze the first variant a caller mounted.
    expect(readCode()).toMatch(/children,\s*variant,\s*footerHint\]/);
  });

  it("still opens no Modal in either variant", () => {
    const code = readCode();
    expect(code).not.toMatch(/<Modal\b/);
  });
});
