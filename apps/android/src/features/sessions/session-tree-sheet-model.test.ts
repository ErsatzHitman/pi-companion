import { describe, expect, it, vi } from "vitest";

import { sessions as coreSessions } from "@picompanion/frontend-core";

import {
  MAX_INDENT_DEPTH,
  SessionTreeActionUnavailableError,
  adaptSessionTreeForkClient,
  cloneSessionTreeNode,
  describeSessionTreeActionUnavailable,
  flattenVisibleSessionTreeRows,
  forkSessionTreeNode,
  isSessionTreeActionAvailable,
  renameSessionTreeNode,
  resolveSessionTreeRowTitle,
  sessionTreeRowIndentDepth,
  showsSessionTreeDepthBadge,
  type SessionTreeClientPort,
} from "./session-tree-sheet-model.js";

const { buildSessionTreeIndex, cloneSession, createRootSession, forkSession } = coreSessions;

/**
 * A small real tree, built through `@picompanion/frontend-core`'s own
 * package specifier (never a source-relative path, per plan.md §6):
 *
 *   root (r1)
 *   ├─ fork (f1)  — forked from r1
 *   │  └─ fork (f2) — forked from f1
 *   └─ fork (f3)  — forked from r1
 *   clone (c1)  — cloned from r1, a separate top-level tree
 */
function buildFixture() {
  const root = createRootSession({ agentId: "r1", name: "Root", createdAt: 1 });
  const forkPoint = { messageId: "m1", index: 0 };
  const f1 = forkSession(root, { agentId: "f1", name: "Fork one", forkPoint, createdAt: 2 });
  const f2 = forkSession(f1, { agentId: "f2", name: "Fork two", forkPoint, createdAt: 3 });
  const f3 = forkSession(root, { agentId: "f3", name: null, forkPoint, createdAt: 4 });
  const c1 = cloneSession(root, { agentId: "c1", name: "Clone one", createdAt: 5 });
  const index = buildSessionTreeIndex([root, f1, f2, f3, c1]);
  return { root, f1, f2, f3, c1, index };
}

describe("flattenVisibleSessionTreeRows", () => {
  it("lists every node depth-first, with the right depth/hasChildren/siblings", () => {
    const { index } = buildFixture();
    const rows = flattenVisibleSessionTreeRows(index, new Set());
    expect(rows.map((row) => row.node.agentId)).toEqual(["r1", "f1", "f2", "f3", "c1"]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 1, 0]);
    expect(rows.find((row) => row.node.agentId === "r1")?.hasChildren).toBe(true);
    expect(rows.find((row) => row.node.agentId === "f2")?.hasChildren).toBe(false);
    expect(rows.find((row) => row.node.agentId === "c1")?.hasChildren).toBe(false);
    // r1 has two children (f1, f3) and c1 is its own second root.
    const f1Row = rows.find((row) => row.node.agentId === "f1")!;
    expect(f1Row.siblingCount).toBe(2);
    expect(f1Row.siblingIndex).toBe(1);
    const rootsRow = rows.find((row) => row.node.agentId === "r1")!;
    expect(rootsRow.siblingCount).toBe(2);
  });

  it("skips a collapsed node's descendants, but not the collapsed node itself or its siblings", () => {
    const { index } = buildFixture();
    const rows = flattenVisibleSessionTreeRows(index, new Set(["f1"]));
    expect(rows.map((row) => row.node.agentId)).toEqual(["r1", "f1", "f3", "c1"]);
  });

  it("returns an empty array for an empty index", () => {
    const index = buildSessionTreeIndex([]);
    expect(flattenVisibleSessionTreeRows(index, new Set())).toEqual([]);
  });
});

describe("resolveSessionTreeRowTitle", () => {
  it("returns the node's name when set", () => {
    const root = createRootSession({ agentId: "r1", name: "My session", createdAt: 1 });
    expect(resolveSessionTreeRowTitle(root)).toBe("My session");
  });

  it("returns a neutral placeholder when name is null", () => {
    const root = createRootSession({ agentId: "r1", createdAt: 1 });
    expect(resolveSessionTreeRowTitle(root)).toBe("Untitled session");
  });
});

describe("sessionTreeRowIndentDepth / showsSessionTreeDepthBadge", () => {
  it("indents 1:1 up to MAX_INDENT_DEPTH, then caps", () => {
    expect(sessionTreeRowIndentDepth(0)).toBe(0);
    expect(sessionTreeRowIndentDepth(MAX_INDENT_DEPTH)).toBe(MAX_INDENT_DEPTH);
    expect(sessionTreeRowIndentDepth(MAX_INDENT_DEPTH + 5)).toBe(MAX_INDENT_DEPTH);
  });

  it("shows the depth badge only once depth exceeds the cap", () => {
    expect(showsSessionTreeDepthBadge(MAX_INDENT_DEPTH)).toBe(false);
    expect(showsSessionTreeDepthBadge(MAX_INDENT_DEPTH + 1)).toBe(true);
  });
});

