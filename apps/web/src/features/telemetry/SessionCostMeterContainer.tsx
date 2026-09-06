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
   * Live daemon adapter (T48A2). Defaults to `undefined`: this app has
   * no route that can obtain a live `DaemonClient` yet — the same
   * "no live client yet" state `ComposerContainer`
   * (`features/composer/ComposerContainer.tsx`) already documents. Once
   * a route can obtain one, a real `DaemonClient` satisfies
   * `DaemonSessionCostClient` as-is; `daemon-session-cost-client.ts`'s
   * own doc and tests already prove the real wire round trip today,
   * independent of when this prop gets wired. Without one, the meter
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
 * Ready to mount as a sibling of `ContextMeter` inside
 * `PiExtensionRail`/`Shell`'s `extensionRail` slot — this component only
 * needs `agentId` and, once one exists, a live `DaemonSessionCostClient`;
 * it does not read `PiExtensionRail`'s own props, so adding
 * `<SessionCostMeterContainer agentId={agentId} client={...} />` next to
 * `<ContextMeter telemetry={...} />` there is the entire integration
 * step for whichever task wires the real session route (`features/rail/`
 * is a different task's owned directory — see this feature's module
 * docs for why that wiring is deliberately left to that task, the same
 * way `ContextMeter`/`PiExtensionRail` themselves left their own live
 * wiring to a later task).
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
