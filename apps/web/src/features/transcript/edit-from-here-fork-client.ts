import type { DaemonClient } from "@picompanion/client";

import type { EditFromHereForkClient } from "./use-edit-from-here.js";

/**
 * Adapts a real `DaemonClient` (`@picompanion/client`) to this feature's own
 * narrow `EditFromHereForkClient` (T105, plan.md §11.1). `DaemonClient`'s
 * `forkAgent` (`packages/client/src/daemon-client.ts`) is a required,
 * non-optional method on every real instance, so the only thing this adapter
 * guards on is the connection itself: `client` is `null` exactly while
 * disconnected, and `EditFromHereSurface`'s own "Gating decision (T114)" doc
 * comment explains why that is the one case this surface disables its
 * "Edit from here" affordance for rather than hiding it.
 *
 * Moved here from `routes/screens/host-session-screen.tsx` (WEB-ARCH-1):
 * that route now only imports and calls this function, rather than also
 * defining it.
 */
export function adaptEditFromHereForkClient(
  client: DaemonClient | null,
): EditFromHereForkClient | undefined {
  if (!client) {
    return undefined;
  }
  return {
    async forkAgent(sessionId, options) {
      // The real wire's `name` is `string`-optional; a `null` name from the
      // narrow hook interface is sent as absent, never as a literal null.
      const { agent } = await client.forkAgent(sessionId, {
        entryId: options.entryId,
        entryIndex: options.entryIndex,
        ...(options.name != null ? { name: options.name } : {}),
      });
      if (!agent) {
        throw new Error("Fork did not return a new session.");
      }
      return { agentId: agent.id };
    },
  };
}
