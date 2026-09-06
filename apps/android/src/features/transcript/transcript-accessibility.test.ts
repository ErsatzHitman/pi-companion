import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T33A1 source-level accessibility/theming checks for `header.tsx` and
 * `status-strip.tsx`. Both import `react-native` (via `../../ui/
 * primitives`), which can't be rendered under this workspace's plain
 * `vitest` setup — see `../extensions/renderers/log-model.ts`'s doc
 * comment, and the identical pattern in
 * `../../ui/recipes/recipe-accessibility.test.ts` and
 * `../../ui/primitives/touch-targets.test.ts`. This statically verifies
 * the contracts a render/TalkBack pass would otherwise check.
 */
const FILES = ["header", "status-strip"];

function readSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}.tsx`, import.meta.url)), "utf8");
}

/**
 * `readSource` with comments stripped. `header.tsx` quotes
 * `accessibilityLiveRegion="polite"` inside its own doc comment, so an
 * unanchored regex over the raw file text is satisfied by that prose
 * alone and stays green even when the real JSX prop is deleted.
 * Assertions that must reach actual code read through this instead.
 */
function readCode(name: string): string {
  return readSource(name)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("T33A1 header/status strip: no raw hex, theme-only styling", () => {
  for (const name of FILES) {
    it(`${name}.tsx contains no raw hex colour literal`, () => {
      // Comment-stripped: a doc comment mentioning a hex colour in prose
      // (e.g. "previously #ff0000") must never trip this — only a real
      // colour literal in code should.
      expect(readCode(name)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
  }

  it("header.tsx reads its styling from useTheme()", () => {
    expect(readSource("header")).toMatch(/useTheme\(\)/);
  });
});

describe("T33A1 header/status strip: status conveyed in text as well as colour", () => {
  it("header.tsx composes Section + Chip (title as heading text, status as a labelled chip)", () => {
    const source = readSource("header");
    expect(source).toMatch(/<Section title=\{model\.title\}>/);
    expect(source).toMatch(/<Chip label=\{model\.chipLabel\} tone=\{model\.tone\}/);
  });

  it("status-strip.tsx composes StatusIndicator, which pairs its coloured dot with visible statusText", () => {
    const source = readSource("status-strip");
    expect(source).toMatch(/<StatusIndicator\b/);
    expect(source).toMatch(/statusText=\{model\.statusText\}/);
  });
});

describe("T33A1 header/status strip: TalkBack announces status changes", () => {
  it('header.tsx wraps itself in an accessibilityLiveRegion="polite" node with a status-derived label', () => {
    const source = readCode("header");
    expect(source).toMatch(/accessibilityLiveRegion="polite"/);
    expect(source).toMatch(/accessibilityLabel=\{model\.accessibilityLabel\}/);
  });

  it('status-strip.tsx delegates to StatusIndicator, which itself sets accessibilityLiveRegion="polite"', () => {
    // StatusIndicator.tsx (../../ui/primitives/StatusIndicator.tsx) is the
    // one actually setting the live region; this only proves status-strip
    // renders it with the label/statusText model output, not a static string.
    // Comment-stripped (T130): `StatusIndicator.tsx`'s own doc comment
    // quotes `accessibilityLiveRegion="polite"` verbatim, so an
    // unanchored regex over its raw file text is satisfied by that prose
    // alone and stays green even when the real prop is deleted.
    const statusIndicatorSource = readFileSync(
      fileURLToPath(new URL("../../ui/primitives/StatusIndicator.tsx", import.meta.url)),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(statusIndicatorSource).toMatch(/accessibilityLiveRegion="polite"/);
    const source = readSource("status-strip");
    expect(source).toMatch(/label=\{model\.label\}/);
    expect(source).not.toMatch(/statusText="[^"]*"/); // never a hardcoded status string
  });
});
