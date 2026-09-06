import { describe, expect, it } from "vitest";

import { isRecord, readNonEmptyString, safeJsonClone, timingFields } from "./util.js";

describe("isRecord / readNonEmptyString", () => {
  it("distinguishes plain objects from arrays, null, and primitives", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });

  it("only accepts non-empty strings", () => {
    expect(readNonEmptyString("hi")).toBe("hi");
    expect(readNonEmptyString("")).toBeUndefined();
    expect(readNonEmptyString(42)).toBeUndefined();
    expect(readNonEmptyString(undefined)).toBeUndefined();
  });
});

describe("safeJsonClone", () => {
  it("deep-clones plain JSON-safe values", () => {
    const input = { a: [1, 2, { b: "c" }] };
    const cloned = safeJsonClone(input);
    expect(cloned).toEqual(input);
    expect(cloned).not.toBe(input);
  });

  it("passes undefined through unchanged", () => {
    expect(safeJsonClone(undefined)).toBeUndefined();
  });

  it("falls back to a placeholder for unserializable values instead of throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => safeJsonClone(circular)).not.toThrow();
    expect(safeJsonClone(circular)).toBe("[unserializable value]");
  });
});

describe("timingFields", () => {
  it("has no timing fields when nothing is known", () => {
    const fields = timingFields({});
    expect(fields.startedAt).toBeUndefined();
    expect(fields.updatedAt).toBeUndefined();
    expect(fields.durationMs).toBeUndefined();
    expect(fields.updateCount).toBe(1);
  });

  it("seeds startedAt/updatedAt from the first observation", () => {
    const fields = timingFields({ observedAt: 100 });
    expect(fields.startedAt).toBe(100);
    expect(fields.updatedAt).toBe(100);
    expect(fields.durationMs).toBe(0);
    expect(fields.updateCount).toBe(1);
  });

  it("carries startedAt and increments updateCount across rebuilds", () => {
    const first = timingFields({ observedAt: 100 });
    const second = timingFields({ observedAt: 250, previous: first });
    expect(second.startedAt).toBe(100);
    expect(second.updatedAt).toBe(250);
    expect(second.durationMs).toBe(150);
    expect(second.updateCount).toBe(2);
  });

  it("preserves the previous durationMs when a later observation has no timestamp", () => {
    const first = timingFields({ observedAt: 100 });
    const second = timingFields({ observedAt: 250, previous: first });
    const third = timingFields({ previous: second });
    expect(third.startedAt).toBe(100);
    expect(third.updatedAt).toBe(250);
    expect(third.durationMs).toBe(150);
    expect(third.updateCount).toBe(3);
  });
});
