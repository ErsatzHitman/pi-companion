import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";
import { describe, expect, it } from "vitest";

import {
  selectInlineElements,
  selectScreenElements,
  selectSheetElements,
} from "./select-placement-elements.js";

function element(overrides: Partial<PiUiElement>): PiUiElement {
  return {
    id: "el",
    ns: "ns",
    kind: "panel",
    placement: "inline",
    ...overrides,
  } as PiUiElement;
}

const all: PiUiElement[] = [
  element({ id: "pinned", placement: "pinned" }),
  element({ id: "status", placement: "status" }),
  element({ id: "inline-1", placement: "inline" }),
  element({ id: "sheet-1", placement: "sheet" }),
  element({ id: "screen-1", placement: "screen" }),
  element({ id: "inline-2", placement: "inline" }),
  element({ id: "sheet-2", placement: "sheet" }),
  element({ id: "screen-2", placement: "screen" }),
];

describe("placement selectors (plan.md §11.5)", () => {
  it("selectInlineElements keeps only inline-placement elements", () => {
    expect(selectInlineElements(all).map((el) => el.id)).toEqual(["inline-1", "inline-2"]);
  });

  it("selectSheetElements keeps only sheet-placement elements", () => {
    expect(selectSheetElements(all).map((el) => el.id)).toEqual(["sheet-1", "sheet-2"]);
  });

  it("selectScreenElements keeps only screen-placement elements", () => {
    expect(selectScreenElements(all).map((el) => el.id)).toEqual(["screen-1", "screen-2"]);
  });

  it("the three sets are disjoint, so no element is rendered by two destinations", () => {
    const inline = new Set(selectInlineElements(all).map((el) => `${el.ns}:${el.id}`));
    const sheet = new Set(selectSheetElements(all).map((el) => `${el.ns}:${el.id}`));
    const screen = new Set(selectScreenElements(all).map((el) => `${el.ns}:${el.id}`));
    for (const key of inline) {
      expect(sheet.has(key)).toBe(false);
      expect(screen.has(key)).toBe(false);
    }
    for (const key of sheet) {
      expect(screen.has(key)).toBe(false);
    }
  });

  it("preserves the input's stable insertion order", () => {
    const ordered = [
      element({ id: "z", placement: "inline" }),
      element({ id: "a", placement: "inline" }),
      element({ id: "m", placement: "inline" }),
    ];
    expect(selectInlineElements(ordered).map((el) => el.id)).toEqual(["z", "a", "m"]);
  });

  it("returns an empty array, not null/undefined, for an empty or unmatched input", () => {
    expect(selectInlineElements([])).toEqual([]);
    expect(selectSheetElements([element({ placement: "pinned" })])).toEqual([]);
    expect(selectScreenElements([element({ placement: "inline" })])).toEqual([]);
  });

  it("is indifferent to element kind — placement alone decides membership", () => {
    const kinds = [
      element({ id: "a", kind: "panel", placement: "sheet" }),
      element({ id: "b", kind: "form", placement: "sheet" }),
      element({ id: "c", kind: "roster", placement: "pinned" }),
    ];
    expect(selectSheetElements(kinds).map((el) => el.id)).toEqual(["a", "b"]);
  });
});
