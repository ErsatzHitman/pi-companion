/**
 * Android foreground/connectivity -> resume-signal decision logic
 * (T32S1B, plan.md §7.3/§7.4 "Liveness").
 *
 * §7.4's third recovery case is a socket that stays **open** but goes
 * **silent**: the daemon moved on (new epoch, more rows, a finished turn)
 * while nothing told the client to look. T20B already recovers a socket
 * that *closes* and §12.5 already recovers an app that *dies*; neither
 * fires here. `frontend-core`'s `connection.ResumeController` (T46A2)
 * closes that gap, and §7.4 is explicit that the **host** must feed it
 * foreground and connectivity changes — "on Android, where backgrounding
 * is constant, this is not optional".
 *
 * That constancy is the reason this module exists rather than handing
 * `AppState`/reachability straight to `ResumeController`'s own optional
 * `lifecycle`/`network` config. On Android the raw event streams churn:
 * `AppState` fires `change` for a pulled-down notification shade, a
 * permission dialog, a screen that blanks and wakes, and repeats
 * `"active"` verbatim; connectivity flaps Wi-Fi -> cellular -> Wi-Fi
 * while walking out of a building. `ResumeController` dedupes only what
 * it can see from one signal source at a time (a `!== "active"` ->
 * `"active"` lifecycle transition, an offline -> online network
 * transition) and coalesces only reconciles that are already in flight.
 * Three things it cannot do, which this module does:
 *
 * - **Rate-limit.** A burst of transitions inside `minIntervalMs`
 *   produces exactly one leading reconcile plus, if more churn followed
 *   it, one trailing reconcile — never one per event. The leading edge
 *   fires immediately, so returning to the foreground still reconciles
 *   within the "within one second of visibility" bar T46A3 set on web.
 * - **Notice a path switch.** Wi-Fi -> cellular keeps `online === true`
 *   throughout, so `ResumeController`'s offline -> online rule ignores it,
 *   yet the old socket is exactly the "open but silent" case: its
 *   connection is bound to an interface that no longer carries traffic.
 *   A `kind` change while online is treated as a resume signal here.
 * - **Correlate the two sources.** Connectivity churn observed while the
 *   app is not foregrounded is not worth a reconcile: the return to the
 *   foreground reconciles anyway, and reconciling from a doze-mode radio
 *   flap burns battery for a result nothing is on screen to see.
 *
 * Pure and framework-free by design: no React, no React Native, no Expo,
 * no timers of its own, no `Date.now()`. Every decision is a function of
 * the observed state plus a caller-supplied `nowMs`, so the churn
 * behaviour above is unit-testable in plain `vitest` (which cannot load
 * `react-native` at all — see `resume-signals.test.ts`). The thin
 * `AppState` binding lives in `../platform/lifecycle.ts`; the
 * subscription glue is `attachResumeSignals()` at the bottom of this
 * file, which takes `AppLifecycle`/`NetworkReachability` interfaces and
 * an injected scheduler rather than reaching for platform globals.
 */
import type {
  AppLifecycle,
  AppLifecycleState,
  NetworkReachability,
  NetworkStatus,
} from "@picompanion/frontend-core";

/** Why a resume signal was raised. Carried for logging/tests; every reason drives the same `notifyResumeSignal()` call. */
export type ResumeSignalReason =
  /** The app came back to the foreground from `"background"`/`"inactive"`. */
  | "foreground"
  /** Connectivity was regained after being offline. */
  | "network-online"
  /** Connectivity stayed up but changed path (e.g. Wi-Fi -> cellular), so an existing socket may be bound to a dead interface. */
  | "network-path-change";

/** Why an observation raised no signal. Exhaustive, so each churn rule can be asserted on its own. */
export type ResumeSignalSuppression =
  /** Nothing to compare against yet: the first observation only seeds state. */
  | "first-observation"
  /** Identical to the last observed value (Android repeats `"active"`, and reachability re-reports the same path). */
  | "unchanged"
  /** A real change, but the wrong direction: going to the background, or going offline. */
  | "no-transition"
  /** A connectivity change observed while the app was not foregrounded; the return to the foreground reconciles instead. */
  | "backgrounded"
  /** `flush()` with no coalesced signal waiting. */
  | "nothing-pending";

export type ResumeSignalPlan =
  /** Raise a resume signal now. */
  | { readonly kind: "emit"; readonly reason: ResumeSignalReason }
  /**
   * Rate-limited: raise this signal once `delayMs` has elapsed, by
   * calling `flush()`. A further plan while one is already deferred keeps
   * the original deadline (so unbroken churn can never starve the signal)
   * and reports the time still remaining on it.
   */
  | { readonly kind: "defer"; readonly reason: ResumeSignalReason; readonly delayMs: number }
  /** No signal; `because` says which churn rule applied. */
  | { readonly kind: "suppress"; readonly because: ResumeSignalSuppression };

