/**
 * Deterministic Pi UI revision rules — client side (plan.md §4.2, "Bridge
 * state correctness"; T21B).
 *
 * plan.md states the rules exactly once, so a conforming consumer follows the
 * same four rules the daemon producer does:
 *
 * - discard a delta at or below the current revision (stale);
 * - apply only `current + 1`;
 * - request a full state when a delta jumps ahead (gap);
 * - accept a full state only when its revision is at least current.
 *
 * This is the client-side mirror of the daemon's
 * `packages/server/src/server/agent/providers/pi/ui-bridge/revision.ts`.
 * frontend-core cannot depend on `@picompanion/server` (repository
 * invariant: frontend-core stays platform- and backend-neutral, consuming
 * only `@picompanion/protocol` wire types), so the rules are re-expressed
 * here rather than imported — deliberately kept byte-for-byte identical in
 * behavior so producer and consumer never drift. `state.ts` in this
 * directory is the only caller.
 */

/** Revision of an agent this client has never seen Pi UI state for. */
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

/** True for a non-negative safe-integer revision. */
export function isPiUiRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Delta rule: discard `<= current`, apply `current + 1`, resync beyond that. */
export function decidePiUiDeltaRevision(
  current: number,
  incoming: unknown,
): PiUiDeltaRevisionDecision {
  if (!isPiUiRevision(incoming)) return { action: "resync", reason: "invalid" };
  if (incoming <= current) return { action: "discard", reason: "stale" };
  if (incoming === current + 1) return { action: "apply", reason: "next", revision: incoming };
  return { action: "resync", reason: "gap" };
}

/** Full-state rule: accept only a revision at or above current. */
export function decidePiUiFullStateRevision(
  current: number,
  incoming: unknown,
): PiUiFullStateRevisionDecision {
  if (!isPiUiRevision(incoming)) return { action: "discard", reason: "invalid" };
  if (incoming < current) return { action: "discard", reason: "stale" };
  return { action: "apply", reason: "at-or-ahead", revision: incoming };
}

/**
 * Stateful helper around the two rules above.
 *
 * It owns nothing but the current revision: callers keep their own element
 * map and only mutate it when the tracker says `apply`. That keeps the rules
 * testable in isolation and reusable by every per-agent entry in
 * `PiUiElementStore`.
 */
export class PiUiRevisionTracker {
  private revision: number;

  constructor(initial: number = PIUI_INITIAL_REVISION) {
    this.revision = isPiUiRevision(initial) ? initial : PIUI_INITIAL_REVISION;
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

  /** Back to "never seen state", used on epoch reset, disconnect, or agent removal. */
  reset(to: number = PIUI_INITIAL_REVISION): void {
    this.revision = isPiUiRevision(to) ? to : PIUI_INITIAL_REVISION;
  }
}
