/**
 * The session app bar's working-directory read (T351).
 *
 * The bar's mono subtitle is the session's cwd basename, and the only
 * place that value exists is the daemon's own agent snapshot — the
 * `cwd` field on `AgentSnapshotPayloadSchema`
 * (`packages/protocol/src/messages.ts`), which `DaemonClient.fetchAgent`
 * resolves. Nothing on Android read it before this task, so the bar
 * would have had nothing to draw.
 *
 * This is a hook rather than a controller because the whole job is one
 * request per (client, agent) pair with a cancellation flag: there is no
 * state machine worth the `*-model.ts` split the rest of this feature
 * uses, and inventing one would mean a second module whose only caller
 * is this file. What IS worth splitting out is the string work, and that
 * already lives in `./header-model.ts`'s `deriveCwdBasename`, which is
 * unit-tested against real paths from both kinds of host.
 *
 * `AgentSnapshotSource` is the narrow structural port, the same
 * convention `../composer/model-thinking-model.ts`'s own
 * `DaemonModelThinkingSource` uses for the same `fetchAgent` call: a
 * real `DaemonClient` satisfies it as-is, and
 * `../../app-shell/session-route-daemon-clients.ts`'s
 * `resolveAgentSnapshotClient` is what narrows the live one to it.
 * `fetchAgent` is optional on the port so a partially-built fake — and
 * an older daemon whose client lacks it — is a no-op rather than a
 * crash, matching that sibling port exactly.
 *
 * A daemon that reports no such agent (`null`), an agent whose snapshot
 * carries no `cwd`, or a rejected request all leave the value
 * `undefined`, and the bar then draws no subtitle. That is the honest
 * outcome: a session whose directory is unknown must not be labelled
 * with a guess.
 */
import { useEffect, useState } from "react";

/** The slice of the agent snapshot this hook reads; a real `fetchAgent` response carries far more. */
export interface AgentSnapshotSource {
  fetchAgent?(agentId: string): Promise<{ agent: { cwd?: string } } | null>;
}

export function useAgentCwd(
  client: AgentSnapshotSource | undefined,
  agentId: string,
): string | undefined {
  const [cwd, setCwd] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!client?.fetchAgent || agentId.length === 0) {
      return;
    }
    let cancelled = false;
    void client
      .fetchAgent(agentId)
      .then((result) => {
        if (cancelled) return;
        setCwd(result?.agent.cwd);
      })
      .catch(() => {
        // A failed snapshot request is not worth a visible error on the
        // app bar: the transcript below it already reports connection
        // trouble through the status pill, and a second, quieter signal
        // saying the same thing in a different vocabulary would only
        // compete with it. The subtitle stays absent.
        if (cancelled) return;
        setCwd(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [client, agentId]);

  return cwd;
}
