/**
 * Builds T38A1a `SessionTreeNode`s for `SessionsScreen` (T38A3, plan.md
 * §7.1/§11.1) from the flat `SessionSummary` list this app already
 * fetches, plus a small client-tracked map of fork/clone relationships
 * established via `useForkCloneSession` during this run.
 *
 * ## Disclosed gap: pre-existing lineage is invisible to this module
 *
 * The daemon's `fetch_agents_response`/`AgentSnapshotPayload`
 * (`packages/protocol/src/messages.ts`) carries no parent/fork/clone
 * field today — verified: neither schema declares one. So a session
 * that already existed before this screen mounted, or that was
 * forked/cloned from a different client entirely, always renders here
 * as its own root: this module has no way to learn it was ever related
 * to another session. Only a fork/clone performed *through this
 * `SessionsScreen`* (recorded into the `relationships` map passed in
 * here at the moment it resolves) is placed correctly under its parent
 * or source. Backfilling real lineage from the daemon is new protocol +
 * server + core work (the same seam `daemon-sessions-client.ts`'s
 * module doc discloses for the fork/clone RPC itself), not this
 * directory's to add.
 */
import { sessions as coreSessions } from "@picompanion/frontend-core";

import type { SessionSummary } from "./types.js";

export type SessionRelationship =
  | { kind: "fork"; parentId: string; forkPoint: { messageId: string; index: number } }
  | { kind: "clone"; sourceId: string };

function toCreatedAt(session: SessionSummary): number {
  const parsed = Date.parse(session.updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Builds one `SessionTreeNode` per `sessions` entry, honoring
 * `relationships` where one is recorded and falling back to a plain
 * root otherwise (including when a relationship points at a
 * parent/source id no longer present in `sessions` — e.g. it was
 * deleted — so a dangling reference degrades to "its own root" instead
 * of throwing). A `visiting` guard breaks any cycle a malformed
 * `relationships` map might otherwise introduce, even though nothing in
 * this feature can construct one by the normal fork/clone flow.
 */
export function buildSessionTree(
  sessions: readonly SessionSummary[],
  relationships: ReadonlyMap<string, SessionRelationship>,
): coreSessions.SessionTreeNode[] {
  const byId = new Map(sessions.map((session) => [session.id, session] as const));
  const cache = new Map<string, coreSessions.SessionTreeNode>();
  const visiting = new Set<string>();

  function nodeFor(id: string): coreSessions.SessionTreeNode | null {
    const cached = cache.get(id);
    if (cached) return cached;

    const session = byId.get(id);
    if (!session) return null;

    if (visiting.has(id)) return null; // cycle guard: never recurse back into an in-progress build
    visiting.add(id);

    const relationship = relationships.get(id);
    let node: coreSessions.SessionTreeNode;

    if (relationship?.kind === "fork") {
      const parent = nodeFor(relationship.parentId);
      node = parent
        ? coreSessions.forkSession(parent, {
            agentId: session.id,
            name: session.title,
            forkPoint: relationship.forkPoint,
            createdAt: toCreatedAt(session),
          })
        : coreSessions.createRootSession({
            agentId: session.id,
            name: session.title,
            createdAt: toCreatedAt(session),
          });
    } else if (relationship?.kind === "clone") {
      const source = nodeFor(relationship.sourceId);
      node = source
        ? coreSessions.cloneSession(source, {
            agentId: session.id,
            name: session.title,
            createdAt: toCreatedAt(session),
          })
        : coreSessions.createRootSession({
            agentId: session.id,
            name: session.title,
            createdAt: toCreatedAt(session),
          });
    } else {
      node = coreSessions.createRootSession({
        agentId: session.id,
        name: session.title,
        createdAt: toCreatedAt(session),
      });
    }

    visiting.delete(id);
    cache.set(id, node);
    return node;
  }

  const nodes: coreSessions.SessionTreeNode[] = [];
  for (const session of sessions) {
    const node = nodeFor(session.id);
    if (node) nodes.push(node);
  }
  return nodes;
}
