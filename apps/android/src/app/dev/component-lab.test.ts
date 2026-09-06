import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `/dev/component-lab` route coverage — T32S1C, covering the move from
 * `apps/android/app/dev/component-lab.tsx` (never bundled — see
 * `../_layout.tsx`'s doc comment) to this file. Source-level contract
 * test, same reason as `../navigation-shell.test.ts`: this module
 * imports `expo-router`.
 *
 * CORRECTED (T123). This file previously matched against the RAW
 * `readFileSync` text, so `component-lab.tsx`'s own doc comment — which
 * quotes `React.lazy(() => import("../../dev/component-lab"))` verbatim —
 * satisfied the lazy-import assertion by itself. Comments are stripped
 * here, the same `readCode()` shape `session-tree-lab.test.ts` and
 * `e2e/flows/session-tree-sheet.contract.test.ts` use.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./component-lab.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("DevComponentLabRoute source", () => {
  const source = readCode();

  it("gates the real lab behind __DEV__ so it never ships in a production bundle", () => {
    expect(source).toMatch(/if \(!__DEV__\)/);
    expect(source).toMatch(/<Redirect href="\/" \/>/);
  });

  it("lazily imports the lab from its new location relative to this route file, in code and not merely in prose", () => {
    expect(source).toMatch(
      /const LazyComponentLab = lazy\(\(\) => import\("\.\.\/\.\.\/dev\/component-lab"\)\)/,
    );
  });
});
