import { describe, expect, it } from "vitest";
import {
  buildPiUiActionEnvelope,
  elementKeyOf,
  formatActionKey,
  formatCompositeElementId,
  parseCompositeElementId,
} from "./identity.js";

describe("composite Pi UI identity (plan.md §4.2)", () => {
  it("keys elements by ns:id", () => {
    expect(elementKeyOf("loop", "main")).toBe("loop:main");
  });

  it("parses ns:id, ns:id#rowId, and legacy bare ids", () => {
    expect(parseCompositeElementId("loop:main")).toEqual({ ns: "loop", id: "main" });
    expect(parseCompositeElementId("loop:main#row-2")).toEqual({
      ns: "loop",
      id: "main",
      rowId: "row-2",
    });
    expect(parseCompositeElementId("main")).toEqual({ id: "main" });
  });

  it("treats only the first colon as the namespace separator", () => {
    expect(parseCompositeElementId("loop:main:sub")).toEqual({ ns: "loop", id: "main:sub" });
  });

  it("rejects malformed ids", () => {
    expect(parseCompositeElementId("")).toBeNull();
    expect(parseCompositeElementId("   ")).toBeNull();
    expect(parseCompositeElementId(":main")).toBeNull();
    expect(parseCompositeElementId("loop:")).toBeNull();
    expect(parseCompositeElementId("loop:main#")).toBeNull();
  });

  it("round-trips composite ids and action keys", () => {
    expect(formatCompositeElementId({ ns: "loop", id: "main" })).toBe("loop:main");
    expect(formatCompositeElementId({ ns: "loop", id: "main", rowId: "r1" })).toBe("loop:main#r1");
    expect(formatActionKey({ ns: "loop", id: "main", actionId: "stop" })).toBe("loop:main:stop");
    expect(formatActionKey({ ns: "loop", id: "main", rowId: "r1", actionId: "stop" })).toBe(
      "loop:main#r1:stop",
    );
  });

  it("builds an envelope carrying composite identity, not just a bare id", () => {
    const envelope = buildPiUiActionEnvelope({
      target: {
        ns: "loop",
        id: "main",
        elementKey: "loop:main",
        kind: "roster",
        rowId: "r1",
        actionId: "stop",
        actionKey: "loop:main#r1:stop",
      },
      value: { confirmed: true },
      requestId: "req-1",
    });

    expect(envelope).toMatchObject({
      v: 1,
      ns: "loop",
      id: "main",
      elementKey: "loop:main",
      rowId: "r1",
      actionId: "stop",
      actionKey: "loop:main#r1:stop",
      requestId: "req-1",
      value: { confirmed: true },
    });
    // COMPAT: old helpers still read the bare `elementId`.
    expect(envelope.elementId).toBe("main");
  });
});
