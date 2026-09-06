import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `RoutePlaceholder` coverage — T32S1C. Source-level contract test, same
 * reason as `./compact-shell.test.ts`: this module imports `react-native`,
 * which this workspace's plain `vitest` setup can't render.
 */
describe("RoutePlaceholder source", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./route-placeholder.tsx", import.meta.url)),
    "utf8",
  );

  // Comment-stripped before matching (P5-W16 merge gate, applying the
  // pattern T57B filed against this file): an assertion run against raw
  // source can be satisfied -- or falsely tripped -- by prose in a doc
  // comment rather than by the real code it names.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("renders every params entry, so a stub route can prove which params reached it", () => {
    expect(code).toMatch(/entries\.map/);
    expect(code).toMatch(/Object\.entries\(params\)/);
  });

  it('contains no raw hex colour literal (plan.md §10 "no raw hex" rule)', () => {
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("resolves every colour through useTheme()", () => {
    expect(code).toMatch(/useTheme\(\)/);
    expect(code).toMatch(/theme\.colors\./);
  });
});