describe("describeSessionTreeActionUnavailable", () => {
  it("names the specific action, never a generic failure sentence", () => {
    expect(describeSessionTreeActionUnavailable("fork")).toMatch(/^Forking a session/);
    expect(describeSessionTreeActionUnavailable("clone")).toMatch(/^Cloning a session/);
    expect(describeSessionTreeActionUnavailable("rename")).toMatch(/^Renaming a session/);
    expect(describeSessionTreeActionUnavailable("fork")).toContain("no client connection for it");
  });
});

describe("isSessionTreeActionAvailable", () => {
  it("is false for every action when no port is supplied at all", () => {
    expect(isSessionTreeActionAvailable(undefined, "fork")).toBe(false);
    expect(isSessionTreeActionAvailable(undefined, "clone")).toBe(false);
    expect(isSessionTreeActionAvailable(undefined, "rename")).toBe(false);
  });

  it("is true only for the methods a partial port actually implements", () => {
    const port: SessionTreeClientPort = { forkAgent: vi.fn() };
    expect(isSessionTreeActionAvailable(port, "fork")).toBe(true);
    expect(isSessionTreeActionAvailable(port, "clone")).toBe(false);
    expect(isSessionTreeActionAvailable(port, "rename")).toBe(false);
  });
});

describe("forkSessionTreeNode / cloneSessionTreeNode / renameSessionTreeNode: the port dispatch", () => {
  const { root } = buildFixture();

  it("forkSessionTreeNode calls port.forkAgent with the node's agentId and returns its result", async () => {
    const forkAgent = vi.fn(async () => ({ agentId: "r1-fork", name: "Branched" }));
    const result = await forkSessionTreeNode({ forkAgent }, root, { name: "Branched" });
    expect(forkAgent).toHaveBeenCalledWith("r1", { name: "Branched" });
    expect(result).toEqual({ agentId: "r1-fork", name: "Branched" });
  });

  it("cloneSessionTreeNode calls port.cloneAgent with the node's agentId and returns its result", async () => {
    const cloneAgent = vi.fn(async () => ({ agentId: "r1-clone", name: "Copy" }));
    const result = await cloneSessionTreeNode({ cloneAgent }, root, { name: "Copy" });
    expect(cloneAgent).toHaveBeenCalledWith("r1", { name: "Copy" });
    expect(result).toEqual({ agentId: "r1-clone", name: "Copy" });
  });

  it("renameSessionTreeNode calls port.renameAgent with the node's agentId and the new name", async () => {
    const renameAgent = vi.fn(async () => ({ agentId: "r1", name: "Renamed" }));
    const result = await renameSessionTreeNode({ renameAgent }, root, { name: "Renamed" });
    expect(renameAgent).toHaveBeenCalledWith("r1", { name: "Renamed" });
    expect(result).toEqual({ agentId: "r1", name: "Renamed" });
  });

  it("forkSessionTreeNode throws SessionTreeActionUnavailableError('fork') when port has no forkAgent", async () => {
    await expect(forkSessionTreeNode(undefined, root)).rejects.toThrow(
      SessionTreeActionUnavailableError,
    );
    await expect(forkSessionTreeNode({}, root)).rejects.toMatchObject({ action: "fork" });
  });

  it("cloneSessionTreeNode throws SessionTreeActionUnavailableError('clone') when port has no cloneAgent", async () => {
    await expect(cloneSessionTreeNode({ forkAgent: vi.fn() }, root)).rejects.toMatchObject({
      action: "clone",
    });
  });

  it("renameSessionTreeNode throws SessionTreeActionUnavailableError('rename') when port has no renameAgent", async () => {
    await expect(
      renameSessionTreeNode({ forkAgent: vi.fn(), cloneAgent: vi.fn() }, root, {
        name: "x",
      }),
    ).rejects.toMatchObject({ action: "rename" });
  });

  it("the thrown error's message is the same truthful sentence describeSessionTreeActionUnavailable produces", async () => {
    try {
      await forkSessionTreeNode(undefined, root);
      expect.unreachable("forkSessionTreeNode should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SessionTreeActionUnavailableError);
      expect((error as Error).message).toBe(describeSessionTreeActionUnavailable("fork"));
    }
  });

  it("never calls the underlying method when it is absent — the guard runs before any dispatch", async () => {
    const cloneAgent = vi.fn();
    await expect(forkSessionTreeNode({ cloneAgent }, root)).rejects.toThrow(
      SessionTreeActionUnavailableError,
    );
    expect(cloneAgent).not.toHaveBeenCalled();
  });
});

describe("adaptSessionTreeForkClient: the entryId adapter", () => {
  // Head entries keyed by agent id — the route's "last known head entry"
  // stand-in. `r1` is the fixture root (which itself carries no forkPoint,
  // proving the entry comes from the resolver, never the node); `f1` omits
  // entryIndex on purpose; nothing is known for "ghost".
  const headEntries = new Map<string, { entryId: string; entryIndex?: number }>([
    ["r1", { entryId: "m9", entryIndex: 4 }],
    ["f1", { entryId: "m3" }],
  ]);
  const resolveHeadEntry = (agentId: string) => headEntries.get(agentId);

  function forkCapableFake(
    agent: { id: string; title?: string | null } | null = { id: "r1-fork", title: "Branched" },
  ) {
    return {
      forkAgent: vi.fn(async (_agentId: string, _options: unknown) => ({ agent })),
    };
  }

  it("returns undefined for a client without forkAgent (null / undefined / fork-less fake)", () => {
    expect(adaptSessionTreeForkClient(null, resolveHeadEntry)).toBeUndefined();
    expect(adaptSessionTreeForkClient(undefined, resolveHeadEntry)).toBeUndefined();
    expect(adaptSessionTreeForkClient({}, resolveHeadEntry)).toBeUndefined();
    expect(adaptSessionTreeForkClient({ cloneAgent: vi.fn() }, resolveHeadEntry)).toBeUndefined();
  });

  it("supplies the resolver's entryId/entryIndex and unwraps agent.id/agent.title", async () => {
    const fake = forkCapableFake();
    const adapted = adaptSessionTreeForkClient(fake, resolveHeadEntry);
    expect(adapted).toBeDefined();

    const result = await adapted!.forkAgent!("r1", { name: "Branched" });

    expect(fake.forkAgent).toHaveBeenCalledTimes(1);
    expect(fake.forkAgent).toHaveBeenCalledWith("r1", {
      entryId: "m9",
      entryIndex: 4,
      name: "Branched",
    });
    expect(result).toEqual({ agentId: "r1-fork", name: "Branched" });
  });

  it("omits entryIndex when the resolver supplies none, and omits a null name", async () => {
    const fake = forkCapableFake({ id: "f1-fork", title: null });
    const adapted = adaptSessionTreeForkClient(fake, resolveHeadEntry);

    const result = await adapted!.forkAgent!("f1", { name: null });

    expect(fake.forkAgent).toHaveBeenCalledWith("f1", { entryId: "m3" });
    expect(result).toEqual({ agentId: "f1-fork", name: null });
  });

  it("rejects rather than mapping a null-agent resolution (the wire's failure shape)", async () => {
    const adapted = adaptSessionTreeForkClient(forkCapableFake(null), resolveHeadEntry);
    await expect(adapted!.forkAgent!("r1", { name: "Branched" })).rejects.toThrow(
      "did not return a new session",
    );
  });

  it("propagates a daemon rejection unchanged, mapping nothing", async () => {
    const forkAgent = vi.fn(async () => {
      throw new Error("unknown entry m9");
    });
    const adapted = adaptSessionTreeForkClient({ forkAgent }, resolveHeadEntry);
    await expect(adapted!.forkAgent!("r1")).rejects.toThrow("unknown entry m9");
  });

  it("throws a truthful error without calling forkAgent when no head entry is known", async () => {
    const fake = forkCapableFake();
    const adapted = adaptSessionTreeForkClient(fake, resolveHeadEntry);
    await expect(adapted!.forkAgent!("ghost")).rejects.toThrow(
      "No timeline entry known for session ghost",
    );
    expect(fake.forkAgent).not.toHaveBeenCalled();
  });

  it("exposes fork only — no cloneAgent/renameAgent on the adapted port", () => {
    const adapted = adaptSessionTreeForkClient(forkCapableFake(), resolveHeadEntry)!;
    expect(typeof adapted.forkAgent).toBe("function");
    expect("cloneAgent" in adapted).toBe(false);
    expect("renameAgent" in adapted).toBe(false);
    expect(isSessionTreeActionAvailable(adapted, "fork")).toBe(true);
    expect(isSessionTreeActionAvailable(adapted, "clone")).toBe(false);
    expect(isSessionTreeActionAvailable(adapted, "rename")).toBe(false);
  });

  it("forkSessionTreeNode dispatches through an adapted port end to end", async () => {
    const { root } = buildFixture();
    const fake = forkCapableFake();
    const adapted = adaptSessionTreeForkClient(fake, resolveHeadEntry)!;

    const result = await forkSessionTreeNode(adapted, root, { name: "Branched" });

    expect(fake.forkAgent).toHaveBeenCalledWith("r1", {
      entryId: "m9",
      entryIndex: 4,
      name: "Branched",
    });
    expect(result).toEqual({ agentId: "r1-fork", name: "Branched" });
  });
});