/**
 * Rate limit between two reconciles driven by lifecycle/connectivity
 * churn. Long enough to fold an unlock -> shade -> dialog burst (each of
 * which fires its own `AppState` change within a few hundred
 * milliseconds) into one reconcile, short enough that a deferred signal
 * still lands well inside a human "did it catch up?" window.
 */
export const DEFAULT_RESUME_SIGNAL_MIN_INTERVAL_MS = 2_000;

export interface ResumeSignalCoalescerOptions {
  minIntervalMs?: number;
  /**
   * Seeds the lifecycle half so the *first* real transition is
   * classifiable. Callers pass `AppLifecycle.getState()`, which is
   * synchronous. Omitted (or `null`) means the first observation only
   * seeds and raises nothing, mirroring `ResumeController`'s own rule.
   */
  initialLifecycleState?: AppLifecycleState | null;
  /** Same for connectivity. `NetworkReachability.getStatus()` is async, so `seedNetworkStatus()` exists for the late fill. */
  initialNetworkStatus?: NetworkStatus | null;
}

/**
 * Decides, without touching any platform API, whether one observed
 * lifecycle/connectivity change should raise a resume signal.
 *
 * Not reentrant: drive it from one place (see `attachResumeSignals`).
 */
export class ResumeSignalCoalescer {
  private readonly minIntervalMs: number;
  private lifecycleState: AppLifecycleState | null;
  private networkStatus: NetworkStatus | null;
  private lastEmittedAtMs: number | null = null;
  private pendingReason: ResumeSignalReason | null = null;
  private pendingDeadlineMs: number | null = null;

  constructor(options: ResumeSignalCoalescerOptions = {}) {
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_RESUME_SIGNAL_MIN_INTERVAL_MS;
    this.lifecycleState = options.initialLifecycleState ?? null;
    this.networkStatus = options.initialNetworkStatus ?? null;
  }

  /** Last observed lifecycle state, or `null` if none has been observed. Inspection surface. */
  getLifecycleState(): AppLifecycleState | null {
    return this.lifecycleState;
  }

  /** Last observed connectivity status, or `null` if none has been observed. Inspection surface. */
  getNetworkStatus(): NetworkStatus | null {
    return this.networkStatus;
  }

  /** Whether a rate-limited signal is waiting for `flush()`. Inspection surface. */
  hasPendingSignal(): boolean {
    return this.pendingReason !== null;
  }

  /**
   * Fills in the connectivity baseline from an async `getStatus()` that
   * resolved after construction, but only if nothing has been observed
   * yet — a `subscribe()` event that arrived first is authoritative and
   * must not be overwritten by a staler read. Returns whether it seeded.
   */
  seedNetworkStatus(status: NetworkStatus): boolean {
    if (this.networkStatus !== null) return false;
    this.networkStatus = status;
    return true;
  }

  /** Feeds one `AppLifecycle` observation in. */
  observeLifecycle(state: AppLifecycleState, nowMs: number): ResumeSignalPlan {
    const previous = this.lifecycleState;
    this.lifecycleState = state;
    if (previous === null) return { kind: "suppress", because: "first-observation" };
    if (previous === state) return { kind: "suppress", because: "unchanged" };
    // Leaving the foreground is not a resume; the return to it is.
    if (state !== "active") return { kind: "suppress", because: "no-transition" };
    return this.plan("foreground", nowMs);
  }

  /** Feeds one `NetworkReachability` observation in. */
  observeNetwork(status: NetworkStatus, nowMs: number): ResumeSignalPlan {
    const previous = this.networkStatus;
    this.networkStatus = status;
    if (previous === null) return { kind: "suppress", because: "first-observation" };
    if (previous.online === status.online && previous.kind === status.kind) {
      return { kind: "suppress", because: "unchanged" };
    }
    // Losing connectivity is not a resume; regaining it, or swapping the
    // path underneath a still-online socket, is.
    if (!status.online) return { kind: "suppress", because: "no-transition" };
    if (this.lifecycleState !== null && this.lifecycleState !== "active") {
      return { kind: "suppress", because: "backgrounded" };
    }
    return this.plan(previous.online ? "network-path-change" : "network-online", nowMs);
  }

  /**
   * Raises the coalesced signal a previous `"defer"` plan asked for.
   * Scheduling the call is the caller's job (this module owns no timer);
   * `attachResumeSignals()` does it.
   */
  flush(nowMs: number): ResumeSignalPlan {
    const reason = this.pendingReason;
    if (reason === null) return { kind: "suppress", because: "nothing-pending" };
    this.pendingReason = null;
    this.pendingDeadlineMs = null;
    this.lastEmittedAtMs = nowMs;
    return { kind: "emit", reason };
  }

