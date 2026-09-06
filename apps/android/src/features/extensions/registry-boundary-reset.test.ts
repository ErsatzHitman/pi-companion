import { describe, expect, it } from "vitest";

import { shouldResetExtensionBoundary } from "./registry-boundary-reset";

/**
 * `shouldResetExtensionBoundary` unit coverage (plan.md §11.4; T34A1).
 * `ExtensionElementBoundary.componentDidUpdate` (`registry-boundary.tsx`)
 * calls this exact function to decide whether a caught error should clear,
 * giving the element a fresh chance to render — this proves that decision
 * without needing to render the (react-native-backed) boundary component
 * itself; see `registry.test.ts`'s doc comment for why that can't happen
 * in this workspace.
 */

describe("shouldResetExtensionBoundary", () => {
  const base = { ns: "plan-mode", elementId: "mode", resetKey: 3 };

  it("does not reset when nothing about the element's identity or resetKey changed", () => {
    expect(shouldResetExtensionBoundary(base, { ...base })).toBe(false);
  });

  it("resets when the namespace changed", () => {
    expect(shouldResetExtensionBoundary(base, { ...base, ns: "loop" })).toBe(true);
  });

  it("resets when the element id changed", () => {
    expect(shouldResetExtensionBoundary(base, { ...base, elementId: "other" })).toBe(true);
  });

  it("resets when resetKey (the element's revision) changed", () => {
    expect(shouldResetExtensionBoundary(base, { ...base, resetKey: 4 })).toBe(true);
  });

  it("resets when resetKey goes from defined to undefined, or vice versa", () => {
    expect(shouldResetExtensionBoundary(base, { ns: base.ns, elementId: base.elementId })).toBe(
      true,
    );
    expect(shouldResetExtensionBoundary({ ns: base.ns, elementId: base.elementId }, base)).toBe(
      true,
    );
  });

  it("does not reset when both identity and resetKey are absent on both sides", () => {
    const identity = { ns: "loop", elementId: "controls" };
    expect(shouldResetExtensionBoundary(identity, { ...identity })).toBe(false);
  });
});
