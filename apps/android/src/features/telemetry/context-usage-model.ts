/**
 * Context-window usage, formatted for Android's own screens (T352).
 *
 * `@picompanion/frontend-core`'s `telemetry` module (T29C1) already
 * derives the numbers — `deriveContextWindowUsage` turns a raw
 * `AgentUsage` into a known/unknown union, `deriveCacheShare` into a
 * cache-hit share, `deriveSessionCost` into money — and deliberately
 * owns no formatting, because a percentage reads differently in a
 * browser rail and in a 412dp phone card. This module is Android's
 * half: the strings, the colour band, and the single view model the
 * Live screen's Context card and (later) the composer's context ring
 * both read, so the two can never disagree about what "41.2%" means.
 *
 * Nothing here imports React Native, so all of it is proven by
 * execution rather than by a source-regex pin — the split this app's
 * `CLAUDE.md` documents and every `*-model.ts` beside it follows.
 *
 * **Unknown is a real state and is rendered as one.** A provider that
 * has not reported both context fields yet gives `{ status: "unknown" }`,
 * and this module says so in words rather than showing `0%` — a fresh
 * session and a session that has used none of its window look identical
 * at zero, and only one of those two is true.
 */
import { telemetry } from "@picompanion/frontend-core";
import type { AgentUsage } from "@picompanion/protocol/agent-types";

/** The band a usage fraction falls in, which is what decides the readout's colour. */
export type ContextUsageBand = "normal" | "warning" | "critical";

/**
 * The design artifact's two thresholds: orange above 70%, red above 90%.
 * Exported so the ring and the card cannot drift into two different
 * ideas of "nearly full".
 */
export const CONTEXT_WARNING_FRACTION = 0.7;
export const CONTEXT_CRITICAL_FRACTION = 0.9;

export function contextUsageBand(usedFraction: number): ContextUsageBand {
  if (usedFraction > CONTEXT_CRITICAL_FRACTION) return "critical";
  if (usedFraction > CONTEXT_WARNING_FRACTION) return "warning";
  return "normal";
}

/**
 * The artifact's `fmtTok`: millions as `1.2M`, thousands as `84.0k`,
 * anything smaller verbatim.
 *
 * Rounds toward zero at one decimal rather than to nearest, so a
 * readout never claims a round number the session has not reached —
 * `999_999` is `999.9k`, never `1.0M`. Negative and non-finite inputs
 * cannot come from a validated `AgentUsage`, but a provider is free to
 * send nonsense and this must not render `NaN`, so both fall back to
 * `"0"`.
 */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return "0";
  if (tokens >= 1_000_000) return `${(Math.floor(tokens / 100_000) / 10).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(Math.floor(tokens / 100) / 10).toFixed(1)}k`;
  return String(Math.floor(tokens));
}

/** `0.412` → `"41.2%"`. One decimal, the artifact's own precision. */
export function formatUsagePercent(usedFraction: number): string {
  return `${(Math.round(usedFraction * 1000) / 10).toFixed(1)}%`;
}

export interface ContextCardInput {
  usage: AgentUsage | null | undefined;
  /**
   * Whether the daemon has auto-compaction on for this agent, when that
   * is known. `undefined` means nobody has asked yet — the summary then
   * omits the clause entirely rather than guessing "off", because the
   * two states differ by whether a long session survives.
   */
  autoCompaction?: boolean;
}

export interface ContextCardViewModel {
  title: string;
  /** e.g. `"41.2% of 200.0k · auto-compaction on"`, or the unknown sentence. */
  summary: string;
  /** `null` when usage is unknown, so a meter can render an empty track rather than a full one. */
  fraction: number | null;
  band: ContextUsageBand;
  /**
   * The artifact's mono stats line — `"↑12.4k ↓3.1k R84k W12k CH92.4% $0.312"`
   * in its mock. Only the fields the provider actually reported appear,
   * so an empty string means the provider reported nothing countable
   * and the card draws no stats row at all.
   */
  statsText: string;
  accessibilityLabel: string;
}

const UNKNOWN_SUMMARY = "The provider has not reported this session's context window yet";

/**
 * Everything the Context card draws, from one `AgentUsage`.
 *
 * The stats line is assembled from whichever fields are present rather
 * than from a fixed template with zeros for the rest: a provider that
 * bills no cache and reports no cost should show neither, not `CH0.0%
 * $0.000`, which reads as a measured zero.
 */
export function buildContextCardViewModel({
  usage,
  autoCompaction,
}: ContextCardInput): ContextCardViewModel {
  const window = telemetry.deriveContextWindowUsage(usage);
  const cache = telemetry.deriveCacheShare(usage);
  const compaction =
    autoCompaction === undefined ? "" : ` · auto-compaction ${autoCompaction ? "on" : "off"}`;

  const stats: string[] = [];
  if (typeof usage?.inputTokens === "number" && Number.isFinite(usage.inputTokens)) {
    stats.push(`↑${formatTokenCount(usage.inputTokens)}`);
  }
  if (typeof usage?.outputTokens === "number" && Number.isFinite(usage.outputTokens)) {
    stats.push(`↓${formatTokenCount(usage.outputTokens)}`);
  }
  if (cache.status === "known") {
    stats.push(`CH${(Math.round(cache.cacheHitFraction * 1000) / 10).toFixed(1)}%`);
  }
  if (typeof usage?.totalCostUsd === "number" && Number.isFinite(usage.totalCostUsd)) {
    stats.push(`$${usage.totalCostUsd.toFixed(3)}`);
  }
  const statsText = stats.join(" ");

  if (window.status !== "known") {
    return {
      title: "Context",
      summary: `${UNKNOWN_SUMMARY}${compaction}`,
      fraction: null,
      band: "normal",
      statsText,
      accessibilityLabel: `Context. ${UNKNOWN_SUMMARY}.`,
    };
  }

  const percent = formatUsagePercent(window.usedFraction);
  const ceiling = formatTokenCount(window.maxTokens);
  const summary = `${percent} of ${ceiling}${compaction}`;

  return {
    title: "Context",
    summary,
    fraction: window.usedFraction,
    band: contextUsageBand(window.usedFraction),
    statsText,
    // The percentage is spoken as words, so the colour band never has to
    // be seen for the state to be understood (plan.md §10.5).
    accessibilityLabel: `Context. ${percent} of ${ceiling} tokens used.`,
  };
}
