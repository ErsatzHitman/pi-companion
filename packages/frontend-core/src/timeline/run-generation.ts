/**
 * Run generation fence — plan.md §7.4, T46A1.
 *
 * §7.4 requires the core reducer to "fence every asynchronous response
 * with a monotonic run generation, so a slow reply from an abandoned run
 * can never resurrect stale state". The timeline reducer's own identity
 * fields (`epoch`/`seqStart`) already dedupe and order the continuous
 * `agent_stream` push channel (T20A/T20B); what they do *not* cover is a
 * discrete asynchronous response a caller is waiting on outside that
 * channel — an RPC round trip, a reconciliation fetch (T46A2), a queued
 * callback — that can resolve *after* the run it belongs to has been
 * abandoned (aborted, superseded by a new prompt, or superseded by a
 * newer reconciliation). Nothing about `epoch`/`seq` stops such a response
 * from still being applied once it finally arrives.
 *
 * `RunGenerationTracker` closes that gap. Every new prompt run captures a
 * monotonic generation stamp via `beginRun()`; every asynchronous response
 * that belongs to that run must be routed through `isCurrent`/`admit`/
 * `fenceAsyncResponse` before it is allowed to touch shared state. A
 * response tagged with a generation older than the tracker's current one
 * is discarded unconditionally — never merged, never "latest-wins" applied
 * — because plan.md's streaming-is-delta-based rule means a merge can
 * silently drop text; fencing controls whether a whole response is
 * admitted at all, not which of its rows survive.
 *
 * This module is a pure, generic primitive: it does not import
 * `TimelineState`, the reducer, or any wire type, so it composes with any
 * shared state a caller wants to gate (the timeline replica, session
 * status, an extension snapshot, ...). See `run-generation.test.ts` for a
 * fixture that gates the timeline reducer itself.
 *
 * No React, no DOM (repository invariant, enforced by
 * `../import-guard.test.ts`).
 */

/** A run's monotonic generation stamp. `0` is never issued by `beginRun()`,
 * so it safely fences out anything captured before the first prompt. */
export type RunGeneration = number;

const INITIAL_GENERATION: RunGeneration = 0;

/** Point-in-time snapshot of a tracker's counter, for tests/inspection. */
export interface RunGenerationSnapshot {
  readonly current: RunGeneration;
}

/**
 * Tracks the monotonic "run generation" for one session/agent: the ordinal
 * of the most recently started prompt run. Owns no timeline, transport, or
 * "is this run still active" state itself — it is strictly a fencing
 * primitive, deliberately small enough that other domains (T46A2's resume
 * controller, the composer's submit/abort flow) can each hold a reference
 * to the same tracker without taking on unrelated responsibilities.
 */
export class RunGenerationTracker {
  private current: RunGeneration = INITIAL_GENERATION;

  /**
   * Starts a new run and returns its generation stamp. Called exactly once
   * per new prompt submission — including a resubmission after an abort,
   * which is itself a new run, not a continuation of the old one.
   * Monotonic: every call returns a value strictly greater than every
   * previous call's return value and every previous `getCurrent()`.
   */
  beginRun(): RunGeneration {
    this.current += 1;
    return this.current;
  }

  /** The generation of the most recently started run. `0` before the first
   * `beginRun()` call. */
  getCurrent(): RunGeneration {
    return this.current;
  }

  /** True when `generation` is still the latest run — no newer run has
   * begun since it was captured. */
  isCurrent(generation: RunGeneration): boolean {
    return generation === this.current;
  }

  /** True when `generation` belongs to an abandoned run: a newer run has
   * begun since. `false` for the current generation and for a generation
   * that has not been issued yet (a caller bug, not staleness — such a
   * value can never actually be observed from a real `beginRun()` caller). */
  isStale(generation: RunGeneration): boolean {
    return generation < this.current;
  }

  /**
   * Applies `apply(state)` and returns its result only when `generation`
   * is still current; otherwise returns `state` unchanged, so a stale
   * response can never mutate the replica (plan.md §7.4 "A response
   * tagged with an older generation is discarded and never mutates the
   * replica"). `apply` itself should stay a pure function of `state`, the
   * same discipline the timeline reducer already follows, so `admit`
   * composes directly with reducer calls: `tracker.admit(gen, state, (s)
   * => ingestAgentStreamMessage(s, message))`.
   */
  admit<TState>(
    generation: RunGeneration,
    state: TState,
    apply: (state: TState) => TState,
  ): TState {
    if (!this.isCurrent(generation)) {
      return state;
    }
    return apply(state);
  }

  /** Snapshot for tests/inspection. Not part of the fencing contract itself. */
  snapshot(): RunGenerationSnapshot {
    return { current: this.current };
  }
}

/**
 * Wraps an asynchronous operation — typically an RPC round trip — so its
 * eventual result is only returned when `generation` is still current once
 * the operation settles. Resolves to `undefined` for a stale response
 * rather than rejecting: a discarded response is not an error, it is
 * simply too late to matter, and a caller that only cares about the
 * current run can treat `undefined` as "nothing to apply" without a
 * try/catch. A rejected `operation()` still rejects normally — fencing
 * only governs whether a *successful* response is admitted.
 */
export async function fenceAsyncResponse<T>(
  tracker: RunGenerationTracker,
  generation: RunGeneration,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  const result = await operation();
  return tracker.isCurrent(generation) ? result : undefined;
}
