/**
 * Resume-reconciliation controller — plan.md §7.4/§14.5, T46A2.
 *
 * §7.4 calls out a real gap: T20B's reducer already recovers a socket that
 * **closes** (reconnect + gap backfill) and plan.md §12.5 already recovers
 * an app that **dies** (restart, restore a stale cached tail). Neither
 * covers a socket that stays open and goes **silent** — a backgrounded
 * browser tab whose timers are throttled, a phone that slept, a laptop
 * that suspended — where the daemon may have moved on (a new epoch, more
 * rows, a finished turn) while nothing told the client to look.
 *
 * `ResumeController` closes that gap by deciding *when* to run an
 * authoritative reconciliation, never *how*: the actual fetch-and-apply
 * step is supplied by the caller as `reconcile()` and must itself be built
 * on the existing T20B gap-detection/backfill path
 * (`fetch_agent_timeline_request` -> `ingestTimelineWindow`/
 * `planGapBackfillRequest`) — this module deliberately owns no
 * `DaemonClient`, no `TimelineState`, and no wire types, so it cannot grow
 * a second recovery route by accident. See `resume-controller.test.ts`'s
 * "reuses the T20B gap-detection path" fixture for a `reconcile()` built
 * from the real reducer functions, not a stand-in.
 *
 * Two trigger sources, both required by §7.4's "Liveness" note:
 *
 * - a host-supplied resume signal — `AppLifecycle` moving to `"active"`
 *   from `"inactive"`/`"background"`, or `NetworkReachability` moving to
 *   online from offline, or an explicit `notifyResumeSignal()` call from a
 *   platform host that manages its own subscriptions (T46A3's web wiring
 *   can use either shape; both end up on the same `trigger()` path);
 * - a bounded periodic check that runs only while a run is active
 *   (`notifyRunActive()`/`notifyRunSettled()`, driven by whatever already
 *   tracks turn lifecycle) — covers a session left open and idle-looking
 *   but mid-turn, without polling forever once the turn settles.
 *
 * Every reconciliation attempt is gated by the same `RunGenerationTracker`
 * T46A1 uses to fence prompt-run responses (`fenceAsyncResponse`): the
 * generation is captured the moment the attempt starts, and the caller's
 * deferred `apply()` step only runs if that generation is still current
 * once `reconcile()` settles. A slow reconcile that resolves after a newer
 * run has begun is discarded exactly like a slow RPC response would be —
 * never merged, never applied as "latest wins".
 *
 * No React, no DOM (repository invariant, enforced by
 * `../import-guard.test.ts`).
 */
import type { Clock, TimerHandle } from "../platform/clock.js";
import type { AppLifecycle, AppLifecycleState } from "../platform/lifecycle.js";
import type { Logger } from "../platform/logging.js";
import type { NetworkReachability, NetworkStatus } from "../platform/network.js";
import { fenceAsyncResponse, RunGenerationTracker } from "../timeline/run-generation.js";

/** Why one reconciliation attempt started. */
export type ResumeTrigger = "resume-signal" | "periodic";

/**
 * Performs one authoritative reconciliation attempt for `trigger` and
 * returns a deferred `apply()` step, rather than applying anything itself,
 * so `ResumeController` can gate *applying* the result by run generation
 * without gating (or duplicating) the fetch itself. Returning `undefined`
 * (or a `void` result) means there was nothing to apply.
 *
 * A real implementation sends a `fetch_agent_timeline_request` and builds
 * `apply` from `ingestTimelineWindow`/`planGapBackfillRequest` — the T20B
 * path — against whatever store holds `TimelineState`; this type stays
 * generic so `resume-controller.ts` never needs to import either.
 */
export type ResumeReconcile = (trigger: ResumeTrigger) => Promise<(() => void) | void>;

export interface ResumeControllerConfig {
  /**
   * Shared with whatever fences prompt-run responses (T46A1's
   * `RunGenerationTracker`), so a resume reconcile and a stale run
   * response are gated by the exact same monotonic counter rather than a
   * second, independently-drifting one.
   */
  runGeneration: RunGenerationTracker;
  clock: Clock;
  reconcile: ResumeReconcile;
  /**
   * Subscribed automatically for the lifetime of this controller. A
   * transition to `"active"` from `"inactive"`/`"background"` is treated
   * as a host-supplied resume signal. Optional: a caller that prefers to
   * manage its own `AppLifecycle` subscription (e.g. to combine it with
   * other logic) can omit this and call `notifyResumeSignal()` directly
   * instead.
   */
  lifecycle?: AppLifecycle;
  /**
   * Subscribed automatically for the lifetime of this controller. A
   * transition to online from offline is treated as a host-supplied
   * resume signal too (§7.4's "Liveness" note; T46A3's "regaining network
   * connectivity triggers the same path"). Optional, same reasoning as
   * `lifecycle`.
   */
  network?: NetworkReachability;
  /**
   * Interval for the bounded periodic check that runs only while a run is
   * active (`notifyRunActive()`). Defaults to 20000ms — frequent enough to
   * catch a silent socket during a long turn, bounded enough to never spin
   * once `notifyRunSettled()` stops it.
   */
  periodicIntervalMs?: number;
  /** Called when `reconcile()` itself rejects. Reconciliation failure is not fatal to this controller: it simply waits for the next trigger. */
  onReconcileError?: (error: unknown, trigger: ResumeTrigger) => void;
  logger?: Logger;
}

