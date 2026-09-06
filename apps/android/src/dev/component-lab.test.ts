import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { testing } from "@picompanion/frontend-core";

/**
 * T26A component-lab coverage test (plan.md §10.3 "Lab screen renders
 * every primitive").
 *
 * `apps/android` renders React Native components (`react-native`'s
 * bundled entry point ships Flow syntax that only Metro's Babel
 * transform understands, not Vite/Rolldown), so a full component render
 * — the way `apps/web`'s `component-lab.test.tsx` does it with
 * `@testing-library/react` — isn't reachable from this workspace's
 * plain-`vitest` setup. This test instead statically verifies the
 * source contract "one `<Section title="...">` per shared manifest
 * entry" that `component-lab.tsx` promises, which is what a render
 * assertion would otherwise check; an on-device/Metro-based render pass
 * (jest-expo, Detox, or Maestro) is left to the Phase 5 Android E2E work
 * (plan.md §14.4, T37).
 */
describe("ComponentLab source", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./component-lab.tsx", import.meta.url)),
    "utf8",
  );

  it('has a <Section title="..."> for every entry in the shared primitive manifest', () => {
    for (const name of testing.primitiveLabManifest) {
      expect(source).toContain(`<Section title="${name}">`);
    }
  });

  it("imports every primitive it renders from the primitive barrel", () => {
    for (const name of testing.primitiveLabManifest) {
      expect(source).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});
