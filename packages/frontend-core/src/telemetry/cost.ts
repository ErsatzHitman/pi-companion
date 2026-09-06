/**
 * Derive monetary cost per turn and per session — plan.md §8.3, §11.5
 * (T48A1).
 *
 * Pure, framework-neutral derivation only: no daemon RPC, no session
 * wiring, no currency formatting for display. `apps/web`'s telemetry
 * feature (T48A2) is responsible for turning these structured results
 * into announced, mono-tabular-figure UI next to the context meter.
 *
 * Cost is computed independently of the daemon's own `AgentUsage.totalCostUsd`
 * field, because that field is populated inconsistently across providers
 * (some report it, some report `0` when the underlying SDK has no rate for
 * the active model, some never report it at all). Deriving cost client-side
 * from token counts and an explicit rate table means an unpriced model
 * reads as "we don't know", never as "free" — see `deriveTurnCost` below.
 */
import type { AgentUsage } from "@picompanion/protocol/agent-types";

/**
 * USD cost per million tokens for one model (or model-id prefix — see
 * `findModelRate`). This table is data: correcting a stale price, or
 * adding a newly released model, never touches the derivation functions
 * below.
 */
export interface ModelRate {
  /** Exact model id, or an id prefix shared by a dated model family (e.g. `"claude-opus-4"` matches `"claude-opus-4-20250514"`). */
  readonly modelId: string;
  /** Human-readable label for diagnostics/UI; not used for matching. */
  readonly label?: string;
  readonly inputPerMillionUsd: number;
  /**
   * Cached/prompt-cache-read input rate. Omitted when the provider does
   * not distinguish cached pricing from fresh input pricing, in which
   * case cached tokens are priced at `inputPerMillionUsd`.
   */
  readonly cachedInputPerMillionUsd?: number;
  readonly outputPerMillionUsd: number;
}

/**
 * Baseline rate table, correct as of authoring and expected to drift.
 * Ids are matched by exact string or longest-prefix match (see
 * `findModelRate`), so a dated snapshot id such as
 * `"claude-opus-4-5-20260115"` still resolves against the `"claude-opus-4-5"`
 * family entry without a new row per release date.
 */
export const DEFAULT_MODEL_RATES: readonly ModelRate[] = [
  {
    modelId: "claude-opus-4",
    label: "Claude Opus 4 family",
    inputPerMillionUsd: 15,
    cachedInputPerMillionUsd: 1.5,
    outputPerMillionUsd: 75,
  },
  {
    modelId: "claude-sonnet-4",
    label: "Claude Sonnet 4 family",
    inputPerMillionUsd: 3,
    cachedInputPerMillionUsd: 0.3,
    outputPerMillionUsd: 15,
  },
  {
    modelId: "claude-haiku-4",
    label: "Claude Haiku 4 family",
    inputPerMillionUsd: 0.8,
    cachedInputPerMillionUsd: 0.08,
    outputPerMillionUsd: 4,
  },
  {
    modelId: "gpt-5-mini",
    label: "GPT-5 mini family",
    inputPerMillionUsd: 0.25,
    cachedInputPerMillionUsd: 0.025,
    outputPerMillionUsd: 2,
  },
  {
    modelId: "gpt-5",
    label: "GPT-5 family",
    inputPerMillionUsd: 1.25,
    cachedInputPerMillionUsd: 0.125,
    outputPerMillionUsd: 10,
  },
  {
    modelId: "o3",
    label: "o3 reasoning family",
    inputPerMillionUsd: 2,
    cachedInputPerMillionUsd: 0.5,
    outputPerMillionUsd: 8,
  },
  {
    modelId: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro family",
    inputPerMillionUsd: 1.25,
    cachedInputPerMillionUsd: 0.31,
    outputPerMillionUsd: 10,
  },
  {
    modelId: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash family",
    inputPerMillionUsd: 0.3,
    cachedInputPerMillionUsd: 0.075,
    outputPerMillionUsd: 2.5,
  },
];

/** Per-turn cost, or an explicit reason we could not price the turn. */
export type TurnCost =
  | {
      readonly status: "unknown";
      /** `"no-usage"`: the provider has not reported usage for this turn. `"unknown-model"`: usage was reported but no rate table entry matches the active model. */
      readonly reason: "no-usage" | "unknown-model";
    }
  | {
      readonly status: "known";
      /** The rate-table id that matched, not the raw reported model id. */
      readonly modelId: string;
      readonly inputTokens: number;
      readonly cachedInputTokens: number;
      readonly outputTokens: number;
      readonly inputUsd: number;
      readonly cachedInputUsd: number;
      readonly outputUsd: number;
      readonly totalUsd: number;
    };

