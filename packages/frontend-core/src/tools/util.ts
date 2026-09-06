/**
 * Small internal helpers shared by the tool-call view-model builders. Kept
 * deliberately defensive: every function here is safe to call on arbitrary
 * `unknown` input and never throws.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Deep-clones a value through JSON so downstream consumers can never
 * mutate daemon state, and so non-JSON-safe values (functions, symbols,
 * circular refs) degrade to a safe placeholder instead of throwing. */
export function safeJsonClone(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return "[unserializable value]";
  }
}

export interface TimingInputs {
  observedAt?: number;
  previous?: {
    readonly startedAt?: number;
    readonly updatedAt?: number;
    readonly durationMs?: number;
    readonly updateCount: number;
  };
}

export interface TimingFields {
  startedAt?: number;
  updatedAt?: number;
  durationMs?: number;
  updateCount: number;
}

/** Derives the shared timing/identity-continuity fields
 * (`startedAt`/`updatedAt`/`durationMs`/`updateCount`) for one view-model
 * build, given the previous build for the same `callId` (if any). This is
 * what keeps "streaming updates" attached to their call: `startedAt` and
 * `updateCount` carry forward across rebuilds instead of resetting. */
export function timingFields(options: TimingInputs): TimingFields {
  const previous = options.previous;
  const startedAt = previous?.startedAt ?? options.observedAt;
  const updatedAt = options.observedAt ?? previous?.updatedAt;
  const durationMs =
    startedAt !== undefined && updatedAt !== undefined
      ? updatedAt - startedAt
      : previous?.durationMs;
  const updateCount = (previous?.updateCount ?? 0) + 1;
  return {
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    updateCount,
  };
}
