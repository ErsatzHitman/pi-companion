import { describe, expect, it } from "vitest";

import { mergeSessionList } from "./merge-sessions.js";
import type { SessionSummary } from "./types.js";

function session(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    title: null,
    provider: "pi",
    cwd: "/repo",
    status: "idle",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("mergeSessionList (T27B6)", () => {
  it("keeps a session known on both sides exactly once, with fetched field values", () => {
    const current = [session({ id: "s-1", status: "idle", title: "Old title" })];
    const fetched = [session({ id: "s-1", status: "running", title: "New title" })];

    const merged = mergeSessionList(current, fetched);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(fetched[0]);
  });

  it("appends a session that only the fetch knows about", () => {
    const current = [session({ id: "s-1" })];
    const fetched = [session({ id: "s-1" }), session({ id: "s-2" })];

    const merged = mergeSessionList(current, fetched);

    expect(merged.map((s) => s.id)).toEqual(["s-1", "s-2"]);
  });

  it("drops a session the daemon no longer reports", () => {
    const current = [session({ id: "s-1" }), session({ id: "s-2" })];
    const fetched = [session({ id: "s-1" })];

    const merged = mergeSessionList(current, fetched);

    expect(merged.map((s) => s.id)).toEqual(["s-1"]);
  });

  it("never duplicates a row across repeated, overlapping merges (gap recovery)", () => {
    const page1 = [session({ id: "s-1" }), session({ id: "s-2" })];
    // A second, overlapping page: repeats s-2, adds s-3 — simulates a
    // paged reconciliation whose windows overlap at the boundary.
    const page2 = [session({ id: "s-2" }), session({ id: "s-3" })];

    const afterPage1 = mergeSessionList([], page1);
    const afterPage2 = mergeSessionList(afterPage1, page2);

    const ids = afterPage2.map((s) => s.id);
    expect(ids).toEqual(["s-2", "s-3"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("applying the exact same fetch twice in a row is a no-op (idempotent reconnect retry)", () => {
    const fetched = [session({ id: "s-1" }), session({ id: "s-2" })];
    const once = mergeSessionList([], fetched);
    const twice = mergeSessionList(once, fetched);

    expect(twice).toEqual(once);
  });

  it("collapses a duplicate id within a single fetched batch to its last occurrence", () => {
    const fetched = [
      session({ id: "s-1", status: "idle" }),
      session({ id: "s-1", status: "running" }),
    ];

    const merged = mergeSessionList([], fetched);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.status).toBe("running");
  });

  it("returns an empty list when both sides are empty", () => {
    expect(mergeSessionList([], [])).toEqual([]);
  });
});
