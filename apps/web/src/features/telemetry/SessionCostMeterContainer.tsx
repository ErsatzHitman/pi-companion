import { useEffect, useMemo } from "react";

import { attachSessionCostStore } from "./daemon-session-cost-client.js";
import type { DaemonSessionCostClient } from "./daemon-session-cost-client.js";
import { SessionCostMeter } from "./session-cost-meter.js";
import { SessionCostStore } from "./session-cost-store.js";
import { useSessionCost } from "./use-session-cost.js";

export interface SessionCostMeterContainerProps {
  /** Session this meter accumulates cost for. */
  agentId: string;
  /**
   * Live daemon adapter (T48A2). `routes/screens/host-session-screen.tsx`
   * passes its raw `DaemonClient` here (via `Composer`'s
   * `sessionCostClient` prop, UI-W11) whenever a connection exists; a
   * real `DaemonClient` satisfies `DaemonSessionCostClient` as-is —
   * `daemon-session-cost-client.ts`'s own doc and tests prove the real
   * wire round trip. `undefined` with no live connection: the meter then
   * renders `SessionCostStore`'s initial "unknown" state — honest, never
   * a fabricated `$0.00`.
   */
  client?: DaemonSessionCostClient;
  testId?: string;
}

/**
 * Wires a per-session `SessionCostStore` to a live `client` (when given)
 * and renders `SessionCostMeter` from it (plan.md §8.3, §11.5; T48A2).
 *
 * Mounted as a sibling of `ContextMeter` inside the composer's own
 * context-ring sheet (`features/composer/Composer.tsx`, UI-W11) — not in
 * `PiExtensionRail`/`Shell`'s `extensionRail` slot: the reference Live
 * pane (`docs/ui-reference/pi-companion-web.html` `.live` region) carries
 * no Context/Cache/Cost block at all, so that telemetry lives in the ring
 * instead (`root-route.tsx`'s own module doc explains the move). This
 * component still only needs `agentId` and, once one exists, a live
 * `DaemonSessionCostClient` — it reads no props of whatever mounts it.
 *
 * A fresh `SessionCostStore` is created per `agentId` (not reused across
 * a session switch), so cost never leaks from one session into another.
 */
export function SessionCostMeterContainer({
  agentId,
  client,
  testId,
}: SessionCostMeterContainerProps) {
  const store = useMemo(() => new SessionCostStore(), [agentId]);

  useEffect(() => {
    if (!client) return undefined;
    return attachSessionCostStore(client, agentId, store);
  }, [client, agentId, store]);

  const sessionCost = useSessionCost(store);

  return <SessionCostMeter sessionCost={sessionCost} testId={testId} />;
}

export default SessionCostMeterContainer;
