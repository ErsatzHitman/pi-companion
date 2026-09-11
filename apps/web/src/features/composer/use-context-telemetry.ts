import { useEffect, useState } from "react";

import type { DaemonClient } from "@picompanion/client";
import { telemetry as coreTelemetry } from "@picompanion/frontend-core";
import type { AgentUsage } from "@picompanion/protocol/agent-types";

/**
 * This session's live context-window/cache telemetry, derived exactly the
 * way the right rail does it: subscribe to the daemon's `agent_update`
 * upserts for this agent, keep the newest `agent.lastUsage`, and run it
 * through `@picompanion/frontend-core`'s
 * `telemetry.deriveContextWindowTelemetry` (T29C1).
 *
 * `routes/root-route.tsx` performs the identical subscription for its
 * `ContextMeter`; this hook is duplicated rather than shared because the
 * two live in different owned directories and neither may import the
 * other's internals (`apps/web/src/features/rail/` renders the meter,
 * `routes/root-route.tsx` wires it). It is the same derivation, from the
 * same wire field, so the composer's ring and the rail's meter cannot
 * disagree about the numbers — only about who subscribes.
 *
 * Resets to `undefined` (→ `{ contextWindow: { status: "unknown" } }`)
 * whenever the connection or session identity changes, so a switched
 * session never shows the previous one's percentage.
 */
export function useSessionContextTelemetry(
  client: DaemonClient | null,
  agentId: string,
): coreTelemetry.ContextWindowTelemetry {
  const [usage, setUsage] = useState<AgentUsage | undefined>(undefined);

  useEffect(() => {
    setUsage(undefined);
    if (!client) return undefined;
    return client.on("agent_update", (message) => {
      if (message.payload.kind !== "upsert") return;
      if (message.payload.agent.id !== agentId) return;
      setUsage(message.payload.agent.lastUsage);
    });
  }, [client, agentId]);

  return coreTelemetry.deriveContextWindowTelemetry(usage);
}

export default useSessionContextTelemetry;
