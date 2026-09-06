import { describe, expect, it } from "vitest";

import type { SessionListState, SessionSummary } from "../features/sessions/index.js";

import { appendCreatedSession } from "./session-list-append";

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1",
    provider: "pi",
    cwd: "/tmp",
    status: "initializing",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as SessionSummary;
}

describe("appendCreatedSession", () => {
  it("inserts a newly-created session that was not previously in the list, at the front", () => {
    const state: SessionListState = { kind: "ready", sessions: [session({ id: "old" })] };
    const next = appendCreatedSession(state, session({ id: "new" }));
    expect(next.kind).toBe("ready");
    expect(next.kind === "ready" && next.sessions.map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("replaces an existing row with the same id rather than duplicating it", () => {
    const state: SessionListState = {
      kind: "ready",
      sessions: [session({ id: "s1", status: "initializing" })],
    };
    const next = appendCreatedSession(state, session({ id: "s1", status: "idle" }));
    expect(next.kind === "ready" && next.sessions).toHaveLength(1);
    expect(next.kind === "ready" && next.sessions[0].status).toBe("idle");
  });

  it("starts a fresh ready list from a non-ready state (loading/error)", () => {
    const next = appendCreatedSession({ kind: "loading" }, session({ id: "s1" }));
    expect(next).toEqual({ kind: "ready", sessions: [session({ id: "s1" })] });
  });

  it("preserves other ready-state fields (stale/connectionPath) unrelated to the sessions array", () => {
    const state: SessionListState = {
      kind: "ready",
      sessions: [],
      stale: true,
      connectionPath: "cellular",
    };
    const next = appendCreatedSession(state, session({ id: "s1" }));
    expect(next).toEqual({
      kind: "ready",
      sessions: [session({ id: "s1" })],
      stale: true,
      connectionPath: "cellular",
    });
  });
});
