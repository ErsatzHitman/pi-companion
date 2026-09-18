import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T366 source-level contract for `Section.tsx`'s `label` variant. The
 * file imports `react-native`, which this workspace's plain `vitest`
 * cannot parse (`CLAUDE.md`), so the contract is read off the source
 * with comments stripped — a claim made only in the doc comment can
 * never satisfy an assertion here.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./Section.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("Section: the redesign's quiet `.lbl` heading (T366)", () => {
  it("defaults to the original heading, so no existing caller moves", () => {
    expect(readCode()).toMatch(/variant = "heading"/);
  });

  it("draws the label variant at the artifact's real size, weight, tracking and padding", () => {
    // `.lbl{font:500 10px/1 'JetBrains Mono',monospace;letter-spacing:
    // .09em;text-transform:uppercase;color:var(--ink-3);padding:2px 4px}`
    // — measured directly against the confirmed spec. The prior `9.5px`
    // at `fontWeight.bold`, a hardcoded `LABEL_LETTER_SPACING = 0.95`,
    // and a `paddingTop`-only `8` each matched no rule there.
    const code = readCode();
    expect(code).toMatch(/const LABEL_FONT_SIZE = 10;/);
    expect(code).toMatch(/const LABEL_PADDING_VERTICAL = 2;/);
    expect(code).toMatch(/const LABEL_PADDING_HORIZONTAL = 4;/);
    expect(code).toMatch(/paddingVertical: LABEL_PADDING_VERTICAL/);
    expect(code).toMatch(/paddingHorizontal: LABEL_PADDING_HORIZONTAL/);
    expect(code).toMatch(/fontWeight: asFontWeight\(theme\.typography\.fontWeight\.medium\)/);
    expect(code).toMatch(/textTransform: "uppercase"/);
    expect(code).not.toMatch(/const LABEL_FONT_SIZE = 9\.5;/);
    expect(code).not.toMatch(/LABEL_LETTER_SPACING/);
    expect(code).not.toMatch(/LABEL_PADDING_TOP/);
    expect(code).not.toMatch(/theme\.typography\.fontWeight\.bold/);
  });

  it("scales the theme's em-ratio tracking into React Native's absolute dp", () => {
    // `NativeTypography` (packages/design-tokens/src/native.ts) exposes no
    // top-level `letterSpacing` map, only `variant.<name>.letterSpacing`,
    // and `variant.label` carries `typography.letterSpacing.wide` UNSCALED.
    // That token is an em RATIO, not a length: `web.ts`'s emitter writes
    // every `letterSpacing` token as `${value}em`. `.lbl` is `.09em` on a
    // `10px` font, so the design figure is 0.9dp; spending the variant
    // value directly would track at 0.09dp, 10x too tight. `buildTypeStyle`
    // converts the sibling relative token via `resolveNativeLineHeight`
    // (`fontSize * multiplier`) and has no `letterSpacing` counterpart, so
    // the multiplication is done at this call site.
    const code = readCode();
    expect(code).toMatch(
      /letterSpacing: theme\.typography\.variant\.label\.letterSpacing \* LABEL_FONT_SIZE,/,
    );
    // The bare, unscaled read is the regression this pins against.
    expect(code).not.toMatch(/letterSpacing: theme\.typography\.variant\.label\.letterSpacing,/);
  });

  it("takes every colour and face from the theme", () => {
    const code = readCode();
    expect(code).toMatch(/color: theme\.colors\["ink-3"\]/);
    expect(code).toMatch(/fontFamily: theme\.typography\.variant\.code\.fontFamily/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("keeps ONE heading node, with the same role in both variants", () => {
    // `textTransform` is a visual transform TalkBack does not speak, so
    // the announced name stays the string the caller passed. A second
    // Text for the label variant would have changed that.
    const code = readCode();
    const headers = code.match(/accessibilityRole="header"/g) ?? [];
    expect(headers).toHaveLength(1);
    expect(code).toMatch(
      /style=\{\[styles\.title, variant === "label" \? styles\.titleLabel : null\]\}/,
    );
  });

  it("still reports the heading's own layout, which Composer sums", () => {
    expect(readCode()).toMatch(/onLayout=\{onTitleLayout\}/);
  });
});
