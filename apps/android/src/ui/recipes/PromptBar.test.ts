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

  it("wires onFocus through to the underlying TextInput", () => {
    expect(readCode()).toMatch(/onFocus=\{onFocus\}/);
  });

  it("wires onBlur through to the underlying TextInput", () => {
    expect(readCode()).toMatch(/onBlur=\{onBlur\}/);
  });
});
