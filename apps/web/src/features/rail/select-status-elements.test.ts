import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { describe, expect, it } from "vitest";

import { selectStatusElements } from "./select-status-elements.js";

function element(overrides: Partial<PiUiElement>): PiUiElement {
  return {
    id: "el",
    ns: "ns",
    kind: "status",
    placement: "status",
    ...overrides,
  } as PiUiElement;
}

describe("selectStatusElements", () => {
  it("keeps only status-placement elements (plan.md §11.5)", () => {
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

  it("preserves the input's stable order", () => {
    const elements = [
      element({ id: "z", ns: "ns1" }),
      element({ id: "a", ns: "ns2" }),
      element({ id: "m", ns: "ns3" }),
    ];

    expect(selectStatusElements(elements).map((el) => el.id)).toEqual(["z", "a", "m"]);
  });

  it("returns an empty array, not null/undefined, when nothing is status-placed", () => {
    const elements = [element({ placement: "pinned" }), element({ placement: "inline" })];
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
