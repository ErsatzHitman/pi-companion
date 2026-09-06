/**
 * Session tree model — plan.md §7.1, §11.1 ("session tree, fork, clone,
 * resume, and naming"), T38A1a.
 *
 * Models parent/child relationships between Pi sessions, framework- and
 * I/O-neutrally, so `apps/web` (T38A2 renders it, T38A3 drives fork/clone
 * actions against it) and a later `apps/android` equivalent can share one
 * definition of what a session "tree" is instead of each inventing one.
 *
 * ## Fork vs. clone: two different relationships, not one
 *
 * Pi's RPC surface exposes both `fork` and `clone` (plan.md §11.1's 32-command
 * list; mirrored into `rpc-types.ts` by T38A0). They are commonly conflated
 * because both "make a new session out of an old one", but they produce
 * structurally different results and this model does NOT treat them the
 * same:
 *
 *  - **Fork** creates a new session that stays inside the *same* tree as its
 *    parent, attached at a specific point in the parent's history (a
 *    `SessionForkPoint`: the last shared message id, plus an index for
 *    stable ordering/display). `getRoot()` on a fork and on its parent
 *    return the *same* node. `isDescendantOf()` is true across a fork edge.
 *    A fork is how "branch the conversation from here" (T38A1b's
 *    edit-from-here shortcut) is expressed.
 *
 *  - **Clone** duplicates a session's content into a brand-new,
 *    *independent* session that starts its *own* tree: `.parent` is always
 *    `null` and `getRoot()` returns the clone itself, never the source.
 *    `isDescendantOf()` is false between a clone and its source. The only
 *    thing that survives the copy is provenance — `clonedFrom`, a plain
 *    historical pointer ("this session began life as a copy of that one")
 *    that callers may use for a "cloned from X" label, but which this
 *    module never treats as a tree edge: it is not walked by
 *    `getAncestors`/`getPathFromRoot`/`isDescendantOf`, and a clone's
 *    descendants never appear when listing the source's children.
 *
 * If a later task needs "went back far enough" reasoning that spans a
 * clone boundary, it must say so explicitly via `clonedFrom` — this module
 * will not silently blur the two relationships into one.
 *
 * ## Cycles are impossible by construction, not merely forbidden
 *
 * A weaker design would keep nodes in a mutable `Map<id, { parentId }>`
 * and reject a cycle with a runtime check (walk the ancestor chain, throw
 * if you see the new node's own id again). That check only catches a
 * cycle someone already tried to create, and it has to be remembered and
 * re-run every time the map is mutated.
 *
 * This module instead makes a cycle inexpressible:
 *
 *  1. `SessionTreeNode.parent` holds a direct reference to an already
 *     fully-constructed node value, never a string id looked up later. The
 *     only two ways to produce a node are `createRootSession` (parent
 *     always `null`) and `forkSession(parent, …)` (parent is whatever
 *     `SessionTreeNode` value the caller already holds). To fork a node
 *     into existence you must already hold its parent as a *value* — you
 *     cannot reference a node that does not exist yet, and there is no API
 *     that takes an id and resolves it to a node lazily. A back-edge would
 *     require constructing node A's parent pointer from node B before B
 *     exists, which is not an operation this module exposes.
 *  2. Every node is `Object.freeze`d before it is returned, so `.parent`
 *     cannot be reassigned after construction even by a caller that
 *     reaches past the `readonly` compile-time guard with a cast — the
 *     assignment throws in strict mode (every file in this package is an
 *     ES module, which is always strict). `import-guard.test.ts` proves
 *     this repository never turns strict mode off.
 *  3. `clonedFrom` is stored as a separate, clearly-labelled field and is
 *     never consulted by any ancestor-walking function, so it cannot
 *     reintroduce a cycle into the structural parent chain even though it
 *     is itself just another node reference.
 *
 * Because of (1) and (2), `getAncestors` can walk `.parent` in a plain
 * `while` loop with no visited-set and no depth cap: the shape of the data
 * guarantees termination, so a defensive cycle check would be dead code
 * protecting against a state the type/runtime system already rules out.
 * `tree.test.ts` proves this by attempting the mutation in (2) directly
 * and asserting it throws, rather than only asserting that walking a
 * legitimately-built tree terminates (which a runtime guard would also
 * make pass, masking the difference this comment claims).
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */

/** How a session came to exist, for display and for the fork/clone distinction above. */
export type SessionBranchKind = "root" | "fork" | "clone";

/**
 * Where a fork diverges from its parent's history. `messageId` is the last
 * message the fork still shares with its parent; `index` is that
 * message's position in the parent's timeline, carried alongside the id
 * purely so callers can order/display fork points without re-resolving
 * the id against a timeline (this module never reads a timeline itself).
 */
export interface SessionForkPoint {
  readonly messageId: string;
  readonly index: number;
}

/**
 * One node in a session tree. Construct only via `createRootSession` or
 * `forkSession`/`cloneSession` — never build this shape by hand, or the
 * "cycles are impossible by construction" guarantee above does not apply
 * to it.
 */
export interface SessionTreeNode {
  readonly agentId: string;
  readonly name: string | null;
  readonly kind: SessionBranchKind;
  /**
   * The structural parent: `null` for a root or a clone, the fork's
   * parent node for a fork. This is the only edge `getAncestors`,
   * `getPathFromRoot`, and `isDescendantOf` walk.
   */
  readonly parent: SessionTreeNode | null;
  /** Set only when `kind === "fork"`; `null` for every other kind. */
  readonly forkPoint: SessionForkPoint | null;
  /**
   * Set only when `kind === "clone"`; `null` for every other kind. A
   * provenance pointer, never a structural edge — see the module doc.
   */
  readonly clonedFrom: SessionTreeNode | null;
  /**
   * The root of this node's own tree: itself for a root or a clone (a
   * clone starts a new tree), the shared root for every node reachable
   * by following `.parent` from a fork.
   */
  readonly root: SessionTreeNode;
  /** Epoch milliseconds; used only to order siblings deterministically. */
  readonly createdAt: number;
}

