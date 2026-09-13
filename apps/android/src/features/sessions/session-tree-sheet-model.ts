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
 * CORRECTED (wire-apps-followup): this previously said
 * "`packages/client/src` still sends no `cloneAgent` or rename request" and
 * that "Clone/Rename stay gated until their own wire methods land". Both
 * halves have since landed (`agent.clone.request`/`agent.clone.response` +
 * `DaemonClient.cloneAgent`, `agent.rename.request`/`agent.rename.response` +
 * `DaemonClient.renameAgent`), so a real `DaemonClient` can now back all
 * three of this sheet's actions — fork through `adaptSessionTreeForkClient`
 * (the entryId adapter), clone through `adaptSessionTreeCloneClient`, and
 * rename through `adaptSessionTreeRenameClient` below. The port stays
 * optional-per-method so partial fakes and the no-client case still render
 * truthful unavailable states instead of an enabled control that can only
 * fail.
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
 * only fail. With no `client` prop supplied at all (still today's only real
 * shape — no route passes one yet, see `session-route-daemon-clients.ts`'s
 * `resolveSessionTreeForkClient`) every action reports unavailable.
 *
 * DISCLOSED SHAPE GAP, fork half closed by `adaptSessionTreeForkClient`
 * below: `SessionTreeClientPort.forkAgent` here takes only `{ name? }` —
 * "fork this session from its current tip" — not the
 * `{ entryId, entryIndex?, name? }` a real `DaemonClient.forkAgent` requires
 * (see `daemon-sessions-client.ts`'s `DaemonAgentClient.forkAgent` on web,
 * required since the fork wire landed): this sheet has no message-level timeline to pick an `entryId`
 * from, only a list of whole sessions. `packages/frontend-core`'s
 * `sessions/tree-edit-shortcut.ts` (T38A1b) already owns "fork from a
 * specific message" (the composer/transcript's "edit from here"
 * shortcut, `apps/web/src/features/transcript/use-edit-from-here.ts`).
 * This sheet's Fork button reaches a real `DaemonClient` through
 * `adaptSessionTreeForkClient`, which supplies the missing `entryId` from a
 * caller-provided head-entry resolver (e.g. the session route's last known
 * head entry per agent id) and maps the wire's `{ agent: { id, title } }`
 * to this port's `{ agentId, name }`, following `host-session-screen.tsx`'s
 * `adaptEditFromHereForkClient` mapping shape (a null name is sent as
 * absent, a null agent rejects rather than mapping). Clone needs no such
 * adapter for a missing id — `DaemonClient.cloneAgent` takes only an
 * optional `name` — so `adaptSessionTreeCloneClient` below is a straight
 * null-mapping adapter (null name sent as absent, null agent rejects).
 * Rename maps the port's `{ name }` options object onto the real
 * `DaemonClient.renameAgent(agentId, name)` two-string shape via
 * `adaptSessionTreeRenameClient`. CORRECTED (wire-apps-followup): this
 * previously said "Clone stays out of scope: no `cloneAgent` wire message
 * or client method exists, so an adapted port exposes fork only." That was
 * true when written and is false now — the clone and rename wires have
 * landed, and the adapted ports below expose all three.
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
 * implementing none of them (the no-client case) still structurally
 * satisfies this interface. CORRECTED (wire-apps-followup): this previously
 * said that was "today's only real shape" and "exactly as
 * `DaemonAgentClient` on web keeps being satisfied by a real `DaemonClient`
 * that implements none of its own `forkAgent?`/`cloneAgent?`/`renameAgent?`\".
 * Both halves are false now: a current real `DaemonClient` implements all
 * three wires, and web's `DaemonAgentClient` requires all three — this
 * port stays optional-per-method only so partial fakes and the no-client
 * case keep rendering truthful unavailable states.
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
 * The fork point `adaptSessionTreeForkClient` forks at: the head entry of
 * the session being forked. `entryIndex` rides along only when the caller
 * knows it, mirroring `DaemonClient.forkAgent`'s own optional
 * `entryIndex` (omitted keys stay off the wire and the daemon applies its
 * own default).
 */
