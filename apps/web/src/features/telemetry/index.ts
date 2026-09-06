/**
 * Telemetry feature — session cost alongside the context meter (T48A2,
 * plan.md §8.3, §11.5).
 *
 * Owns the *live* half `@picompanion/frontend-core`'s `telemetry/cost.ts`
 * (T48A1) deliberately leaves out: turning per-session `agent_update`
 * pushes into a running `SessionCost` (`SessionCostStore`,
 * `daemon-session-cost-client.ts`) and rendering it (`SessionCostMeter`,
 * `SessionCostMeterContainer`) next to `features/rail/context-meter.tsx`'s
 * `ContextMeter`.
 */
export { attachSessionCostStore } from "./daemon-session-cost-client.js";
export type {
  DaemonAgentUpdateCostMessage,
  DaemonFetchAgentCostResult,
  DaemonSessionCostAgentFields,
  DaemonSessionCostClient,
} from "./daemon-session-cost-client.js";
export { SessionCostMeter } from "./session-cost-meter.js";
export type { SessionCostMeterProps } from "./session-cost-meter.js";
export { SessionCostMeterContainer } from "./SessionCostMeterContainer.js";
export type { SessionCostMeterContainerProps } from "./SessionCostMeterContainer.js";
export { SessionCostStore } from "./session-cost-store.js";
export type { SessionCostListener } from "./session-cost-store.js";
export { useSessionCost } from "./use-session-cost.js";
