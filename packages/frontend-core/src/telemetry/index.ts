/**
 * Telemetry domain — plan.md §8.3, §11.5 (T29C1, T48A1).
 *
 * Owns context-window usage and cache-hit share derivation, and turn/
 * session monetary cost derivation, from the protocol's `AgentUsage`
 * token fields. Framework-neutral: no daemon RPC, no session/rail wiring
 * (that lands with T29C2 and T48A2 in `apps/web`).
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */
export {
  deriveCacheShare,
  deriveContextWindowTelemetry,
  deriveContextWindowUsage,
} from "./derive.js";
export type { CacheShare, ContextWindowTelemetry, ContextWindowUsage } from "./types.js";
export {
  accumulateSessionCost,
  DEFAULT_MODEL_RATES,
  deriveSessionCost,
  deriveTurnCost,
  findModelRate,
} from "./cost.js";
export type { ModelRate, SessionCost, TurnCost, TurnUsageRecord } from "./cost.js";
