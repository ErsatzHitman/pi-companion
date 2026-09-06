/**
 * Derive context-window and cache telemetry from `AgentUsage` — plan.md
 * §8.3, §11.5 (T29C1).
 *
 * Pure, framework-neutral derivation only: no daemon RPC, no session
 * wiring, no formatting for display. `apps/web`'s rail (T29C2) is
 * responsible for turning these structured results into announced,
 * mono-tabular-figure UI.
 */
import type { AgentUsage } from "@picompanion/protocol/agent-types";

import type { CacheShare, ContextWindowTelemetry, ContextWindowUsage } from "./types.js";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * `contextWindowUsedTokens` / `contextWindowMaxTokens` -> `ContextWindowUsage`.
 *
 * Unknown (not zero) whenever the provider has not reported *both*
 * fields yet, or reports a non-positive ceiling that cannot back a
 * fraction.
 */
export function deriveContextWindowUsage(usage: AgentUsage | null | undefined): ContextWindowUsage {
  const usedTokens = usage?.contextWindowUsedTokens;
  const maxTokens = usage?.contextWindowMaxTokens;

  if (!isFiniteNumber(usedTokens) || !isFiniteNumber(maxTokens) || maxTokens <= 0) {
    return { status: "unknown" };
  }

  return {
    status: "known",
    usedTokens,
    maxTokens,
    usedFraction: clamp01(usedTokens / maxTokens),
  };
}

/**
 * `cachedInputTokens` / `inputTokens` -> `CacheShare`.
 *
 * Unknown (not zero) whenever the provider has not reported *both*
 * fields yet, or the two are both zero (no input tokens billed at all,
 * so there is nothing yet to derive a hit share from).
 */
export function deriveCacheShare(usage: AgentUsage | null | undefined): CacheShare {
  const cachedTokens = usage?.cachedInputTokens;
  const inputTokens = usage?.inputTokens;

  if (!isFiniteNumber(cachedTokens) || !isFiniteNumber(inputTokens)) {
    return { status: "unknown" };
  }
  if (cachedTokens < 0 || inputTokens < 0) {
    return { status: "unknown" };
  }

  // `inputTokens` reported by providers is the *fresh* (non-cached) share;
  // total input tokens billed is cached + fresh.
  const denominator = cachedTokens + inputTokens;
  if (denominator <= 0) {
    return { status: "unknown" };
  }

  const cacheHitFraction = clamp01(cachedTokens / denominator);
  return {
    status: "known",
    cachedTokens,
    freshTokens: inputTokens,
    cacheHitFraction,
    cacheHitPercent: Math.round(cacheHitFraction * 100),
  };
}

/** Combined per-turn snapshot: both derivations from one `AgentUsage`. */
export function deriveContextWindowTelemetry(
  usage: AgentUsage | null | undefined,
): ContextWindowTelemetry {
  return {
    contextWindow: deriveContextWindowUsage(usage),
    cacheShare: deriveCacheShare(usage),
  };
}
