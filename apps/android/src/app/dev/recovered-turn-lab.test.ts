import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `/dev/recovered-turn-lab` route coverage — T106, same reason as
 * `component-lab.test.ts`/`recipe-lab.test.ts`: this module imports
 * `expo-router` and cannot be rendered under this workspace's plain
 * vitest setup, so this is a source-level contract test.
 *
 * CORRECTED (T123). This file previously matched against the RAW
 * `readFileSync` text, so `recovered-turn-lab.tsx`'s own doc comment —
 * which quotes `React.lazy(() => import("../../dev/recovered-turn-lab"))`
 * verbatim — satisfied the lazy-import assertion by itself. Comments are
 * stripped here, the same `readCode()` shape `session-tree-lab.test.ts`
 * and `e2e/flows/session-tree-sheet.contract.test.ts` use.
 */
function readCode(): string {
  return readFileSync(fileURLToPath(new URL("./recovered-turn-lab.tsx", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("DevRecoveredTurnLabRoute source", () => {
  const source = readCode();

  it("gates the real lab behind __DEV__ so it never ships in a production bundle", () => {
    expect(source).toMatch(/if \(!__DEV__\)/);
    expect(source).toMatch(/<Redirect href="\/" \/>/);
  });

  it("lazily imports the lab from ../../dev/recovered-turn-lab, in code and not merely in prose", () => {
    expect(source).toMatch(
      /const LazyRecoveredTurnLab = lazy\(\(\) => import\("\.\.\/\.\.\/dev\/recovered-turn-lab"\)\)/,
    );
  });
});
