import { testing } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

/**
 * T98 — proves `packages/frontend-core/src/testing/fixtures/extensions/`
 * is actually reachable from `apps/android` through the real package
 * export `@picompanion/frontend-core`, not merely present in the
 * package's own source tree.
 *
 * This file imports only `@picompanion/frontend-core` and `vitest` — it
 * never reaches `react-native` (the catalogued RN-in-vitest limitation:
 * any test importing a module that reaches react-native fails with
 * RolldownError on node_modules/react-native/index.js:1:0), matching the
 * pattern `apps/android/src/dev/component-lab.test.ts` already uses for
 * this same `testing` namespace.
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
    expect(names).toContain("todo");
  });

  it("loads a real fixture scenario with populated wire frames, through the package specifier", () => {
    const todo = testing.extensions.loadExtensionFixture("todo");
    expect(todo.extension).toBe("todo");
    expect(todo.frames.length).toBeGreaterThan(0);
    expect(todo.frames[0]).toBeDefined();
    expect(todo.frames[0]!.message).toBeDefined();
  });

  it("loads every covered extension's fixture without throwing", () => {
    const all = testing.extensions.loadAllExtensionFixtures();
    expect(all.length).toBe(testing.extensions.listExtensionFixtures().length);
    for (const scenario of all) {
      expect(scenario.frames.length).toBeGreaterThan(0);
    }
  });
});
