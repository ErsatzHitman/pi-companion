/**
 * RN-free logic behind `session-tree-sheet.tsx` (T39A, plan.md §9.3/§11.1
 * "session tree, fork, clone, resume, and naming"). Everything with a
 * behavioural claim lives here so it can be proven with real `vitest`
 * assertions instead of source-text matching — the `.tsx` view only
 * wires these functions into React Native components (see that file's
 * module doc for the split rationale, matching
 * `../transcript/recovered-turn-model.ts` / `recovered-turn-banner.tsx`'s
 * established pattern in this repository).
 *
 * Renders the tree built by `packages/frontend-core`'s T38A1a model
 * (`SessionTreeNode`/`buildSessionTreeIndex`, imported here only through
 * the package specifier `@picompanion/frontend-core` — never a
 * source-relative cross-workspace path, per plan.md §6). `flattenVisible
 * SessionTreeRows` below is a direct, framework-neutral port of
 * `apps/web/src/features/sessions/session-tree.tsx`'s `flattenVisible`:
 * one flat, depth-first row list plus a collapsed-id set, so a fork
 * renders nested under its structural parent and a clone renders as its
 * own top-level root with a "cloned from …" provenance label — see that
 * file's module doc for the full fork/clone rendering rationale, which
 * this module mirrors rather than reinterprets. `MAX_INDENT_DEPTH` and
 * the depth-badge threshold below are the same bound for the same reason
 * (a fork chain can go arbitrarily deep; visual indentation must not).
 *
 * ## Fork/clone/rename: an injected port, never a bare, unconditionally
 * enabled affordance
 *
 * `packages/client/src` sends none of `forkAgent`, `cloneAgent`, or a
 * rename request today — confirmed at T39A's own review the same way
 * T110 (`docs/issues-from-plan.md`, same wave, running in parallel)
 * confirmed it: `grep -rn "forkAgent|cloneAgent" packages/client/src`
 * returns 0, and no rename request exists either. T110 is the task
 * adding a real wire-connected `DaemonClient.forkAgent`/`cloneAgent`/
 * rename method IN THIS WAVE — this module cannot depend on its output
 * landing first, and must not ship an enabled Fork/Clone/Rename
 * affordance whose only real-build outcome is a failure banner.
 *
 * So every action below is expressed against `SessionTreeClientPort`, an
 * object whose three methods are all OPTIONAL — deliberately the
 * narrowest slice this one sheet needs, the same "narrowest possible
 * slice" reasoning `apps/web/src/features/sessions/daemon-sessions-
 * client.ts`'s `DaemonAgentClient` doc comment gives for its own
 * `forkAgent?`/`cloneAgent?`/`renameAgent?`. `forkSessionTreeNode`/
 * `cloneSessionTreeNode`/`renameSessionTreeNode` throw a typed
 * `SessionTreeActionUnavailableError` — never silently no-op, never a
 * bare crash — when the corresponding method is absent, and
 * `describeSessionTreeActionUnavailable` gives the `.tsx` a truthful,
 * user-facing sentence to show instead of an enabled control that can
 * only fail. With no `client` prop supplied at all (today's only real
 * shape, per T110's disclosure above) every action reports unavailable.
 *
 * DISCLOSED SHAPE GAP: `SessionTreeClientPort.forkAgent` here takes only
 * `{ name? }` — "fork this session from its current tip" — not the
 * `{ entryId, entryIndex?, name? }` a real `DaemonClient.forkAgent` will
 * require (see `daemon-sessions-client.ts`'s `DaemonAgentClient.forkAgent`
 * on web): this sheet has no message-level timeline to pick an `entryId`
 * from, only a list of whole sessions. `packages/frontend-core`'s
 * `sessions/tree-edit-shortcut.ts` (T38A1b) already owns "fork from a
 * specific message" (the composer/transcript's "edit from here"
 * shortcut, `apps/web/src/features/transcript/use-edit-from-here.ts`).
 * Wiring this sheet's Fork button to a real `DaemonClient` will need an
 * adapter that supplies an `entryId` (e.g. the session's last known head
 * entry) — new work for whichever task first has both a real
 * `DaemonClient.forkAgent` (T110) and this sheet in hand, not built here.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */
import type { sessions as coreSessions } from "@picompanion/frontend-core";

/** See the module doc's "Fork/clone/rename" section for the rationale. */
export const MAX_INDENT_DEPTH = 8;

export interface SessionTreeSheetRow {
  readonly node: coreSessions.SessionTreeNode;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly siblingIndex: number;
  readonly siblingCount: number;
}

/**
 * Flattens a `SessionTreeIndex` into one depth-first row list, skipping
 * the descendants of any agentId in `collapsed`. Direct behavioural port
 * of `apps/web/src/features/sessions/session-tree.tsx`'s `flattenVisible`
 * — see this module's doc comment for why the two must stay identical.
 */
export function flattenVisibleSessionTreeRows(
  index: coreSessions.SessionTreeIndex,
  collapsed: ReadonlySet<string>,
): SessionTreeSheetRow[] {
  const rows: SessionTreeSheetRow[] = [];

  function walk(nodes: readonly coreSessions.SessionTreeNode[], depth: number): void {
    nodes.forEach((node, position) => {
      const children = index.getChildren(node.agentId);
      rows.push({
        node,
        depth,
        hasChildren: children.length > 0,
        siblingIndex: position + 1,
        siblingCount: nodes.length,
      });
      if (children.length > 0 && !collapsed.has(node.agentId)) {
        walk(children, depth + 1);
      }
    });
  }

  walk(index.roots, 0);
  return rows;
}

