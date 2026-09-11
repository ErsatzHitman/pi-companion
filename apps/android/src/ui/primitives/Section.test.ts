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

  it("draws the label variant at the artifact's size and tracking", () => {
    const code = readCode();
    expect(code).toMatch(/const LABEL_FONT_SIZE = 10;/);
    expect(code).toMatch(/const LABEL_LETTER_SPACING = 0\.9;/);
    expect(code).toMatch(/textTransform: "uppercase"/);
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
