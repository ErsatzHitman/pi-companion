import { describe, expect, it } from "vitest";

import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import { selectInlineElements } from "./inline-model";

function element(id: string, placement: PiUiElement["placement"]): PiUiElement {
  return { id, ns: "pi-advisor-review", kind: "markdown", placement };
}

describe("selectInlineElements", () => {
  it("keeps only placement === 'inline' elements", () => {
    const elements = [
      element("a", "pinned"),
      element("b", "inline"),
      element("c", "sheet"),
      element("d", "status"),
      element("e", "screen"),
      element("f", "inline"),
    ];
    expect(selectInlineElements(elements).map((entry) => entry.id)).toEqual(["b", "f"]);
  });

  it("preserves store order — arrival order — without reordering or deduping", () => {
    const elements = [element("first", "inline"), element("second", "inline")];
    expect(selectInlineElements(elements).map((entry) => entry.id)).toEqual(["first", "second"]);
  });

  it("returns an empty array for no inline elements, never a placeholder", () => {
    expect(selectInlineElements([element("a", "pinned")])).toEqual([]);
  });
});
