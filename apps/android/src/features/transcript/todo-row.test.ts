import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T360 source-level contract for `todo-row.tsx`. The row imports
 * `react-native`, so it cannot render under this workspace's plain
 * `vitest` setup; `readCode()` strips comments first, so a claim made
 * only in a doc comment can never satisfy an assertion.
 *
 * Every number, glyph, token key and announced sentence this row draws
 * is decided by `./todo-row-model.ts` and proven by execution there.
 * What these cases pin is that the drawing actually asks that model,
 * rather than re-deciding any of it here.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./todo-row.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("todo-row.tsx: the artifact's .ov widget (T360)", () => {
  it("asks the model for every tint, rather than picking colours here", () => {
    const code = readCode();
    expect(code).toMatch(/theme\.colors\[todoGlyphInk\(row\.state\)\]/);
    expect(code).toMatch(/theme\.colors\[todoSubjectInk\(row\.state\)\]/);
    expect(code).toMatch(/theme\.colors\[ringInk\(progress\)\]/);
    expect(code).toMatch(/theme\.colors\[todoHeadInk\(progress\)\]/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
  });

  it("draws the ring through the shared recipe and feeds it the model's own numbers", () => {
    const code = readCode();
    expect(code).toMatch(/<ProgressRing\b/);
    expect(code).toMatch(/dashOffset=\{ringDashOffset\(progress\.fraction\)\}/);
    expect(code).toMatch(/circumference=\{RING_CIRCUMFERENCE\}/);
    // No second source for a number the model already owns.
    expect(code).not.toMatch(/Math\.PI/);
  });

  it("sizes the ring box from the radius and stroke, not from a second literal", () => {
    expect(readCode()).toMatch(/const RING_SIZE = RING_RADIUS \* 2 \+ RING_STROKE;/);
  });

  it("prints each row's glyph beside its subject, with no tree connector and no `#n`", () => {
    const code = readCode();
    expect(code).toMatch(/\{todoGlyph\(row\.state\)\}/);
    expect(code).toMatch(/\{row\.subject\}/);
    // The artifact's `.ov-row` is `✓/◐/○ + subject`; the tree and the
    // ordinal this used to draw belonged to the transcript row it no
    // longer is. (The hint line below still opens with its own `└─`.)
    expect(code).not.toMatch(/row\.number/);
    expect(code).not.toMatch(/row\.connector/);
  });

  it("draws the artifact's own `.ov` shape: radius 12, 8×10 padding, an 8 bottom margin", () => {
    const code = readCode();
    expect(code).toMatch(/const OVERLAY_RADIUS = 12;/);
    expect(code).toMatch(/const OVERLAY_PADDING_VERTICAL = 8;/);
    expect(code).toMatch(/const OVERLAY_PADDING_HORIZONTAL = 10;/);
    expect(code).toMatch(/const OVERLAY_MARGIN_BOTTOM = 8;/);
    expect(code).toMatch(/borderRadius: OVERLAY_RADIUS/);
  });

  it("prints the count in the head, beside the ring", () => {
    expect(readCode()).toMatch(/todoHeadGlyph\(progress\)\}.*todoHeadline\(progress\)/);
  });

  it("hides the ring from assistive tech and announces the widget through the head control", () => {
    const code = readCode();
    expect(code).toMatch(/accessibilityElementsHidden/);
    expect(code).toMatch(/importantForAccessibility="no-hide-descendants"/);
    expect(code).toMatch(/accessibilityLabel=\{todoAccessibilityLabel\(entry\.items\)\}/);
  });

  it("makes the head a real button with expanded state, so the collapse is reachable and announced", () => {
    const code = readCode();
    expect(code).toMatch(/accessibilityRole="button"/);
    expect(code).toMatch(/accessibilityState=\{\{ expanded: !collapsed \}\}/);
    expect(code).toMatch(/useState\(false\)/);
    expect(code).toMatch(/setCollapsed\(\(current\) => !current\)/);
  });

  it("hides the rows and the hint while collapsed, exactly as `.ov.closed` does", () => {
    const code = readCode();
    expect(code).toMatch(/collapsed\s*\? null\s*:\s*rows\.map/);
    expect(code).toMatch(/tap the ring to collapse/);
    expect(code).toMatch(/const HINT_FONT_SIZE = 10\.5;/);
  });

  it("strikes a done row through, from the model's own flag", () => {
    const code = readCode();
    expect(code).toMatch(/row\.struck \? styles\.struck : null/);
    expect(code).toMatch(/struck: \{ textDecorationLine: "line-through" \}/);
  });

  it("is a raised Card, which is what the artifact's surface-plus-shadow is", () => {
    const code = readCode();
    expect(code).toMatch(/<Card\b/);
    // A restated shadow here would be a second definition of a tier
    // `ringShadow` already owns.
    expect(code).not.toMatch(/shadowOpacity/);
    expect(code).not.toMatch(/elevation:/);
  });

  it("draws no (form) tag, because nothing on the wire says an item is waiting on one", () => {
    expect(readCode()).not.toMatch(/\(form\)/);
  });

  it("memoises the row, like every other transcript row", () => {
    expect(readCode()).toMatch(/memo\(TranscriptTodoRowImpl\)/);
  });
});
