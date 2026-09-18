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

  it("resolves the theme's raw em-ratio tracking into React Native's absolute dp", () => {
    // `NativeTypography` (packages/design-tokens/src/native.ts) now
    // exposes both a top-level raw `letterSpacing` em-ratio map AND a
    // `resolveNativeLetterSpacing(fontSize, letterSpacingEm)` helper that
    // resolves one of those ratios into an absolute dp value —
    // `buildTypeStyle` uses the same helper internally to scale every
    // `variant.<name>.letterSpacing` against that variant's OWN font size
    // (`typography.fontSize.sm` = 11 for `label`). This element renders at
    // `LABEL_FONT_SIZE` = 10, a different size, so it must resolve the raw
    // `theme.typography.letterSpacing.wide` ratio against its own size
    // rather than read the `label` variant's already-scaled value, which
    // is bound to size 11.
    const code = readCode();
    expect(code).toMatch(
      /letterSpacing: resolveNativeLetterSpacing\(\s*LABEL_FONT_SIZE,\s*theme\.typography\.letterSpacing\.wide,?\s*\)/,
    );
    // The bare, unscaled read is one regression this pins against.
    expect(code).not.toMatch(/letterSpacing: theme\.typography\.variant\.label\.letterSpacing,/);
    // The now-wrong, double-scaling multiplication (correct only before
    // `buildTypeStyle` itself scaled `variant.label.letterSpacing`) is the
    // other.
    expect(code).not.toMatch(
      /letterSpacing: theme\.typography\.variant\.label\.letterSpacing \* LABEL_FONT_SIZE,/,
    );
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
