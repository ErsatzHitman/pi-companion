/**
 * Telemetry domain types — plan.md §8.3, §11.5, §14 (T29C1).
 *
 * These describe context-window usage and cache-hit share derived from a
 * daemon `AgentUsage` payload (`@picompanion/protocol/agent-types`). Every
 * provider populates a different subset of `AgentUsage`'s optional fields,
 * so both shapes here are explicit unknown/known unions rather than
 * numbers defaulted to zero: a provider that has not reported context-
 * window or cache fields yet (or ever) must read as "we don't know", not
 * as "0% used" or "0% cache hit".
 */

/** Context-window usage derived from `contextWindowUsedTokens`/`contextWindowMaxTokens`. */
export type ContextWindowUsage =
  | { readonly status: "unknown" }
  | {
      readonly status: "known";
      /** Raw tokens used so far this turn, as reported by the provider. */
      readonly usedTokens: number;
      /** Raw context-window ceiling, as reported by the provider/model. */
      readonly maxTokens: number;
      /** `usedTokens / maxTokens`, clamped to `[0, 1]` for meter rendering. */
      readonly usedFraction: number;
    };

/** Cache-hit share derived from `cachedInputTokens`/`inputTokens`. */
export type CacheShare =
  | { readonly status: "unknown" }
  | {
      readonly status: "known";
      /** Input tokens served from provider cache. */
      readonly cachedTokens: number;
      /** Input tokens that were not cache hits. */
      readonly freshTokens: number;
      /** `cachedTokens / (cachedTokens + freshTokens)`, in `[0, 1]`. */
      readonly cacheHitFraction: number;
      /** `cacheHitFraction` rounded to the nearest whole percent (`0`-`100`). */
      readonly cacheHitPercent: number;
    };

/** Combined per-turn telemetry snapshot for one agent. */
export interface ContextWindowTelemetry {
  readonly contextWindow: ContextWindowUsage;
  readonly cacheShare: CacheShare;
}