export interface SessionTreeForkEntry {
  readonly entryId: string;
  readonly entryIndex?: number;
}

/**
 * Supplies the head entry for a session about to be forked — e.g. the
 * session route's last known head entry per agent id. Returns `undefined`
 * when nothing is known for `agentId`; the adapted fork then throws a
 * truthful error instead of sending a request the daemon can only reject.
 */
export type SessionTreeHeadEntryResolver = (agentId: string) => SessionTreeForkEntry | undefined;

/**
 * The narrow slice of a real `DaemonClient` the adapter needs — only
 * `forkAgent`, duck-typed so this RN-free module never imports
 * `@picompanion/client`. The `agent` nullability mirrors the wire's own
 * failure shape (`agent.fork.response` carries a null agent on failure):
 * a real `DaemonClient.forkAgent` rejects before resolving that null, but
 * the structural contract admits it so the real class satisfies this
 * interface as-is.
 */
interface SessionTreeForkDaemonClient {
  forkAgent(
    agentId: string,
    options: { entryId: string; entryIndex?: number; name?: string | null },
  ): Promise<{ agent: { id: string; title?: string | null } | null }>;
}

function hasSessionTreeForkAgent(client: unknown): client is SessionTreeForkDaemonClient {
  return !!client && typeof (client as { forkAgent?: unknown }).forkAgent === "function";
}

/**
 * Adapts a real fork-capable client to `SessionTreeClientPort` — the
 * entryId adapter the module doc's shape gap calls for. Follows
 * `apps/web/src/routes/screens/host-session-screen.tsx`'s
 * `adaptEditFromHereForkClient` mapping shape rather than inventing one:
 * a null `name` is sent as absent (the wire takes string-or-absent, never
 * null), and a null-agent resolution rejects with "Fork did not return a
 * new session." instead of mapping. The one Android-specific step is the
 * `entryId` supply: this sheet has no timeline, so `resolveHeadEntry`
 * provides the head entry per agent id and the adapter forwards it (plus
 * its `entryIndex` when known) on every fork call.
 *
 * Returns `undefined` when `client` is absent or implements no
 * `forkAgent` — the disconnected/fork-less case — so callers keep the
 * same "`undefined` means unavailable" contract every
 * `session-route-daemon-clients.ts` resolver already honours. CORRECTED
 * (wire-apps-followup): this previously said "The adapted port exposes fork
 * only (clone stays out of scope: no `cloneAgent` wire message or client
 * method exists)". That was true when written and is false now — use
 * `adaptSessionTreeCloneClient`/`adaptSessionTreeRenameClient` below (or the
 * combined `resolveSessionTreeForkClient` resolver) for the clone/rename
 * halves, which follow this same null-mapping shape.
 */
export function adaptSessionTreeForkClient(
  client: unknown,
  resolveHeadEntry: SessionTreeHeadEntryResolver,
): SessionTreeClientPort | undefined {
  if (!hasSessionTreeForkAgent(client)) {
    return undefined;
  }
  const forkCapableClient = client;
  return {
    async forkAgent(agentId, options) {
      const entry = resolveHeadEntry(agentId);
      if (!entry) {
        throw new Error(`No timeline entry known for session ${agentId} — can't fork it yet.`);
      }
      const { agent } = await forkCapableClient.forkAgent(agentId, {
        entryId: entry.entryId,
        ...(entry.entryIndex !== undefined ? { entryIndex: entry.entryIndex } : {}),
        ...(options?.name != null ? { name: options.name } : {}),
      });
      if (!agent) {
        throw new Error("Fork did not return a new session.");
      }
      return { agentId: agent.id, name: agent.title ?? null };
    },
  };
}

