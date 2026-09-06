import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `/dev/session-tree-lab` route coverage — T39A, same reason as
 * `recovered-turn-lab.test.ts`/`component-lab.test.ts`: this module
 * imports `expo-router` and cannot be rendered under this workspace's
 * plain vitest setup, so this is a source-level contract test.
 *
 * CORRECTED (P6-W6 merge gate). This file previously matched against the
 * RAW `readFileSync` text, so `session-tree-lab.tsx:10`'s own doc comment
 * — which quotes `React.lazy(() => import("../../dev/session-tree-lab"))`
 * verbatim — satisfied the lazy-import assertion by itself. Both
 * mutations passed against the raw reader: repointing the real `lazy()` at
 * a nonexistent module, and deleting the `LazySessionTreeLab` declaration
 * outright. Comments are stripped here, exactly as
 * `e2e/flows/session-tree-sheet.contract.test.ts`'s `readCode()` does for
 * this same file. `component-lab.test.ts` and `recovered-turn-lab.test.ts`
 * still read raw and are vacuous for the identical reason — filed as T123.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./session-tree-lab.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("DevSessionTreeLabRoute source", () => {
  const source = readCode();

  it("gates the real lab behind __DEV__ so it never ships in a production bundle", () => {
    expect(source).toMatch(/if \(!__DEV__\)/);
    expect(source).toMatch(/<Redirect href="\/" \/>/);
  });

  it("lazily imports the lab from ../../dev/session-tree-lab, in code and not merely in prose", () => {
    expect(source).toMatch(
      /const LazySessionTreeLab = lazy\(\(\) => import\("\.\.\/\.\.\/dev\/session-tree-lab"\)\)/,
    );
  });
});
