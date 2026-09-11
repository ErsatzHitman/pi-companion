import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T362 source-level contract for `SearchField.tsx`. It imports
 * `react-native`, which this workspace's plain `vitest` cannot parse
 * (`CLAUDE.md`), so the contract is read off the source with comments
 * stripped — a claim made only in a doc comment can never satisfy an
 * assertion here.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./SearchField.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("SearchField: a caller can move the cursor into it (T362)", () => {
  it("accepts a ref and actually puts it on the TextInput", () => {
    const code = readCode();
    expect(code).toMatch(/ref\?: Ref<TextInput>;/);
    expect(code).toMatch(/<TextInput\s+ref=\{ref\}/);
  });

  it("takes ref out of the spread, so it cannot also land as an unknown prop", () => {
    expect(readCode()).toMatch(/function SearchField\(\{ label, ref, testId, \.\.\.rest \}/);
  });

  it("needs no forwardRef wrapper on React 19", () => {
    expect(readCode()).not.toMatch(/forwardRef/);
  });

  it("still carries its accessible name, which is the whole reason the label prop exists", () => {
    // The field is conventionally unlabelled on screen (plan.md §10.5).
    const code = readCode();
    expect(code).toMatch(/accessibilityLabel=\{label\}/);
    expect(code).toMatch(/accessibilityRole="search"/);
  });
});
