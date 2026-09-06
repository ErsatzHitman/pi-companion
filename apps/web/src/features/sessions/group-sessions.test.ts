import { describe, expect, it } from "vitest";

import { categorizeSession, groupSessions } from "./group-sessions.js";
import type { SessionSummary } from "./types.js";

function session(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    title: `Session ${overrides.id}`,
    provider: "claude",
    cwd: "/repo",
    status: "idle",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("categorizeSession", () => {
  it("categorizes an archived session as archived regardless of status", () => {
    expect(
      categorizeSession(session({ id: "a", status: "running", archivedAt: "2026-01-01" })),
    ).toBe("archived");
  });

  it("categorizes requiresAttention or error sessions as needs-attention", () => {
    expect(categorizeSession(session({ id: "b", requiresAttention: true, status: "idle" }))).toBe(
      "needs-attention",
    );
    expect(categorizeSession(session({ id: "c", status: "error" }))).toBe("needs-attention");
  });

  it("categorizes running/initializing sessions as active", () => {
    expect(categorizeSession(session({ id: "d", status: "running" }))).toBe("active");
    expect(categorizeSession(session({ id: "e", status: "initializing" }))).toBe("active");
  });

  it("categorizes idle and closed sessions as idle by default", () => {
    expect(categorizeSession(session({ id: "f", status: "idle" }))).toBe("idle");
    expect(categorizeSession(session({ id: "g", status: "closed" }))).toBe("idle");
  });
});

describe("groupSessions", () => {
  it("orders groups needs-attention, active, idle, archived and drops empty groups", () => {
    const groups = groupSessions([
      session({ id: "idle-1", status: "idle" }),
      session({ id: "active-1", status: "running" }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["active", "idle"]);
  });

  it("includes every non-empty category when present", () => {
    const groups = groupSessions([
      session({ id: "attn", status: "error" }),
      session({ id: "active", status: "running" }),
      session({ id: "idle", status: "idle" }),
      session({ id: "archived", status: "closed", archivedAt: "2026-01-01" }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["needs-attention", "active", "idle", "archived"]);
    expect(groups.map((g) => g.label)).toEqual(["Needs attention", "Active", "Idle", "Archived"]);
  });

  it("sorts sessions within a group most-recently-updated first", () => {
    const groups = groupSessions([
      session({ id: "older", status: "idle", updatedAt: "2026-01-01T00:00:00.000Z" }),
      session({ id: "newer", status: "idle", updatedAt: "2026-01-02T00:00:00.000Z" }),
    ]);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["newer", "older"]);
  });

  it("returns no groups for an empty session list", () => {
    expect(groupSessions([])).toEqual([]);
  });
});