export interface CreateRootSessionParams {
  readonly agentId: string;
  readonly name?: string | null;
  readonly createdAt: number;
}

export interface ForkSessionParams {
  readonly agentId: string;
  readonly forkPoint: SessionForkPoint;
  readonly name?: string | null;
  readonly createdAt: number;
}

export interface CloneSessionParams {
  readonly agentId: string;
  readonly name?: string | null;
  readonly createdAt: number;
}

/** Creates a new, parentless root node — the daemon's `new_session`. */
export function createRootSession(params: CreateRootSessionParams): SessionTreeNode {
  const node: Omit<SessionTreeNode, "root"> & { root?: SessionTreeNode } = {
    agentId: params.agentId,
    name: params.name ?? null,
    kind: "root",
    parent: null,
    forkPoint: null,
    clonedFrom: null,
    createdAt: params.createdAt,
  };
  // A root is its own root; assign after construction so the object
  // literal above can be frozen as a single, complete value.
  node.root = node as SessionTreeNode;
  return Object.freeze(node) as SessionTreeNode;
}

/**
 * Forks `parent` at `forkPoint`, producing a new node in `parent`'s tree
 * (`root` is inherited from `parent`, transitively through any chain of
 * forks). Corresponds to the daemon's `fork` RPC.
 */
export function forkSession(parent: SessionTreeNode, params: ForkSessionParams): SessionTreeNode {
  const node: SessionTreeNode = {
    agentId: params.agentId,
    name: params.name ?? null,
    kind: "fork",
    parent,
    forkPoint: params.forkPoint,
    clonedFrom: null,
    root: parent.root,
    createdAt: params.createdAt,
  };
  return Object.freeze(node);
}

/**
 * Clones `source` into a brand-new, independent root — a new tree, not a
 * child of `source`'s tree. `clonedFrom` is the only surviving link, and
 * it is provenance, not structure (see the module doc). Corresponds to
 * the daemon's `clone` RPC.
 */
export function cloneSession(source: SessionTreeNode, params: CloneSessionParams): SessionTreeNode {
  const node: Omit<SessionTreeNode, "root"> & { root?: SessionTreeNode } = {
    agentId: params.agentId,
    name: params.name ?? null,
    kind: "clone",
    parent: null,
    forkPoint: null,
    clonedFrom: source,
    createdAt: params.createdAt,
  };
  node.root = node as SessionTreeNode;
  return Object.freeze(node) as SessionTreeNode;
}

/** Structural ancestors of `node`, nearest first. Empty for a root or a clone. */
export function getAncestors(node: SessionTreeNode): SessionTreeNode[] {
  const ancestors: SessionTreeNode[] = [];
  let current = node.parent;
  while (current !== null) {
    ancestors.push(current);
    current = current.parent;
  }
  return ancestors;
}

/**
 * The structural path from `node`'s root down to and including `node`,
 * root first — the breadcrumb/"edit from here" shape T38A1b builds on.
 */
export function getPathFromRoot(node: SessionTreeNode): SessionTreeNode[] {
  const ancestors = getAncestors(node);
  ancestors.reverse();
  ancestors.push(node);
  return ancestors;
}

/**
 * True when `node` is `candidate` or a structural (fork-chain) descendant
 * of it. Always false across a clone boundary, even when one is
 * `clonedFrom` the other — a clone is a different tree by design.
 */
export function isDescendantOf(node: SessionTreeNode, candidate: SessionTreeNode): boolean {
  let current: SessionTreeNode | null = node;
  while (current !== null) {
    if (current.agentId === candidate.agentId) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * A read-side index over a flat collection of already-constructed nodes:
 * fast lookup by id and, since a `SessionTreeNode` only points at its
 * parent, the reverse (parent -> children) view a tree renderer needs.
 * Building this index cannot introduce a cycle — it only reads edges each
 * node already carries from construction, per the module doc above — and
 * it copies nothing that would let a caller mutate a node's `.parent`.
 */
export interface SessionTreeIndex {
  /** Nodes with no structural parent: every root, and every clone. */
  readonly roots: readonly SessionTreeNode[];
  readonly byId: ReadonlyMap<string, SessionTreeNode>;
  /** Direct children of `agentId`, ordered by `createdAt` then `agentId`. */
  getChildren(agentId: string): readonly SessionTreeNode[];
}

function compareSiblings(a: SessionTreeNode, b: SessionTreeNode): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }
  return a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0;
}

export function buildSessionTreeIndex(nodes: Iterable<SessionTreeNode>): SessionTreeIndex {
  const byId = new Map<string, SessionTreeNode>();
  const childrenByParentId = new Map<string, SessionTreeNode[]>();
  const roots: SessionTreeNode[] = [];

  for (const node of nodes) {
    byId.set(node.agentId, node);
  }
  for (const node of byId.values()) {
    if (node.parent === null) {
      roots.push(node);
      continue;
    }
    const siblings = childrenByParentId.get(node.parent.agentId);
    if (siblings === undefined) {
      childrenByParentId.set(node.parent.agentId, [node]);
    } else {
      siblings.push(node);
    }
  }

  roots.sort(compareSiblings);
  for (const siblings of childrenByParentId.values()) {
    siblings.sort(compareSiblings);
  }

  return {
    roots,
    byId,
    getChildren(agentId: string): readonly SessionTreeNode[] {
      return childrenByParentId.get(agentId) ?? [];
    },
  };
}
