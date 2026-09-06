import { sessions as coreSessions } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

import { buildSessionTree } from "./session-tree-state.js";
import type { SessionRelationship } from "./session-tree-state.js";
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

describe("buildSessionTree (T38A3)", () => {
  it("renders every session with no relationship as its own root", () => {
    const sessions = [session({ id: "a" }), session({ id: "b" })];
    const nodes = buildSessionTree(sessions, new Map());

    expect(nodes).toHaveLength(2);
    expect(nodes.every((node) => node.kind === "root" && node.parent === null)).toBe(true);
  });

  it("places a forked session under its structural parent, matching frontend-core's tree", () => {
    const sessions = [
      session({ id: "root", title: "Root" }),
      session({ id: "child", title: "Child" }),
    ];
    const relationships = new Map<string, SessionRelationship>([
      ["child", { kind: "fork", parentId: "root", forkPoint: { messageId: "m1", index: 1 } }],
    ]);

    const nodes = buildSessionTree(sessions, relationships);
    const root = nodes.find((n) => n.agentId === "root")!;
    const child = nodes.find((n) => n.agentId === "child")!;

    expect(child.kind).toBe("fork");
    expect(child.parent?.agentId).toBe("root");
    expect(coreSessions.isDescendantOf(child, root)).toBe(true);
    expect(child.forkPoint).toEqual({ messageId: "m1", index: 1 });
    expect(child.root.agentId).toBe("root");
  });

  it("places a cloned session as its own new root, never nested under its source", () => {
    const sessions = [
      session({ id: "root", title: "Root" }),
      session({ id: "copy", title: "Copy" }),
    ];
    const relationships = new Map<string, SessionRelationship>([
      ["copy", { kind: "clone", sourceId: "root" }],
    ]);

    const nodes = buildSessionTree(sessions, relationships);
    const root = nodes.find((n) => n.agentId === "root")!;
    const clone = nodes.find((n) => n.agentId === "copy")!;

    expect(clone.kind).toBe("clone");
    expect(clone.parent).toBeNull();
    expect(clone.root.agentId).toBe("copy");
    expect(clone.clonedFrom?.agentId).toBe("root");
    expect(coreSessions.isDescendantOf(clone, root)).toBe(false);
  });

  it("falls back to a root when a relationship points at a session no longer in the list", () => {
    const sessions = [session({ id: "child" })];
    const relationships = new Map<string, SessionRelationship>([
      [
        "child",
        { kind: "fork", parentId: "deleted-parent", forkPoint: { messageId: "m1", index: 1 } },
      ],
    ]);

    const nodes = buildSessionTree(sessions, relationships);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.kind).toBe("root");
    expect(nodes[0]!.parent).toBeNull();
  });

  it("supports a multi-level fork chain built incrementally, one relationship at a time", () => {
    const sessions = [
      session({ id: "root" }),
      session({ id: "child" }),
      session({ id: "grandchild" }),
    ];
    const relationships = new Map<string, SessionRelationship>([
      ["child", { kind: "fork", parentId: "root", forkPoint: { messageId: "m1", index: 1 } }],
      ["grandchild", { kind: "fork", parentId: "child", forkPoint: { messageId: "m2", index: 2 } }],
    ]);

    const nodes = buildSessionTree(sessions, relationships);
    const grandchild = nodes.find((n) => n.agentId === "grandchild")!;
    const root = nodes.find((n) => n.agentId === "root")!;

    expect(coreSessions.getPathFromRoot(grandchild).map((n) => n.agentId)).toEqual([
      "root",
      "child",
      "grandchild",
    ]);
    expect(grandchild.root.agentId).toBe(root.agentId);
  });

  it("does not loop forever on a malformed cyclic relationships map", () => {
    // This can never arise from the normal fork/clone flow (a relationship
    // is only ever recorded for a brand-new id pointing at an
    // already-existing one), but the guard is proven directly here rather
    // than only "known to be unreachable".
    const sessions = [session({ id: "a" }), session({ id: "b" })];
    const relationships = new Map<string, SessionRelationship>([
      ["a", { kind: "fork", parentId: "b", forkPoint: { messageId: "m1", index: 1 } }],
      ["b", { kind: "fork", parentId: "a", forkPoint: { messageId: "m2", index: 2 } }],
    ]);

    expect(() => buildSessionTree(sessions, relationships)).not.toThrow();
  });
});