/**
 * The narrow slice of a real `DaemonClient` the clone adapter needs — only
 * `cloneAgent`, duck-typed so this RN-free module never imports
 * `@picompanion/client`. The `agent` nullability mirrors the wire's own
 * failure shape (`agent.clone.response` carries a null agent on failure):
 * a real `DaemonClient.cloneAgent` rejects before resolving that null, but
 * the structural contract admits it so the real class satisfies this
 * interface as-is.
 */
interface SessionTreeCloneDaemonClient {
  cloneAgent(
    agentId: string,
    options: { name?: string },
  ): Promise<{ agent: { id: string; title?: string | null } | null }>;
}

function hasSessionTreeCloneAgent(client: unknown): client is SessionTreeCloneDaemonClient {
  return !!client && typeof (client as { cloneAgent?: unknown }).cloneAgent === "function";
}

/**
 * Adapts a real clone-capable client to `SessionTreeClientPort` — the clone
 * half of `adaptSessionTreeForkClient`'s shape, minus the entryId supply
 * (clone takes only an optional `name`, so no head-entry resolver is
 * needed). A null `name` is sent as absent (the wire takes string-or-absent,
 * never null), and a null-agent resolution rejects with "Clone did not
 * return a new session." instead of mapping — the identical mapping shape
 * the fork adapter applies to its own `name` and `agent`.
 *
 * Returns `undefined` when `client` is absent or implements no `cloneAgent`,
 * matching `adaptSessionTreeForkClient`'s contract.
 */
export function adaptSessionTreeCloneClient(client: unknown): SessionTreeClientPort | undefined {
  if (!hasSessionTreeCloneAgent(client)) {
    return undefined;
  }
  const cloneCapableClient = client;
  return {
    async cloneAgent(agentId, options) {
      const { agent } = await cloneCapableClient.cloneAgent(agentId, {
        ...(options?.name != null ? { name: options.name } : {}),
      });
      if (!agent) {
        throw new Error("Clone did not return a new session.");
      }
      return { agentId: agent.id, name: agent.title ?? null };
    },
  };
}

/**
 * The narrow slice of a real `DaemonClient` the rename adapter needs — only
 * `renameAgent`, duck-typed so this RN-free module never imports
 * `@picompanion/client`. The real method takes the new name as a bare
 * second string (`renameAgent(agentId, name)`), while this port takes it as
 * an options object (`renameAgent(agentId, { name })`) — the adapter maps
 * one onto the other. The `agent` nullability mirrors the wire's own failure
 * shape (`agent.rename.response` carries a null agent on failure).
 */
interface SessionTreeRenameDaemonClient {
  renameAgent(
    agentId: string,
    name: string,
  ): Promise<{ agent: { id: string; title?: string | null } | null }>;
}

function hasSessionTreeRenameAgent(client: unknown): client is SessionTreeRenameDaemonClient {
  return !!client && typeof (client as { renameAgent?: unknown }).renameAgent === "function";
}

/**
 * Adapts a real rename-capable client to `SessionTreeClientPort` — the rename
 * half of the same mapping shape: the port's `{ name }` options object is
 * sent as the real method's bare `name` string, and a null-agent resolution
 * rejects with "Rename did not return a session." instead of mapping.
 * The sheet's `TextField` ("New name", `session-tree-sheet.tsx`) is the UI
 * surface that supplies this name, so rename is wired — not left disabled.
 *
 * Returns `undefined` when `client` is absent or implements no `renameAgent`,
 * matching both adapters above.
 */
export function adaptSessionTreeRenameClient(client: unknown): SessionTreeClientPort | undefined {
  if (!hasSessionTreeRenameAgent(client)) {
    return undefined;
  }
  const renameCapableClient = client;
  return {
    async renameAgent(agentId, options) {
      const { agent } = await renameCapableClient.renameAgent(agentId, options.name);
      if (!agent) {
        throw new Error("Rename did not return a session.");
      }
      return { agentId: agent.id, name: agent.title ?? null };
    },
  };
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
