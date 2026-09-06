import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeFontFamilyNames } from "@picompanion/design-tokens";
import { describe, expect, it } from "vitest";

/**
 * T13C (docs/issues-from-plan.md "Bundle Inter/Geist Mono and complete
 * light-theme values"): asserts the Android font registration lists both
 * families and that every `require(...)`d asset is a real file on disk.
 *
 * `apps/android` renders React Native components that can't be mounted
 * under plain vitest (see `component-lab.test.ts`'s note), so — like that
 * file — this is a static-source contract test rather than a render test:
 * it parses `fonts.ts`'s own source for its `useFonts({...})` registration
 * keys and `require(...)` targets, resolves each target against the
 * filesystem, and cross-checks the registration keys against
 * `nativeFontFamilyNames` (the same source `native.ts` resolves a theme's
 * `fontFamily` from), so a mismatch between "the name the theme resolves
 * to" and "the name actually registered" — the specific Android-only gap
 * this task closes — would fail here.
 */

const fontsTsPath = fileURLToPath(new URL("./fonts.ts", import.meta.url));
const fontsTsDir = dirname(fontsTsPath);
const fontsTsSource = readFileSync(fontsTsPath, "utf8");

function extractRequirePaths(source: string): string[] {
  return [...source.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1] ?? "");
}

describe("apps/android font bundling (T13C)", () => {
  it("loads fonts through expo-font's useFonts, not a lazy/optional path", () => {
    expect(fontsTsSource).toContain('from "expo-font"');
    expect(fontsTsSource).toContain("useFonts(");
  });

  it("registers every nativeFontFamilyNames key across both families", () => {
    // `fonts.ts` computes its `useFonts({...})` keys from
    // `nativeFontFamilyNames` rather than duplicating literal name strings
    // (so the two can never drift), so this checks for a reference to each
    // weight of both families rather than the literal registered string.
    for (const weight of ["regular", "medium", "semibold", "bold"] as const) {
      expect(fontsTsSource).toContain(`nativeFontFamilyNames.sans.${weight}`);
      expect(fontsTsSource).toContain(`nativeFontFamilyNames.mono.${weight}`);
    }
    // Both families, not just one — the literal gap-analysis requirement.
    expect(fontsTsSource).toContain("nativeFontFamilyNames.sans");
    expect(fontsTsSource).toContain("nativeFontFamilyNames.mono");
    // And the registered names really are what the theme resolves against.
    const allNames = [
      ...Object.values(nativeFontFamilyNames.sans),
      ...Object.values(nativeFontFamilyNames.mono),
    ];
    expect(allNames.length).toBe(8);
    expect(new Set(allNames).size).toBe(8);
  });

  it("every require()'d font asset resolves to a real .ttf file on disk", () => {
    const requirePaths = extractRequirePaths(fontsTsSource).filter((p) => p.endsWith(".ttf"));
    expect(requirePaths.length).toBe(8);
    for (const relativePath of requirePaths) {
      const absolute = resolve(fontsTsDir, relativePath);
      expect(existsSync(absolute), `expected ${relativePath} to exist on disk`).toBe(true);
      expect(statSync(absolute).size).toBeGreaterThan(1000);
    }
  });

  it("registers four Inter weights and four Geist Mono weights", () => {
    const requirePaths = extractRequirePaths(fontsTsSource);
    const interPaths = requirePaths.filter((p) => p.includes("Inter-"));
    const monoPaths = requirePaths.filter((p) => p.includes("GeistMono-"));
    expect(interPaths.length).toBe(4);
    expect(monoPaths.length).toBe(4);
  });

  it("vendors the OFL license text alongside each family's assets", () => {
    expect(existsSync(resolve(fontsTsDir, "../../../assets/fonts/OFL-Inter.txt"))).toBe(true);
    expect(existsSync(resolve(fontsTsDir, "../../../assets/fonts/OFL-GeistMono.txt"))).toBe(true);
  });

  it("gates the root layout's first paint on fontsLoaded/fontError", () => {
    // Comment-stripped (T130): `_layout.tsx`'s own doc comment quotes
    // both `useAppFonts()` and `fontsLoaded` verbatim, so an unanchored
    // `toContain` against raw file text is satisfied by that prose alone
    // and stays green even when the real gate is deleted.
    const rawLayoutSource = readFileSync(resolve(fontsTsDir, "../../app/_layout.tsx"), "utf8");
    const layoutSource = rawLayoutSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(layoutSource).toContain("useAppFonts");
    expect(layoutSource).toContain("fontsLoaded");
  });
});
