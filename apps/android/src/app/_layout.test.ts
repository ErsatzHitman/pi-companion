import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Root layout coverage — T32S1C, covering the move from
 * `apps/android/app/_layout.tsx` (never bundled — see this file's own
 * doc comment) to `apps/android/src/app/_layout.tsx`. Source-level
 * contract test, same reason as `../app-shell/navigation-shell.test.ts`:
 * this module imports `expo-router`/`react-native`.
 */
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./_layout.tsx", import.meta.url)), "utf8");
}

/**
 * `readSource` with comments stripped: this file's own doc comment
 * quotes `useAppFonts()` and `fontsLoaded` verbatim (T130), so an
 * unanchored regex over the raw file text is satisfied by that prose
 * alone and stays green even when the real gate is deleted. Assertions
 * that must reach actual code read through this instead.
 */
function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("RootLayout source", () => {
  const source = readCode();

  it("imports its providers from this directory or ../app-shell, not the deleted apps/android/app/ split", () => {
    expect(source).toMatch(/from "\.\/core-context"/);
    expect(source).toMatch(/from "\.\.\/app-shell\/error-boundary"/);
    expect(source).toMatch(/from "\.\.\/app-shell\/navigation-shell"/);
    expect(source).not.toMatch(/from "\.\.\/src\/app\//);
  });

  it("gates the first paint on useAppFonts()", () => {
    expect(source).toMatch(/useAppFonts\(\)/);
    expect(source).toMatch(/if \(!fontsLoaded && !fontError\)/);
  });

  it("nests providers error boundary > theme > app core > safe area > navigation shell", () => {
    const jsx = source.slice(source.indexOf("return ("));
    const order = [
      "AppErrorBoundary",
      "ThemeProvider",
      "AppCoreProvider",
      "SafeAreaProvider",
      "NavigationShell",
    ];
    const positions = order.map((name) => {
      const index = jsx.indexOf(`<${name}`);
      expect(index, `expected to find <${name} in the rendered JSX`).toBeGreaterThan(-1);
      return index;
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
