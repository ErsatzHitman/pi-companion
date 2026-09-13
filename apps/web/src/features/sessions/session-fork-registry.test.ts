import { describe, expect, it } from "vitest";

import {
  clearRecordedRelationshipsForTests,
  getRecordedRelationships,
  recordForkRelationship,
} from "./session-fork-registry.js";
import { buildSessionTree } from "./session-tree-state.js";
import type { SessionSummary } from "./types.js";

function summary(id: string, title: string | null = null): SessionSummary {
  return {
    id,
    title,
    provider: "pi",
    cwd: "/repo",
    status: "idle",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
  } as SessionSummary;
}

describe("session-fork-registry (fork-lands-as-root close)", () => {
  it("records a transcript fork so buildSessionTree places it under its real parent", () => {
    clearRecordedRelationshipsForTests();
    recordForkRelationship("forked-1", {
      kind: "fork",
      parentId: "source-1",
      forkPoint: { messageId: "a1", index: 1 },
    });

    const nodes = buildSessionTree(
      [summary("source-1", "Source"), summary("forked-1", "Branch")],
      getRecordedRelationships(),
    );
    const forked = nodes.find((node) => node.agentId === "forked-1");
    expect(forked?.kind).toBe("fork");
    expect(forked?.parent?.agentId).toBe("source-1");
    expect(forked?.root.agentId).toBe("source-1");
    clearRecordedRelationshipsForTests();
  });

  it("starts empty and clears for tests", () => {
    clearRecordedRelationshipsForTests();
    expect(getRecordedRelationships().size).toBe(0);
  });
});
