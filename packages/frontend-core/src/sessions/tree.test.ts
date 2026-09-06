import { describe, expect, it } from "vitest";
import {
  buildSessionTreeIndex,
  cloneSession,
  createRootSession,
  forkSession,
  getAncestors,
  getPathFromRoot,
  isDescendantOf,
  type SessionTreeNode,
} from "./tree.js";

describe("createRootSession", () => {
  it("creates a parentless node that is its own root", () => {
    const root = createRootSession({ agentId: "s1", name: "Root", createdAt: 100 });
    expect(root.kind).toBe("root");
    expect(root.parent).toBeNull();
    expect(root.forkPoint).toBeNull();
    expect(root.clonedFrom).toBeNull();
    expect(root.root).toBe(root);
    expect(root.name).toBe("Root");
  });

  it("defaults name to null when omitted", () => {
    const root = createRootSession({ agentId: "s1", createdAt: 100 });
    expect(root.name).toBeNull();
  });
});

describe("forkSession", () => {
  it("attaches the fork to its parent and inherits the parent's root", () => {
    const root = createRootSession({ agentId: "root", createdAt: 100 });
    const fork = forkSession(root, {
      agentId: "fork1",
      forkPoint: { messageId: "m5", index: 5 },
      createdAt: 200,
    });

    expect(fork.kind).toBe("fork");
    expect(fork.parent).toBe(root);
    expect(fork.root).toBe(root);
    expect(fork.forkPoint).toEqual({ messageId: "m5", index: 5 });
    expect(fork.clonedFrom).toBeNull();
  });

  it("inherits root transitively through a chain of forks", () => {
    const root = createRootSession({ agentId: "root", createdAt: 100 });
    const forkA = forkSession(root, {
      agentId: "forkA",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 200,
    });
    const forkB = forkSession(forkA, {
      agentId: "forkB",
      forkPoint: { messageId: "m2", index: 2 },
      createdAt: 300,
    });

    expect(forkB.parent).toBe(forkA);
    expect(forkB.root).toBe(root);
    expect(forkA.root).toBe(root);
  });
});

describe("cloneSession", () => {
  it("starts a brand-new tree: no structural parent, root is itself", () => {
    const source = createRootSession({ agentId: "source", createdAt: 100 });
    const clone = cloneSession(source, { agentId: "clone1", createdAt: 200 });

    expect(clone.kind).toBe("clone");
    expect(clone.parent).toBeNull();
    expect(clone.root).toBe(clone);
    expect(clone.forkPoint).toBeNull();
  });

  it("records provenance via clonedFrom without making it a structural edge", () => {
    const source = createRootSession({ agentId: "source", createdAt: 100 });
    const clone = cloneSession(source, { agentId: "clone1", createdAt: 200 });

    expect(clone.clonedFrom).toBe(source);
  });

  it("cloning a fork still produces a new independent root, not the fork's root", () => {
    const root = createRootSession({ agentId: "root", createdAt: 100 });
    const fork = forkSession(root, {
      agentId: "fork1",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 200,
    });
    const clone = cloneSession(fork, { agentId: "clone1", createdAt: 300 });

    expect(clone.root).toBe(clone);
    expect(clone.root).not.toBe(root);
    expect(clone.clonedFrom).toBe(fork);
  });
});

describe("fork and clone behave differently, not identically", () => {
  it("getAncestors walks a fork's parent chain but stops at a clone boundary", () => {
    const root = createRootSession({ agentId: "root", createdAt: 100 });
    const fork = forkSession(root, {
      agentId: "fork1",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 200,
    });
    const clone = cloneSession(fork, { agentId: "clone1", createdAt: 300 });

    expect(getAncestors(fork)).toEqual([root]);
    // The clone's ancestry is empty even though it was cloned from `fork`,
    // which itself has one ancestor (`root`) — proving clonedFrom is not
    // walked as a structural edge.
    expect(getAncestors(clone)).toEqual([]);
  });

  it("getPathFromRoot differs: fork includes its parent chain, clone is only itself", () => {
    const root = createRootSession({ agentId: "root", createdAt: 100 });
    const fork = forkSession(root, {
      agentId: "fork1",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 200,
    });
    const clone = cloneSession(fork, { agentId: "clone1", createdAt: 300 });

    expect(getPathFromRoot(fork).map((n) => n.agentId)).toEqual(["root", "fork1"]);
    expect(getPathFromRoot(clone).map((n) => n.agentId)).toEqual(["clone1"]);
  });

  it("isDescendantOf is true across a fork edge, false across a clone boundary", () => {
    const root = createRootSession({ agentId: "root", createdAt: 100 });
    const fork = forkSession(root, {
      agentId: "fork1",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 200,
    });
    const clone = cloneSession(fork, { agentId: "clone1", createdAt: 300 });

    expect(isDescendantOf(fork, root)).toBe(true);
    expect(isDescendantOf(clone, fork)).toBe(false);
    expect(isDescendantOf(clone, root)).toBe(false);
    // Every node is trivially a descendant of itself.
    expect(isDescendantOf(clone, clone)).toBe(true);
  });

  it("a clone's own future forks form a new tree that never rejoins the source's tree", () => {
    const root = createRootSession({ agentId: "root", createdAt: 100 });
    const clone = cloneSession(root, { agentId: "clone1", createdAt: 200 });
    const cloneChild = forkSession(clone, {
      agentId: "cloneChild",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 300,
    });

    expect(cloneChild.root).toBe(clone);
    expect(cloneChild.root).not.toBe(root);
    expect(isDescendantOf(cloneChild, root)).toBe(false);
  });
});

