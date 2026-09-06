import { describe, expect, it, vi } from "vitest";
import { createRootSession, forkSession, type SessionTreeNode } from "./tree.js";
import * as treeModule from "./tree.js";
import {
  editFromHere,
  InvalidEditFromHereTargetError,
  resolveEditFromHereForkPoint,
  type EditFromHereTarget,
} from "./tree-edit-shortcut.js";

function buildTarget(overrides: Partial<EditFromHereTarget> = {}): EditFromHereTarget {
  return {
    role: "user",
    id: "msg-5",
    index: 5,
    text: "please use TypeScript instead",
    previous: { id: "msg-4", index: 4 },
    ...overrides,
  };
}

describe("resolveEditFromHereForkPoint", () => {
  it("derives a fork point from the message immediately before the edited one", () => {
    const forkPoint = resolveEditFromHereForkPoint(buildTarget());
    expect(forkPoint).toEqual({ messageId: "msg-4", index: 4 });
  });

  it("throws InvalidEditFromHereTargetError when the edited message has no predecessor", () => {
    const target = buildTarget({ previous: null });
    expect(() => resolveEditFromHereForkPoint(target)).toThrow(InvalidEditFromHereTargetError);
    expect(() => resolveEditFromHereForkPoint(target)).toThrow(/no predecessor/);
  });

  it("throws when the preceding message's index does not come before the edited message's", () => {
    const sameIndex = buildTarget({ previous: { id: "msg-4", index: 5 } });
    expect(() => resolveEditFromHereForkPoint(sameIndex)).toThrow(InvalidEditFromHereTargetError);

    const laterIndex = buildTarget({ previous: { id: "msg-4", index: 9 } });
    expect(() => resolveEditFromHereForkPoint(laterIndex)).toThrow(InvalidEditFromHereTargetError);
  });

  it("throws when the preceding message shares the edited message's id", () => {
    const target = buildTarget({ previous: { id: "msg-5", index: 4 } });
    expect(() => resolveEditFromHereForkPoint(target)).toThrow(/same id/);
  });
});

describe("editFromHere", () => {
  it("forks the parent at the derived fork point and returns the fork alongside it", () => {
    const parent = createRootSession({ agentId: "root", createdAt: 100 });
    const target = buildTarget();

    const result = editFromHere({
      parent,
      agentId: "edit-branch-1",
      createdAt: 500,
      target,
    });

    expect(result.node.kind).toBe("fork");
    expect(result.node.parent).toBe(parent);
    expect(result.node.agentId).toBe("edit-branch-1");
    expect(result.node.forkPoint).toEqual({ messageId: "msg-4", index: 4 });
    expect(result.forkPoint).toEqual({ messageId: "msg-4", index: 4 });
  });

  it("returns the edited message's original text as draftText, for composer refill", () => {
    const parent = createRootSession({ agentId: "root", createdAt: 100 });
    const target = buildTarget({ text: "actually, use pnpm" });

    const result = editFromHere({ parent, agentId: "edit-branch-1", createdAt: 500, target });

    expect(result.draftText).toBe("actually, use pnpm");
  });

  it("inherits the parent's root through the fork, exactly like a direct forkSession call", () => {
    const root = createRootSession({ agentId: "root", createdAt: 100 });
    const forkA = forkSession(root, {
      agentId: "forkA",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 200,
    });
    const target = buildTarget({ id: "msg-9", index: 9, previous: { id: "msg-8", index: 8 } });

    const result = editFromHere({
      parent: forkA,
      agentId: "edit-branch-1",
      createdAt: 500,
      target,
    });

    expect(result.node.root).toBe(root);
  });

  it("composes with a chain of edit-from-here forks the same way T38A1a's forks compose", () => {
    const root = createRootSession({ agentId: "root", createdAt: 100 });
    const first = editFromHere({
      parent: root,
      agentId: "edit-1",
      createdAt: 200,
      target: buildTarget(),
    });
    const second = editFromHere({
      parent: first.node,
      agentId: "edit-2",
      createdAt: 300,
      target: buildTarget({ id: "msg-20", index: 20, previous: { id: "msg-19", index: 19 } }),
    });

    expect(second.node.parent).toBe(first.node);
    expect(second.node.root).toBe(root);
  });

  it("propagates InvalidEditFromHereTargetError without ever calling forkSession", () => {
    const forkSpy = vi.spyOn(treeModule, "forkSession");
    const parent = createRootSession({ agentId: "root", createdAt: 100 });
    const target = buildTarget({ previous: null });

    expect(() =>
      editFromHere({ parent, agentId: "edit-branch-1", createdAt: 500, target }),
    ).toThrow(InvalidEditFromHereTargetError);
    expect(forkSpy).not.toHaveBeenCalled();

    forkSpy.mockRestore();
  });

  it("delegates to the real forkSession rather than duplicating its construction", () => {
    const forkSpy = vi.spyOn(treeModule, "forkSession");
    const parent = createRootSession({ agentId: "root", createdAt: 100 });
    const target = buildTarget();

    const result = editFromHere({ parent, agentId: "edit-branch-1", createdAt: 500, target });

    expect(forkSpy).toHaveBeenCalledTimes(1);
    expect(forkSpy).toHaveBeenCalledWith(parent, {
      agentId: "edit-branch-1",
      forkPoint: { messageId: "msg-4", index: 4 },
      name: undefined,
      createdAt: 500,
    });
    // The node this module hands back is the exact value forkSession's
    // spied call returned — nothing is copied or re-wrapped in between.
    const spiedReturn = forkSpy.mock.results[0]?.value as SessionTreeNode;
    expect(result.node).toBe(spiedReturn);

    forkSpy.mockRestore();
  });
});
