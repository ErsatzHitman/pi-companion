/**
 * Deterministic Pi UI revision rules (plan.md §4.2, "Bridge state correctness").
 *
 * The plan states them exactly once, so they live here exactly once:
 *
 * - discard a delta at or below the current revision (stale);
 * - apply only `current + 1`;
 * - request a full state when a delta jumps ahead (gap);
 * - accept a full state only when its revision is at least current.
 *
 * These are the rules a *consumer* of the bridge stream follows. The daemon is
 * the producer, so it uses the same module from the other side: every emission
 * advances the revision by exactly one (`nextPiUiRevision`), which is the only
 * way a conforming consumer can ever apply a delta. Both directions are unit
 * tested against each other, so producer and consumer can never drift.
 */

/** Revision of an agent that has never emitted Pi UI state. */
export const PIUI_INITIAL_REVISION = 0;

/** What a consumer must do with an incoming delta. */
export type PiUiDeltaRevisionDecision =
  /** `incoming === current + 1`: the only applicable delta. */
  | { action: "apply"; reason: "next"; revision: number }
  /** `incoming <= current`: already applied, drop it silently. */
  | { action: "discard"; reason: "stale" }
  /** `incoming > current + 1`: a gap; ask the producer for a full state. */
  | { action: "resync"; reason: "gap" }
  /** Not a non-negative safe integer; unusable, ask for a full state. */
  | { action: "resync"; reason: "invalid" };

/** What a consumer must do with an incoming full state. */
export type PiUiFullStateRevisionDecision =
  /** `incoming >= current`: accept and adopt the revision. */
  | { action: "apply"; reason: "at-or-ahead"; revision: number }
  /** `incoming < current`: a stale full state never rolls state backwards. */
  | { action: "discard"; reason: "stale" }
  | { action: "discard"; reason: "invalid" };

/** Exported so other modules (e.g. the reconnect replay planner) validate a
 * client-supplied revision with the exact same rule as the tracker itself. */
export function isPiUiRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRevision(value: unknown): value is number {
  return isPiUiRevision(value);
}

/** The revision a producer must stamp on its next delta. */
export function nextPiUiRevision(current: number): number {
  return current + 1;
}

/** Delta rule: discard `<= current`, apply `current + 1`, resync beyond that. */
export function decidePiUiDeltaRevision(
  current: number,
  incoming: unknown,
): PiUiDeltaRevisionDecision {
  if (!isRevision(incoming)) return { action: "resync", reason: "invalid" };
  if (incoming <= current) return { action: "discard", reason: "stale" };
  if (incoming === current + 1) return { action: "apply", reason: "next", revision: incoming };
  return { action: "resync", reason: "gap" };
}

/** Full-state rule: accept only a revision at or above current. */
export function decidePiUiFullStateRevision(
  current: number,
  incoming: unknown,
): PiUiFullStateRevisionDecision {
  if (!isRevision(incoming)) return { action: "discard", reason: "invalid" };
  if (incoming < current) return { action: "discard", reason: "stale" };
  return { action: "apply", reason: "at-or-ahead", revision: incoming };
}

/**
 * Stateful helper around the two rules above.
 *
 * It owns nothing but the current revision: callers keep their own element
 * map and only mutate it when the tracker says `apply`. That keeps the rules
 * testable in isolation and reusable by both the daemon store and any client.
 */
export class PiUiRevisionTracker {
  private revision: number;

  constructor(initial: number = PIUI_INITIAL_REVISION) {
    this.revision = isRevision(initial) ? initial : PIUI_INITIAL_REVISION;
  }

  get current(): number {
    return this.revision;
  }

  /** Applies the delta rule and advances only on `apply`. */
  ingestDelta(incoming: unknown): PiUiDeltaRevisionDecision {
    const decision = decidePiUiDeltaRevision(this.revision, incoming);
    if (decision.action === "apply") this.revision = decision.revision;
    return decision;
  }

  /** Applies the full-state rule and adopts the revision on `apply`. */
  ingestFullState(incoming: unknown): PiUiFullStateRevisionDecision {
    const decision = decidePiUiFullStateRevision(this.revision, incoming);
    if (decision.action === "apply") this.revision = decision.revision;
    return decision;
  }

  /** Producer side: stamp and adopt the next revision. */
  bump(): number {
    this.revision = nextPiUiRevision(this.revision);
    return this.revision;
  }

  /** Back to "never seen state", used on close and agent shutdown. */
  reset(to: number = PIUI_INITIAL_REVISION): void {
    this.revision = isRevision(to) ? to : PIUI_INITIAL_REVISION;
  }
}
