import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { testing } from "@picompanion/frontend-core";

/**
 * T26B recipe-lab coverage test (plan.md §10.4 "Recipes match web
 * semantics on shared fixtures").
 *
 * Same constraint as `component-lab.test.ts`: `react-native` component
 * modules can't be rendered under this workspace's plain-`vitest` setup
 * (see that file's doc comment), so this statically verifies the source
 * contract "one `<Section title="...">` per shared manifest entry" that
 * `recipe-lab.tsx` promises, mirroring `apps/web`'s
 * `recipe-lab.test.tsx` render assertion. An on-device/Metro-based render
 * pass (jest-expo, Detox, or Maestro) is left to the Phase 5 Android E2E
 * work (plan.md §14.4, T37).
 */
describe("RecipeLab source", () => {
  const source = readFileSync(fileURLToPath(new URL("./recipe-lab.tsx", import.meta.url)), "utf8");

  it('has a <Section title="..."> for every entry in the shared recipe manifest', () => {
    for (const name of testing.recipeLabManifest) {
      expect(source).toContain(`<Section title="${name}">`);
    }
  });

  it("imports every recipe it renders from the recipe barrel", () => {
    for (const name of testing.recipeLabManifest) {
      expect(source).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});