/** A node's display title — `node.name`, or a neutral placeholder when unset. */
export function resolveSessionTreeRowTitle(node: coreSessions.SessionTreeNode): string {
  return node.name ?? "Untitled session";
}

/** The capped visual indent for a row at `depth` — see `MAX_INDENT_DEPTH`'s doc. */
export function sessionTreeRowIndentDepth(depth: number): number {
  return Math.min(depth, MAX_INDENT_DEPTH);
}

/** True once a row's true depth has been capped, so the `.tsx` shows the "L<n>" depth badge instead of more indentation. */
export function showsSessionTreeDepthBadge(depth: number): boolean {
  return depth > MAX_INDENT_DEPTH;
}

/** The three fork/clone/rename actions this sheet can request. */
export type SessionTreeActionKind = "fork" | "clone" | "rename";

export interface SessionTreeForkOptions {
  readonly name?: string | null;
}

export interface SessionTreeCloneOptions {
  readonly name?: string | null;
}

export interface SessionTreeRenameOptions {
  readonly name: string;
}

/** What a successful fork/clone/rename call reports back. */
export interface SessionTreeActionResult {
  readonly agentId: string;
  readonly name: string | null;
}

/**
 * The injected fork/clone/rename port — see the module doc's "Fork/
 * clone/rename" section. Every method is optional so an object
 * implementing none of them (today's only real shape) still structurally
 * satisfies this interface, exactly as `DaemonAgentClient` on web keeps
 * being satisfied by a real `DaemonClient` that implements none of its
 * own `forkAgent?`/`cloneAgent?`/`renameAgent?`.
 */
export interface SessionTreeClientPort {
  forkAgent?(agentId: string, options?: SessionTreeForkOptions): Promise<SessionTreeActionResult>;
  cloneAgent?(agentId: string, options?: SessionTreeCloneOptions): Promise<SessionTreeActionResult>;
  renameAgent?(
    agentId: string,
    options: SessionTreeRenameOptions,
  ): Promise<SessionTreeActionResult>;
}

/**
 * Thrown by `forkSessionTreeNode`/`cloneSessionTreeNode`/
 * `renameSessionTreeNode` when the injected `SessionTreeClientPort` does
 * not implement the requested action — reasoned rejection, never a
 * silent no-op and never a bare method-missing crash. Mirrors
 * `../../../packages/frontend-core/src/sessions/tree-edit-shortcut.ts`'s
 * `InvalidEditFromHereTargetError` shape: a named error class a caller
 * can catch and render, not just a generic `Error`.
 */
export class SessionTreeActionUnavailableError extends Error {
  readonly action: SessionTreeActionKind;

  constructor(action: SessionTreeActionKind) {
    super(describeSessionTreeActionUnavailable(action));
    this.name = "SessionTreeActionUnavailableError";
    this.action = action;
  }
}

/**
 * The truthful, user-facing sentence for an unavailable action — never
 * "Something went wrong", always naming which action and why. Used both
 * as `SessionTreeActionUnavailableError`'s message and directly by the
 * `.tsx` to caption a disabled action button before it is ever pressed.
 */
export function describeSessionTreeActionUnavailable(action: SessionTreeActionKind): string {
  const verb = action === "fork" ? "Forking" : action === "clone" ? "Cloning" : "Renaming";
  return `${verb} a session isn't available yet — this build has no client connection for it.`;
}

/** Whether `port` implements the given action today. `port` may be `undefined` (no client injected at all). */
export function isSessionTreeActionAvailable(
  port: SessionTreeClientPort | undefined,
  action: SessionTreeActionKind,
): boolean {
  if (!port) return false;
  if (action === "fork") return typeof port.forkAgent === "function";
  if (action === "clone") return typeof port.cloneAgent === "function";
  return typeof port.renameAgent === "function";
}

/** Forks `node` via `port.forkAgent`, or throws `SessionTreeActionUnavailableError("fork")` when absent. */
export async function forkSessionTreeNode(
  port: SessionTreeClientPort | undefined,
  node: coreSessions.SessionTreeNode,
  options?: SessionTreeForkOptions,
): Promise<SessionTreeActionResult> {
  if (!port?.forkAgent) {
    throw new SessionTreeActionUnavailableError("fork");
  }
  return port.forkAgent(node.agentId, options);
}

/** Clones `node` via `port.cloneAgent`, or throws `SessionTreeActionUnavailableError("clone")` when absent. */
export async function cloneSessionTreeNode(
  port: SessionTreeClientPort | undefined,
  node: coreSessions.SessionTreeNode,
  options?: SessionTreeCloneOptions,
): Promise<SessionTreeActionResult> {
  if (!port?.cloneAgent) {
    throw new SessionTreeActionUnavailableError("clone");
  }
  return port.cloneAgent(node.agentId, options);
}

/** Renames `node` via `port.renameAgent`, or throws `SessionTreeActionUnavailableError("rename")` when absent. */
export async function renameSessionTreeNode(
  port: SessionTreeClientPort | undefined,
  node: coreSessions.SessionTreeNode,
  options: SessionTreeRenameOptions,
): Promise<SessionTreeActionResult> {
  if (!port?.renameAgent) {
    throw new SessionTreeActionUnavailableError("rename");
  }
  return port.renameAgent(node.agentId, options);
}