  private plan(reason: ResumeSignalReason, nowMs: number): ResumeSignalPlan {
    if (this.pendingReason !== null) {
      // A flush is already scheduled. Keep its deadline and take the newer
      // reason: extending the deadline on every event would let unbroken
      // churn postpone the reconcile indefinitely.
      this.pendingReason = reason;
      const remainingMs = Math.max(0, (this.pendingDeadlineMs ?? nowMs) - nowMs);
      return { kind: "defer", reason, delayMs: remainingMs };
    }
    const lastEmittedAtMs = this.lastEmittedAtMs;
    if (lastEmittedAtMs !== null && nowMs - lastEmittedAtMs < this.minIntervalMs) {
      this.pendingReason = reason;
      this.pendingDeadlineMs = lastEmittedAtMs + this.minIntervalMs;
      return { kind: "defer", reason, delayMs: Math.max(0, this.pendingDeadlineMs - nowMs) };
    }
    this.lastEmittedAtMs = nowMs;
    return { kind: "emit", reason };
  }
}

/**
 * What `attachResumeSignals()` feeds. Structurally satisfied by
 * `frontend-core`'s `connection.ResumeController` (T46A2), and kept to
 * the single method used so this module never imports the controller (or
 * a `DaemonClient`, or `TimelineState`) and so a test can hand it a spy.
 */
export interface ResumeSignalTarget {
  notifyResumeSignal(): void;
}

/**
 * Runs `callback` after `delayMs` and returns a canceller. Injected so
 * the rate limiter is testable without fake timers; the default uses the
 * ambient `setTimeout`, which React Native provides.
 */
export type DeferredSignalScheduler = (callback: () => void, delayMs: number) => () => void;

/** Where a plan came from. Reported to `onPlan` for logging and assertions. */
export type ResumeSignalSource = "lifecycle" | "network" | "flush";

export interface AttachResumeSignalsOptions {
  lifecycle: AppLifecycle;
  network: NetworkReachability;
  /** The T46A2 `ResumeController` these signals drive. */
  target: ResumeSignalTarget;
  minIntervalMs?: number;
  now?: () => number;
  schedule?: DeferredSignalScheduler;
  /** Observes every decision, including suppressed ones. */
  onPlan?: (plan: ResumeSignalPlan, source: ResumeSignalSource) => void;
}

const defaultSchedule: DeferredSignalScheduler = (callback, delayMs) => {
  const handle = setTimeout(callback, delayMs);
  return () => {
    clearTimeout(handle);
  };
};

/**
 * Subscribes to this app's `AppLifecycle` and `NetworkReachability` and
 * drives `target.notifyResumeSignal()` through `ResumeSignalCoalescer`.
 *
 * Deliberately *not* done by passing `lifecycle`/`network` into
 * `ResumeControllerConfig`: that path bypasses every churn rule above.
 * `ResumeController` documents `notifyResumeSignal()` as the seam for
 * exactly this case — "a caller that instead manages its own
 * subscriptions".
 *
 * Returns a dispose function that unsubscribes both sources and cancels
 * any scheduled flush. Idempotent.
 */
export function attachResumeSignals(options: AttachResumeSignalsOptions): () => void {
  const {
    lifecycle,
    network,
    target,
    minIntervalMs,
    now = () => Date.now(),
    schedule = defaultSchedule,
    onPlan,
  } = options;

  const coalescer = new ResumeSignalCoalescer({
    ...(minIntervalMs === undefined ? {} : { minIntervalMs }),
    initialLifecycleState: lifecycle.getState(),
  });

  let disposed = false;
  let cancelPendingFlush: (() => void) | null = null;

  const handle = (plan: ResumeSignalPlan, source: ResumeSignalSource): void => {
    if (disposed) return;
    onPlan?.(plan, source);
    if (plan.kind === "emit") {
      target.notifyResumeSignal();
      return;
    }
    if (plan.kind === "defer" && cancelPendingFlush === null) {
      cancelPendingFlush = schedule(() => {
        cancelPendingFlush = null;
        handle(coalescer.flush(now()), "flush");
      }, plan.delayMs);
    }
  };

  const unsubscribeLifecycle = lifecycle.subscribe((state) => {
    handle(coalescer.observeLifecycle(state, now()), "lifecycle");
  });
  const unsubscribeNetwork = network.subscribe((status) => {
    handle(coalescer.observeNetwork(status, now()), "network");
  });

  // Best-effort connectivity baseline: `getStatus()` is async, so the
  // first real `subscribe()` event would otherwise be unclassifiable.
  // Never blocks attachment, and never overwrites an event that already
  // arrived.
  void network.getStatus().then(
    (status) => {
      if (!disposed) coalescer.seedNetworkStatus(status);
    },
    () => {
      // A reachability read that fails leaves the baseline unseeded: the
      // next observation seeds it instead. Not worth failing attachment.
    },
  );

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribeLifecycle();
    unsubscribeNetwork();
    cancelPendingFlush?.();
    cancelPendingFlush = null;
  };
}
