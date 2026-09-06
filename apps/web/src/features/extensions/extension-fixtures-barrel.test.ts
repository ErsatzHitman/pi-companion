import { testing } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

/**
 * T98 — proves `packages/frontend-core/src/testing/fixtures/extensions/`
 * is actually reachable from `apps/web` through the real package export
 * `@picompanion/frontend-core`, not merely present in the package's own
 * source tree.
 *
 * "Registration is not receipt": before T98, `testing/index.ts` re-exported
 * nothing from `fixtures/extensions/`, so `testing.extensions` would have
 * been `undefined` and every property read below would throw or resolve
 * to `undefined`. This asserts real values arrive — a non-empty extension
 * list and a fully-populated fixture scenario for one of them — not just
 * that the `testing` namespace object is truthy.
 */
describe("testing.extensions reachability (T98)", () => {
  it("lists a real, non-empty set of §11.7 extension fixture names", () => {
    const names = testing.extensions.listExtensionFixtures();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("loop");
  });

  it("loads a real fixture scenario with populated wire frames, through the package specifier", () => {
    const loop = testing.extensions.loadExtensionFixture("loop");
    expect(loop.extension).toBe("loop");
    expect(loop.frames.length).toBeGreaterThan(0);
    expect(loop.frames[0]).toBeDefined();
    expect(loop.frames[0]!.message).toBeDefined();
  });

  it("loads every covered extension's fixture without throwing", () => {
    const all = testing.extensions.loadAllExtensionFixtures();
    expect(all.length).toBe(testing.extensions.listExtensionFixtures().length);
    for (const scenario of all) {
      expect(scenario.frames.length).toBeGreaterThan(0);
    }
  });
});