const DEFAULT_PERIODIC_INTERVAL_MS = 20_000;

export class ResumeController {
  private readonly runGeneration: RunGenerationTracker;
  private readonly clock: Clock;
  private readonly reconcile: ResumeReconcile;
  private readonly periodicIntervalMs: number;
  private readonly onReconcileError: ((error: unknown, trigger: ResumeTrigger) => void) | undefined;
  private readonly logger: Logger | undefined;

  private readonly lifecycleUnsubscribe: (() => void) | null;
  private readonly networkUnsubscribe: (() => void) | null;

  private lastLifecycleState: AppLifecycleState | null = null;
  private lastNetworkOnline: boolean | null = null;

  private periodicTimer: TimerHandle | null = null;
  private reconciling = false;
  private pendingTrigger: ResumeTrigger | null = null;
  private disposed = false;

  constructor(config: ResumeControllerConfig) {
    this.runGeneration = config.runGeneration;
    this.clock = config.clock;
    this.reconcile = config.reconcile;
    this.periodicIntervalMs = config.periodicIntervalMs ?? DEFAULT_PERIODIC_INTERVAL_MS;
    this.onReconcileError = config.onReconcileError;
    this.logger = config.logger;

    if (config.lifecycle) {
      this.lastLifecycleState = config.lifecycle.getState();
      this.lifecycleUnsubscribe = config.lifecycle.subscribe((state) => {
        this.handleLifecycleState(state);
      });
    } else {
      this.lifecycleUnsubscribe = null;
    }

    if (config.network) {
      this.networkUnsubscribe = config.network.subscribe((status) => {
        this.handleNetworkStatus(status);
      });
      // getStatus() is async; best-effort fill so the *next* subscribe
      // event can tell a real offline->online transition from "we simply
      // never observed a status before". Never blocks construction, and a
      // subscribe event arriving first (rare, but not impossible for a
      // synchronous test double) is not overwritten.
      void config.network.getStatus().then((status) => {
        if (this.lastNetworkOnline === null) {
          this.lastNetworkOnline = status.online;
        }
      });
    } else {
      this.networkUnsubscribe = null;
    }
  }

  /**
   * Explicit host-supplied resume signal. For a caller that hands this
   * controller its own `AppLifecycle`/`NetworkReachability` (the common
   * case), those already call this internally; it is public so a caller
   * that instead manages its own subscriptions (or has some other reason
   * to believe the connection went silent) can trigger the same path.
   */
  notifyResumeSignal(): void {
    this.trigger("resume-signal");
  }

  /**
   * Starts the bounded periodic check. Idempotent while a run is already
   * marked active. Call once a new prompt run begins (e.g. right after
   * `RunGenerationTracker.beginRun()`).
   */
  notifyRunActive(): void {
    if (this.disposed || this.periodicTimer) return;
    this.periodicTimer = this.clock.setInterval(() => {
      this.trigger("periodic");
    }, this.periodicIntervalMs);
  }

  /**
   * Stops the bounded periodic check. Call once the active run settles
   * (completes, fails, or is canceled). A no-op if no periodic check is
   * running.
   */
  notifyRunSettled(): void {
    if (this.periodicTimer) {
      this.clock.clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  /** Whether the bounded periodic check is currently running. Test/inspection surface. */
  isPeriodicCheckActive(): boolean {
    return this.periodicTimer !== null;
  }

  /** Whether a reconciliation attempt is currently in flight. Test/inspection surface. */
  isReconciling(): boolean {
    return this.reconciling;
  }

  /** Tears down every subscription and stops the periodic check. Terminal: further triggers are silently ignored. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.notifyRunSettled();
    this.lifecycleUnsubscribe?.();
    this.networkUnsubscribe?.();
    this.pendingTrigger = null;
  }

  private handleLifecycleState(state: AppLifecycleState): void {
    const previous = this.lastLifecycleState;
    this.lastLifecycleState = state;
    if (state === "active" && previous !== null && previous !== "active") {
      this.trigger("resume-signal");
    }
  }

  private handleNetworkStatus(status: NetworkStatus): void {
    const previousOnline = this.lastNetworkOnline;
    this.lastNetworkOnline = status.online;
    if (status.online && previousOnline === false) {
      this.trigger("resume-signal");
    }
  }

  private trigger(trigger: ResumeTrigger): void {
    if (this.disposed) return;
    if (this.reconciling) {
      // Coalesce: remember only the latest pending trigger rather than
      // stacking concurrent reconciliation attempts. The in-flight
      // attempt already reconciles against "now", so a trigger that
      // arrives while it is running is satisfied by running exactly one
      // more attempt once it settles, not by queuing every trigger.
      this.pendingTrigger = trigger;
      return;
    }
    void this.runReconcile(trigger);
  }

  private async runReconcile(trigger: ResumeTrigger): Promise<void> {
    this.reconciling = true;
    const generation = this.runGeneration.getCurrent();
    try {
      const apply = await fenceAsyncResponse(this.runGeneration, generation, () =>
        this.reconcile(trigger),
      );
      apply?.();
    } catch (error) {
      this.logger?.warn("resume reconciliation failed", {
        trigger,
        error: error instanceof Error ? error.message : String(error),
      });
      this.onReconcileError?.(error, trigger);
    } finally {
      this.reconciling = false;
      const next = this.pendingTrigger;
      this.pendingTrigger = null;
      if (next && !this.disposed) {
        void this.runReconcile(next);
      }
    }
  }
}
