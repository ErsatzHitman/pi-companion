import { describe, expect, it } from "vitest";

import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { selectSheetPlacementElements } from "./sheet-extension-model";

function element(overrides: Partial<PiUiElement>): PiUiElement {
  return {
    id: overrides.id ?? "el-1",
    ns: overrides.ns ?? "demo",
    kind: overrides.kind ?? "panel",
    placement: overrides.placement ?? "sheet",
    ...overrides,
  } as PiUiElement;
}

describe("selectSheetPlacementElements", () => {
  it("keeps only placement: sheet elements, in stable store order", () => {
    const elements = [
      element({ id: "a", placement: "pinned" }),
      element({ id: "b", placement: "sheet" }),
      element({ id: "c", placement: "inline" }),
      element({ id: "d", placement: "sheet" }),
      element({ id: "e", placement: "screen" }),
      element({ id: "f", placement: "status" }),
    ];
    expect(selectSheetPlacementElements(elements).map((e) => e.id)).toEqual(["b", "d"]);
  });

  it("returns an empty array when no element is sheet-placement", () => {
    const elements = [
      element({ id: "a", placement: "pinned" }),
      element({ id: "b", placement: "screen" }),
    ];
    expect(selectSheetPlacementElements(elements)).toEqual([]);
  });
});
