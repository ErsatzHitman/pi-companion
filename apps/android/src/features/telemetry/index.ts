/**
 * `features/telemetry` barrel (T352) — Android's context-window readout.
 *
 * The derivation itself belongs to `@picompanion/frontend-core`'s
 * `telemetry` module and is shared with `apps/web`; what lives here is
 * the Android-side subscription that supplies it with live numbers and
 * the formatting its screens draw. See each module's own doc comment.
 */
export {
  CONTEXT_CRITICAL_FRACTION,
  CONTEXT_WARNING_FRACTION,
  buildContextCardViewModel,
  contextUsageBand,
  formatTokenCount,
  formatUsagePercent,
} from "./context-usage-model";
export type {
  ContextCardInput,
  ContextCardViewModel,
  ContextUsageBand,
} from "./context-usage-model";

export { createContextUsageSignal } from "./context-usage-signal";
export type {
  AgentUpdateUsageMessage,
  ContextUsageAgentFields,
  ContextUsageSignal,
  DaemonAgentUsageSource,
} from "./context-usage-signal";