describe("cycles are impossible by construction", () => {
  it("a multi-level fork chain terminates under plain ancestor walking with no cycle guard", () => {
    const root = createRootSession({ agentId: "root", createdAt: 0 });
    let current = root;
    const chain: SessionTreeNode[] = [root];
    for (let i = 1; i <= 50; i += 1) {
      current = forkSession(current, {
        agentId: `fork${i}`,
        forkPoint: { messageId: `m${i}`, index: i },
        createdAt: i,
      });
      chain.push(current);
    }

    // getAncestors has no visited-set and no depth cap (see tree.ts doc);
    // this only terminates because the shape cannot contain a cycle.
    expect(getAncestors(current)).toHaveLength(50);
    expect(getAncestors(current)[49]).toBe(root);
  });

  it("nodes are frozen, so a cast-and-reassign attempt to forge a back-edge throws", () => {
    const root = createRootSession({ agentId: "root", createdAt: 100 });
    const fork = forkSession(root, {
      agentId: "fork1",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 200,
    });

    expect(Object.isFrozen(root)).toBe(true);
    expect(Object.isFrozen(fork)).toBe(true);

    // Attempt the only way a back-edge could exist: mutate an
    // already-constructed node's `.parent` after the fact (here, trying
    // to make the root point back at its own fork). TypeScript's
    // `readonly` already forbids this at compile time; the cast bypasses
    // that so this test proves the *runtime* guarantee independently.
    expect(() => {
      (root as unknown as { parent: SessionTreeNode }).parent = fork;
    }).toThrow(TypeError);

    // The attempted mutation did not take effect.
    expect(root.parent).toBeNull();
  });
});

describe("buildSessionTreeIndex", () => {
  function buildSample() {
    const root = createRootSession({ agentId: "root", createdAt: 100 });
    const forkA = forkSession(root, {
      agentId: "forkA",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 300,
    });
    const forkB = forkSession(root, {
      agentId: "forkB",
      forkPoint: { messageId: "m2", index: 2 },
      createdAt: 200,
    });
    const clone = cloneSession(forkA, { agentId: "clone1", createdAt: 400 });
    return { root, forkA, forkB, clone };
  }

  it("treats both true roots and clones as forest roots", () => {
    const { root, forkA, forkB, clone } = buildSample();
    const index = buildSessionTreeIndex([root, forkA, forkB, clone]);

    expect(index.roots.map((n) => n.agentId)).toEqual(["root", "clone1"]);
  });

  it("groups direct children under their structural parent, ordered by createdAt", () => {
    const { root, forkA, forkB, clone } = buildSample();
    const index = buildSessionTreeIndex([root, forkA, forkB, clone]);

    // forkB (createdAt 200) sorts before forkA (createdAt 300).
    expect(index.getChildren("root").map((n) => n.agentId)).toEqual(["forkB", "forkA"]);
    expect(index.getChildren("forkA").map((n) => n.agentId)).toEqual([]);
    // The clone is not a child of the node it was cloned from.
    expect(index.getChildren("forkA")).not.toContain(clone);
  });

  it("looks nodes up by id", () => {
    const { root, forkA, forkB, clone } = buildSample();
    const index = buildSessionTreeIndex([root, forkA, forkB, clone]);

    expect(index.byId.get("forkA")).toBe(forkA);
    expect(index.byId.get("missing")).toBeUndefined();
    expect(index.byId.size).toBe(4);
  });

  it("returns an empty array for a node with no children", () => {
    const root = createRootSession({ agentId: "solo", createdAt: 100 });
    const index = buildSessionTreeIndex([root]);
    expect(index.getChildren("solo")).toEqual([]);
    expect(index.getChildren("does-not-exist")).toEqual([]);
  });

  it("breaks createdAt ties deterministically by agentId", () => {
    const root = createRootSession({ agentId: "root", createdAt: 100 });
    const forkZ = forkSession(root, {
      agentId: "z",
      forkPoint: { messageId: "m1", index: 1 },
      createdAt: 500,
    });
    const forkA = forkSession(root, {
      agentId: "a",
      forkPoint: { messageId: "m2", index: 2 },
      createdAt: 500,
    });

    const index = buildSessionTreeIndex([root, forkZ, forkA]);
    expect(index.getChildren("root").map((n) => n.agentId)).toEqual(["a", "z"]);
  });
});
