import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T395 source-level contract for `RewindSheet.tsx`.
 *
 * The component's import graph reaches `react-native` (through the shared
 * `Sheet` primitive), which cannot be rendered under this workspace's plain
 * vitest setup — see `../message-row.test.ts` for the same constraint and
 * the `readCode()` pattern this file copies. Every decision the sheet draws
 * is proven by execution in `./rewind-sheet-model.test.ts`; what is left
 * here is that the `.tsx` renders exactly that model and adds nothing of
 * its own: the shared primitive, full-width 48dp rows (plan.md §9.3's floor
 * outranks any mockup box), tokens rather than raw hex, and accessibility
 * labels and test ids on everything a finger can reach.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./RewindSheet.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("T395 Android RewindSheet", () => {
  it("draws through the shared Sheet primitive instead of a panel of its own", () => {
    const source = readCode();
    expect(source).toMatch(/<Sheet/);
    expect(source).toMatch(/open=\{model\.open\}/);
    expect(source).toMatch(/onClose=\{onClose\}/);
  });

  it("renders the model's own labels, actions and heading rather than recomputing them", () => {
    const source = readCode();
    expect(source).toMatch(/\{model\.scopes\.map\(/);
    expect(source).toMatch(/\{model\.actions\.map\(/);
    expect(source).toMatch(/\{model\.statusText\}/);
    expect(source).toMatch(/\{model\.undoneHeading\}/);
    expect(source).toMatch(/\{model\.undoneRows\.map\(/);
  });

  it("routes each action id to its own handler, so 'Restore anyway' can never submit unreservedly", () => {
    const source = readCode();
    expect(source).toMatch(/action\.id === "cancel"/);
    expect(source).toMatch(/action\.id === "restore-anyway"/);
    expect(source).toMatch(/onRestoreAnyway\(\)/);
    expect(source).toMatch(/onSubmit\(\)/);
  });

  it("makes every tappable row at least 48dp tall", () => {
    const source = readCode();
    expect(source).toMatch(/const MIN_TOUCH_TARGET = 48;/);
    expect(source).toMatch(/minHeight: MIN_TOUCH_TARGET/);
  });

  it("uses theme tokens only — no raw hex colour anywhere", () => {
    expect(readCode()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("gives the scope rows a radio role and the selected one a selected state", () => {
    const source = readCode();
    expect(source).toMatch(/accessibilityRole="radio"/);
    expect(source).toMatch(/accessibilityState=\{\{ selected: scope\.selected \}\}/);
  });

  it("gives every reachable control an accessibility label and a test id", () => {
    const source = readCode();
    expect(source).toMatch(
      /accessibilityLabel=\{`\$\{scope\.label\}\. \$\{scope\.description\}`\}/,
    );
    expect(source).toMatch(/accessibilityLabel=\{row\.accessibilityLabel\}/);
    expect(source).toMatch(/testID=\{`\$\{testId\}-scope-\$\{scope\.mode\}`\}/);
    expect(source).toMatch(/testId=\{`\$\{testId\}-\$\{action\.id\}`\}/);
  });

  it("bounds each undone row to one line so the sheet cannot grow with the record", () => {
    expect(readCode()).toMatch(/numberOfLines=\{1\}/);
  });
});
