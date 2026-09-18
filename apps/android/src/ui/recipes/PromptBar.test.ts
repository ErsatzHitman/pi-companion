import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T32S5: `PromptBar.tsx` gained `onFocus`/`onBlur` so `Composer.tsx` can
 * eventually drive T33B4's `composer-focus-model.ts` (`focusComposer`/
 * `blurComposer`) from real events (plan.md §9.3). `PromptBar.tsx`
 * imports `react-native`, so this is a source-level check for the same
 * reason `Sheet.test.ts` and `../recipes/recipe-accessibility.test.ts`
 * are.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./PromptBar.tsx", import.meta.url)), "utf8");
}

function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("PromptBar: forwards real focus/blur events (plan.md §9.3)", () => {
  it("declares onFocus and onBlur on PromptBarProps", () => {
    const code = readCode();
    expect(code).toMatch(/onFocus\?:/);
    expect(code).toMatch(/onBlur\?:/);
  });

  it("wires the TextInput's focus/blur through local handlers, not the bare props directly", () => {
    const code = readCode();
    expect(code).toMatch(/onFocus=\{handleFocus\}/);
    expect(code).toMatch(/onBlur=\{handleBlur\}/);
  });

  it("still calls the forwarded onFocus/onBlur props from those handlers", () => {
    const code = readCode();
    expect(code).toMatch(/onFocus\?\.\(event\)/);
    expect(code).toMatch(/onBlur\?\.\(event\)/);
  });
});

describe("AND-PROMPTBAR: `.cmp-box:focus-within` reaches the box style (was previously dead)", () => {
  it("tracks focus in local state", () => {
    expect(readCode()).toMatch(/const \[isFocused, setIsFocused\] = useState\(false\)/);
  });

  it("applies a focused style variant to the box View", () => {
    expect(readCode()).toMatch(/style=\{\[styles\.box, isFocused \? styles\.boxFocused : null\]\}/);
  });

  it("declares boxFocused with the spec's inset background and an ink-3 ring", () => {
    const code = readCode();
    expect(code).toMatch(/boxFocused:\s*\{[^}]*backgroundColor:\s*theme\.colors\.inset/);
    expect(code).toMatch(/boxFocused:\s*\{[^}]*borderColor:\s*theme\.colors\["ink-3"\]/);
  });
});

describe("AND-PROMPTBAR: box matches the confirmed spec's winning .cmp-box declaration", () => {
  it("centers items instead of the old flex-end", () => {
    expect(readCode()).toMatch(/alignItems:\s*"center"/);
  });

  it("paints on canvas, not surface", () => {
    expect(readCode()).toMatch(/backgroundColor:\s*theme\.colors\.canvas/);
  });

  it("uses the full-round radius token instead of a fixed 18px corner", () => {
    const code = readCode();
    expect(code).toMatch(/borderRadius:\s*theme\.radii\.full/);
    expect(code).not.toMatch(/BOX_RADIUS/);
  });

  it("renders the 1.5px line-strong hairline ring as a border, not the card elevation tier", () => {
    const code = readCode();
    expect(code).toMatch(/borderWidth:\s*BOX_RING_WIDTH/);
    expect(code).toMatch(/borderColor:\s*theme\.colors\["line-strong"\]/);
    expect(code).not.toMatch(/ringShadow/);
  });

  it("uses the spec's 5/6/5/8 padding, not the old 6/6/6/4", () => {
    const code = readCode();
    expect(code).toMatch(/const BOX_PADDING_TOP = 5/);
    expect(code).toMatch(/const BOX_PADDING_BOTTOM = 5/);
    expect(code).toMatch(/const BOX_PADDING_RIGHT = 6/);
    expect(code).toMatch(/const BOX_PADDING_LEFT = 8/);
  });
});

describe("AND-PROMPTBAR: input typography moves to sans, matching the confirmed spec (was mono)", () => {
  it("reads the sans body variant's fontFamily, not the code (mono) variant", () => {
    const code = readCode();
    expect(code).toMatch(/fontFamily:\s*theme\.typography\.variant\.body\.fontFamily/);
  });

  it("still keeps the transcript's own mono family for the queued counter", () => {
    expect(readCode()).toMatch(
      /queued:\s*\{[\s\S]*?fontFamily:\s*theme\.typography\.variant\.code\.fontFamily/,
    );
  });

  it("sets the spec's 13.5px size instead of the old 12px", () => {
    expect(readCode()).toMatch(/const INPUT_FONT_SIZE = 13\.5/);
  });

  it("computes line-height from the spec's 1.45 multiplier, not the old 1.6", () => {
    expect(readCode()).toMatch(/const INPUT_LINE_HEIGHT = INPUT_FONT_SIZE \* 1\.45/);
  });
});

describe("AND-PROMPTBAR: Send icon box agrees with composer-icon-action.tsx's full radius", () => {
  it("sizes the send box at the spec's 36px override, not the shared 34px .ic size", () => {
    expect(readCode()).toMatch(/const SEND_BOX_SIZE = 36/);
  });

  it("radii the send box fully round instead of the old fixed 9px corner", () => {
    const code = readCode();
    expect(code).toMatch(/sendBox:\s*\{[^}]*borderRadius:\s*theme\.radii\.full/);
    expect(code).not.toMatch(/ICON_BOX_RADIUS/);
  });

  it("draws the send icon svg at the spec's 18px (the .ic.send svg override, not the shared .ic svg 19px or the old 17px)", () => {
    expect(readCode()).toMatch(/const SEND_ICON_SIZE = 18/);
  });

  it("gives the send box the spec's drop shadow, which it previously had none of", () => {
    const code = readCode();
    expect(code).toMatch(/sendBox:\s*\{[\s\S]*?shadowOpacity:\s*0\.28/);
  });

  it("FIX-PROMPTBAR: resolves the send box shadow colour from the theme, not a raw hex literal", () => {
    const code = readCode();
    expect(code).toMatch(/sendBox:\s*\{[\s\S]*?shadowColor:\s*theme\.elevation\[1\]\.shadowColor/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("PromptBar: send icon uses the on-accent alias, not --page (UI-A2)", () => {
  it("colours the send icon from accentContrast, matching Button's own text-on-accent-fill token", () => {
    expect(readCode()).toMatch(/color=\{theme\.colors\.accentContrast\}/);
  });

  it("never reads the send icon colour from page (that token is this recipe's own background role, not an on-accent one)", () => {
    expect(readCode()).not.toMatch(/color=\{theme\.colors\.page\}/);
  });

  it("never hardcodes the spec's literal #08131f (no token reproduces it; see the doc comment)", () => {
    expect(readCode()).not.toMatch(/#08131f/);
  });
});

describe("AND-PROMPTBAR: the doc comment cites the confirmed spec, not the stale reconstruction", () => {
  it("carries a CORRECTED marker in front of the preserved stale quotation", () => {
    expect(readSource()).toMatch(/CORRECTED for AND-PROMPTBAR/);
  });

  it("names android-spec.html as the authority", () => {
    expect(readSource()).toMatch(/android-spec\.html.*authority/);
  });
});