/** One turn's usage and the model that produced it, as carried on the timeline. */
export interface TurnUsageRecord {
  readonly turnId?: string;
  readonly modelId: string | null | undefined;
  readonly usage: AgentUsage | null | undefined;
}

/** Accumulated cost across every priced turn in a session. */
export interface SessionCost {
  /**
   * `"unknown"`: no turn could be priced yet. `"partial"`: at least one
   * turn priced, at least one could not be — `totalUsd` is a lower bound.
   * `"known"`: every turn considered was priced.
   */
  readonly status: "unknown" | "partial" | "known";
  readonly totalUsd: number;
  readonly pricedTurns: number;
  readonly unknownTurns: number;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Resolve a rate-table entry for a reported model id.
 *
 * Matching is exact-id-first, then longest-prefix, so a dated snapshot id
 * resolves against its family entry without the table growing a row per
 * release. Returns `undefined` (never a fabricated rate) when nothing in
 * the table applies.
 */
export function findModelRate(
  modelId: string | null | undefined,
  rateTable: readonly ModelRate[] = DEFAULT_MODEL_RATES,
): ModelRate | undefined {
  if (!modelId) {
    return undefined;
  }
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  let best: ModelRate | undefined;
  for (const entry of rateTable) {
    const key = entry.modelId.trim().toLowerCase();
    if (!key) {
      continue;
    }
    if (normalized === key || normalized.startsWith(key)) {
      if (!best || key.length > best.modelId.trim().length) {
        best = entry;
      }
    }
  }
  return best;
}

/**
 * Derive one turn's monetary cost from its `AgentUsage` and the model that
 * produced it.
 *
 * Cached and fresh input tokens are priced separately whenever the rate
 * table gives the model a distinct cache rate; otherwise cached tokens
 * fall back to the fresh input rate. An unpriced model, or a turn with no
 * usage at all, yields an explicit `"unknown"` result — never a `0` that
 * would read as "this turn was free".
 */
export function deriveTurnCost(
  usage: AgentUsage | null | undefined,
  modelId: string | null | undefined,
  rateTable: readonly ModelRate[] = DEFAULT_MODEL_RATES,
): TurnCost {
  if (!usage) {
    return { status: "unknown", reason: "no-usage" };
  }

  const rate = findModelRate(modelId, rateTable);
  if (!rate) {
    return { status: "unknown", reason: "unknown-model" };
  }

  const inputTokens = isFiniteNonNegative(usage.inputTokens) ? usage.inputTokens : 0;
  const cachedInputTokens = isFiniteNonNegative(usage.cachedInputTokens)
    ? usage.cachedInputTokens
    : 0;
  const outputTokens = isFiniteNonNegative(usage.outputTokens) ? usage.outputTokens : 0;

  const cachedRatePerMillion = rate.cachedInputPerMillionUsd ?? rate.inputPerMillionUsd;
  const inputUsd = (inputTokens / 1_000_000) * rate.inputPerMillionUsd;
  const cachedInputUsd = (cachedInputTokens / 1_000_000) * cachedRatePerMillion;
  const outputUsd = (outputTokens / 1_000_000) * rate.outputPerMillionUsd;

  return {
    status: "known",
    modelId: rate.modelId,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    inputUsd,
    cachedInputUsd,
    outputUsd,
    totalUsd: inputUsd + cachedInputUsd + outputUsd,
  };
}

/** Accumulate already-derived per-turn costs into a session total. */
export function accumulateSessionCost(turnCosts: readonly TurnCost[]): SessionCost {
  let totalUsd = 0;
  let pricedTurns = 0;
  let unknownTurns = 0;

  for (const turn of turnCosts) {
    if (turn.status === "known") {
      totalUsd += turn.totalUsd;
      pricedTurns += 1;
    } else {
      unknownTurns += 1;
    }
  }

  const status: SessionCost["status"] =
    pricedTurns === 0 ? "unknown" : unknownTurns > 0 ? "partial" : "known";

  return { status, totalUsd, pricedTurns, unknownTurns };
}

/**
 * Derive and accumulate session cost directly from per-turn usage/model
 * records in one pass — a convenience wrapper over `deriveTurnCost` +
 * `accumulateSessionCost` for callers that don't need the intermediate
 * per-turn results.
 */
export function deriveSessionCost(
  records: readonly TurnUsageRecord[],
  rateTable: readonly ModelRate[] = DEFAULT_MODEL_RATES,
): SessionCost {
  return accumulateSessionCost(
    records.map((record) => deriveTurnCost(record.usage, record.modelId, rateTable)),
  );
}
