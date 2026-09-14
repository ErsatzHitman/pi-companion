import { useEffect, useState } from "react";

import type { AgentTurnClient } from "./agent-turn-client.js";

/**
 * Whether this agent genuinely has a turn in progress right now
 * (FIX-L2, the composer's Stop-button idle-defect fix).
 *
 * A live-browser audit found `Composer`'s Stop control rendered and
 * *enabled* on an idle session — no turn running, several turns already
 * completed — which `Composer.test.tsx` already asserted was wrong
 * ("no Stop control ... when idle"). Tracing `showAbort = canAbort ||
 * isAborting` (`Composer.tsx`) back to `canAbort`'s definition
 * (`use-composer.ts`) found the actual defect: `canAbort` was
 * `Boolean(client) && !isAborting` — true for the *entire lifetime* of
 * any live daemon connection, regardless of whether a turn was ever
 * running, because nothing in that chain ever read the agent's own
 * turn state. Every unit test that reproduced "idle" did so by omitting
 * `client` altogether, which is not what an idle *connected* session
 * looks like — that gap is exactly why the bug shipped past the
 * existing test suite.
 *
 * `canAbort` itself (`use-composer.ts`) is left as-is: it answers "would
 * pressing Stop attempt a real `cancelAgent` call" (a wired, non-aborting
 * client — the daemon, not this hook, is what actually rejects a cancel
 * with nothing to cancel, per `AgentTurnClient.cancelAgent`'s own doc
 * comment), which is still correct and is exercised directly by
 * `use-composer.test.ts`. This hook answers the separate question
 * `Composer.tsx` also needs before it decides to *render* Stop at all:
 * is there really something to abort right now. `AgentTurnClient`'s
 * `getAgentTurnStatus`/`onAgentTurnStatusChange` (optional, independent
 * of the model/thinking method group `useModelThinking` requires) are
 * the real signal, sourced from the daemon's own
 * `AgentSnapshotPayload.status` (`packages/protocol/src/messages.ts`).
 *
 * Mirrors `useComposer`'s own `onQueueUpdate` subscription shape: reset
 * to the safe "no active turn" default on every agent/client identity
 * change, fetch once, then live-subscribe. A client that omits either
 * method (or is altogether unset) simply stays at that safe default —
 * hiding Stop rather than ever showing it on a signal that does not
 * exist, which is the direction this defect requires.
 */
export interface UseAgentTurnStatusOptions {
  sessionId: string;
  client?: AgentTurnClient;
}

export interface AgentTurnStatusState {
  /** `true` only once the daemon has actually reported a turn in progress. */
  hasActiveTurn: boolean;
}

export function useAgentTurnStatus({
  sessionId,
  client,
}: UseAgentTurnStatusOptions): AgentTurnStatusState {
  const [hasActiveTurn, setHasActiveTurn] = useState(false);

  useEffect(() => {
    setHasActiveTurn(false);
    if (!client) return;

    let cancelled = false;
    if (client.getAgentTurnStatus) {
      client
        .getAgentTurnStatus(sessionId)
        .then((status) => {
          if (!cancelled && status) setHasActiveTurn(status.hasActiveTurn);
        })
        .catch(() => {
          // Best-effort: an unreadable status stays at the safe "no
          // active turn" default rather than surfacing a new error
          // surface for a control that is otherwise silent when idle.
        });
    }

    const unsubscribe = client.onAgentTurnStatusChange?.(sessionId, (status) => {
      if (!cancelled) setHasActiveTurn(status.hasActiveTurn);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [client, sessionId]);

  return { hasActiveTurn };
}
