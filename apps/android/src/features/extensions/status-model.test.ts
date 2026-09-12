import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { selectStatusElements } from "./status-model";

/**
 * The status strip's RN-free decision (plan.md §9.2, §11.3, §11.5). See
 * `status-model.ts`'s doc comment for why the placement filter is the
 * whole of what a `vitest` run in this workspace can prove about "the
 * status strip draws status-placement elements and nothing else"; the
 * native render itself is unverified here and belongs to T37/T59.
 */

function element(overrides: Partial<PiUiElement>): PiUiElement {
  return {
    id: overrides.id ?? "el-1",
    ns: overrides.ns ?? "plan-mode",
    kind: overrides.kind ?? "status",
    placement: overrides.placement ?? "status",
    ...overrides,
  } as PiUiElement;
}

describe("selectStatusElements", () => {
  it("keeps only placement: status elements", () => {
    const elements = [
      element({ id: "a", placement: "status" }),
      element({ id: "b", placement: "pinned" }),
      element({ id: "c", placement: "inline" }),
      element({ id: "d", placement: "sheet" }),
      element({ id: "e", placement: "screen" }),
      element({ id: "f", placement: "status" }),
    ];

    expect(selectStatusElements(elements).map((el) => el.id)).toEqual(["a", "f"]);
  });

  it("preserves the input's order (stable store order)", () => {
    const elements = [
      element({ id: "z", placement: "status" }),
      element({ id: "a", placement: "status" }),
      element({ id: "m", placement: "status" }),
    ];

    expect(selectStatusElements(elements).map((el) => el.id)).toEqual(["z", "a", "m"]);
  });

  it("returns an empty array when nothing is status-placed", () => {
    const elements = [
      element({ id: "a", placement: "pinned" }),
      element({ id: "b", placement: "inline" }),
      element({ id: "c", placement: "sheet" }),
    ];

    expect(selectStatusElements(elements)).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(selectStatusElements([])).toEqual([]);
  });

  it("is indifferent to element kind — placement alone decides strip membership", () => {
    const elements = [
      element({ id: "a", kind: "status", placement: "status" }),
      element({ id: "b", kind: "progress", placement: "status" }),
      element({ id: "c", kind: "widget", placement: "pinned" }),
    ];

    expect(selectStatusElements(elements).map((el) => el.id)).toEqual(["a", "b"]);
  });
});

describe("StatusLiveExtensionStrip wires the selector through PiUiElementView (source pin)", () => {
  // `status-live-extension-strip.tsx` imports `react-native`, so this is a
  // source-level pin over the comment-stripped code, the same reason
  // `pinned-model.test.ts`'s T342 block and every renderer test in this
  // directory give.
  const code = readFileSync(
    fileURLToPath(new URL("./status-live-extension-strip.tsx", import.meta.url)),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("selects via selectStatusElements and renders each through PiUiElementView", () => {
    expect(code).toMatch(/const statusElements = selectStatusElements\(elements\)/);
    expect(code).toMatch(/<PiUiElementView\b/);
    expect(code).toMatch(/key=\{extensions\.piUiElementKeyOf\(element\)\}/);
  });

  it("returns null when no status element exists, so an absent strip contributes zero height", () => {
    expect(code).toMatch(/if \(statusElements\.length === 0\) \{\s*return null;\s*\}/);
  });
});
