import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { describe, expect, it } from "vitest";

import { selectRailElements } from "./select-rail-elements.js";

function element(overrides: Partial<PiUiElement>): PiUiElement {
  return {
    id: "el",
    ns: "ns",
    kind: "widget",
    placement: "pinned",
    ...overrides,
  } as PiUiElement;
}

describe("selectRailElements", () => {
  it("keeps only pinned-placement elements (plan.md §11.5)", () => {
    const elements = [
      element({ id: "a", placement: "pinned" }),
      element({ id: "b", placement: "status" }),
      element({ id: "c", placement: "inline" }),
      element({ id: "d", placement: "sheet" }),
      element({ id: "e", placement: "screen" }),
      element({ id: "f", placement: "pinned" }),
    ];

    expect(selectRailElements(elements).map((el) => el.id)).toEqual(["a", "f"]);
  });

  it("preserves the input's stable order", () => {
    const elements = [
      element({ id: "z", ns: "ns1", placement: "pinned" }),
      element({ id: "a", ns: "ns2", placement: "pinned" }),
      element({ id: "m", ns: "ns3", placement: "pinned" }),
    ];

    expect(selectRailElements(elements).map((el) => el.id)).toEqual(["z", "a", "m"]);
  });

  it("returns an empty array, not null/undefined, when nothing is pinned", () => {
    const elements = [element({ placement: "status" }), element({ placement: "inline" })];
    expect(selectRailElements(elements)).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(selectRailElements([])).toEqual([]);
  });

  it("is indifferent to element kind — placement alone decides rail membership", () => {
    const elements = [
      element({ id: "a", kind: "status", placement: "pinned" }),
      element({ id: "b", kind: "roster", placement: "pinned" }),
      element({ id: "c", kind: "log", placement: "status" }),
    ];
    expect(selectRailElements(elements).map((el) => el.id)).toEqual(["a", "b"]);
  });
});
