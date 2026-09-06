/**
 * T32S1B coverage: Android foreground/connectivity churn -> T46A2
 * `ResumeController` (plan.md §7.4 "Liveness").
 *
 * Two layers, both real:
 *
 * - the pure `ResumeSignalCoalescer` rules, driven with an explicit
 *   `nowMs` so the rate limiter needs no fake timers;
 * - `attachResumeSignals()` against a **real**
 *   `connection.ResumeController` (never a stand-in), constructed
 *   *without* its optional `lifecycle`/`network` config so the only route
 *   from an OS event to `reconcile()` is this app's wiring.
 *
 * `frontend-core` is loadable here because it imports neither React nor
 * React Native; the `AppState` binding this feeds in production
 * (`../platform/lifecycle.ts`) is covered separately in
 * `../platform/lifecycle.test.ts`, which mocks `react-native` because
 * plain `vitest` cannot transform it.
 */
import { describe, expect, it, vi } from "vitest";

import type {
  AppLifecycle,
  AppLifecycleState,
  Clock,
  NetworkReachability,
  NetworkStatus,
  TimerHandle,
} from "@picompanion/frontend-core";
import { connection as coreConnection, timeline as coreTimeline } from "@picompanion/frontend-core";

import { FakeNetworkReachability } from "../platform/fake-network";
import {
  attachResumeSignals,
  DEFAULT_RESUME_SIGNAL_MIN_INTERVAL_MS,
  ResumeSignalCoalescer,
  type DeferredSignalScheduler,
  type ResumeSignalPlan,
  type ResumeSignalSource,
} from "./resume-signals";

const WIFI: NetworkStatus = { online: true, kind: "wifi" };
const CELLULAR: NetworkStatus = { online: true, kind: "cellular" };
const OFFLINE: NetworkStatus = { online: false, kind: "none" };

class FakeLifecycle implements AppLifecycle {
  private state: AppLifecycleState;
  private readonly listeners = new Set<(state: AppLifecycleState) => void>();

  constructor(initial: AppLifecycleState = "active") {
    this.state = initial;
  }

  getState(): AppLifecycleState {
    return this.state;
  }

  subscribe(listener: (state: AppLifecycleState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Simulates one `AppState` change. */
  set(state: AppLifecycleState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

/** Collects deferred flushes instead of running them on a real timer. */
class ManualScheduler {
  private entries: { callback: () => void; delayMs: number }[] = [];

  readonly schedule: DeferredSignalScheduler = (callback, delayMs) => {
    const entry = { callback, delayMs };
    this.entries.push(entry);
    return () => {
      this.entries = this.entries.filter((candidate) => candidate !== entry);
    };
  };

  get pendingDelays(): readonly number[] {
    return this.entries.map((entry) => entry.delayMs);
  }

  runAll(): void {
    const due = this.entries;
    this.entries = [];
    for (const entry of due) entry.callback();
  }
}

/** A `Clock` that never fires: these tests never exercise the bounded periodic check. */
class NoopClock implements Clock {
  now(): number {
    return 0;
  }
  setTimeout(): TimerHandle {
    return 0 as unknown as TimerHandle;
  }
  clearTimeout(): void {}
  setInterval(): TimerHandle {
    return 0 as unknown as TimerHandle;
  }
  clearInterval(): void {}
}

/** Lets the controller's fenced `reconcile()` promise chain settle. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("ResumeSignalCoalescer lifecycle rules", () => {
  it("only seeds on the first observation, so a cold start never fakes a resume", () => {
    const coalescer = new ResumeSignalCoalescer();
    expect(coalescer.observeLifecycle("active", 0)).toEqual({
      kind: "suppress",
      because: "first-observation",
    });
    expect(coalescer.getLifecycleState()).toBe("active");
  });

  it("raises one signal on background -> active", () => {
    const coalescer = new ResumeSignalCoalescer({ initialLifecycleState: "background" });
    expect(coalescer.observeLifecycle("active", 0)).toEqual({ kind: "emit", reason: "foreground" });
  });

  it("treats inactive -> active as a resume too (AppState reports inactive, document.visibilityState cannot)", () => {
    const coalescer = new ResumeSignalCoalescer({ initialLifecycleState: "inactive" });
    expect(coalescer.observeLifecycle("active", 0)).toEqual({ kind: "emit", reason: "foreground" });
  });

  it("raises nothing when the app leaves the foreground", () => {
    const coalescer = new ResumeSignalCoalescer({ initialLifecycleState: "active" });
    expect(coalescer.observeLifecycle("inactive", 0)).toEqual({
      kind: "suppress",
      because: "no-transition",
    });
    expect(coalescer.observeLifecycle("background", 10)).toEqual({
      kind: "suppress",
      because: "no-transition",
    });
  });

  it('dedupes a repeated "active" (Android re-reports it for a dismissed dialog or shade)', () => {
    const coalescer = new ResumeSignalCoalescer({ initialLifecycleState: "active" });
    expect(coalescer.observeLifecycle("active", 0)).toEqual({
      kind: "suppress",
      because: "unchanged",
    });
    expect(coalescer.observeLifecycle("active", 5_000)).toEqual({
      kind: "suppress",
      because: "unchanged",
    });
  });
});

describe("ResumeSignalCoalescer connectivity rules", () => {
  it("raises network-online on offline -> online", () => {
    const coalescer = new ResumeSignalCoalescer({
      initialLifecycleState: "active",
      initialNetworkStatus: OFFLINE,
    });
    expect(coalescer.observeNetwork(WIFI, 0)).toEqual({
      kind: "emit",
      reason: "network-online",
    });
  });

  it("raises network-path-change on a Wi-Fi -> cellular switch that stays online", () => {
    const coalescer = new ResumeSignalCoalescer({
      initialLifecycleState: "active",
      initialNetworkStatus: WIFI,
    });
    expect(coalescer.observeNetwork(CELLULAR, 0)).toEqual({
      kind: "emit",
      reason: "network-path-change",
    });
  });

  it("raises nothing when connectivity is lost", () => {
    const coalescer = new ResumeSignalCoalescer({
      initialLifecycleState: "active",
      initialNetworkStatus: WIFI,
    });
    expect(coalescer.observeNetwork(OFFLINE, 0)).toEqual({
      kind: "suppress",
      because: "no-transition",
    });
  });

  it("dedupes an identical re-reported status", () => {
    const coalescer = new ResumeSignalCoalescer({
      initialLifecycleState: "active",
      initialNetworkStatus: WIFI,
    });
    expect(coalescer.observeNetwork({ ...WIFI }, 0)).toEqual({
      kind: "suppress",
      because: "unchanged",
    });
  });

  it("suppresses connectivity churn while the app is not foregrounded: the return to it reconciles", () => {
    const coalescer = new ResumeSignalCoalescer({
      initialLifecycleState: "background",
      initialNetworkStatus: OFFLINE,
    });
    expect(coalescer.observeNetwork(WIFI, 0)).toEqual({
      kind: "suppress",
      because: "backgrounded",
    });
    // ...and the foreground transition is not itself rate-limited by that
    // suppressed churn, because nothing was ever emitted for it.
    expect(coalescer.observeLifecycle("active", 10)).toEqual({
      kind: "emit",
      reason: "foreground",
    });
  });

  it("still classifies connectivity when no lifecycle state has been observed at all", () => {
    const coalescer = new ResumeSignalCoalescer({ initialNetworkStatus: OFFLINE });
    expect(coalescer.observeNetwork(WIFI, 0)).toEqual({ kind: "emit", reason: "network-online" });
  });

  it("seeds a late getStatus() read only while nothing has been observed", () => {
    const coalescer = new ResumeSignalCoalescer();
    expect(coalescer.seedNetworkStatus(WIFI)).toBe(true);
    expect(coalescer.getNetworkStatus()).toEqual(WIFI);
    expect(coalescer.seedNetworkStatus(OFFLINE)).toBe(false);
    expect(coalescer.getNetworkStatus()).toEqual(WIFI);
  });
});

describe("ResumeSignalCoalescer rate limiting", () => {
  it("emits the leading signal immediately, so a foreground reconcile is never delayed", () => {
    const coalescer = new ResumeSignalCoalescer({ initialLifecycleState: "background" });
    expect(coalescer.observeLifecycle("active", 1_000)).toEqual({
      kind: "emit",
      reason: "foreground",
    });
  });

  it("defers a second signal inside the window and reports the remaining delay", () => {
    const coalescer = new ResumeSignalCoalescer({
      minIntervalMs: 2_000,
      initialLifecycleState: "background",
      initialNetworkStatus: WIFI,
    });
    expect(coalescer.observeLifecycle("active", 0)).toEqual({
      kind: "emit",
      reason: "foreground",
    });
    expect(coalescer.observeNetwork(CELLULAR, 500)).toEqual({
      kind: "defer",
      reason: "network-path-change",
      delayMs: 1_500,
    });
    expect(coalescer.hasPendingSignal()).toBe(true);
  });

  it("folds a whole burst into one trailing signal that keeps the newest reason", () => {
    const coalescer = new ResumeSignalCoalescer({
      minIntervalMs: 2_000,
      initialLifecycleState: "background",
      initialNetworkStatus: OFFLINE,
    });
    expect(coalescer.observeLifecycle("active", 0).kind).toBe("emit");

    // Unlock/shade/dialog churn plus a radio flap, all inside the window.
    expect(coalescer.observeLifecycle("inactive", 100).kind).toBe("suppress");
    expect(coalescer.observeLifecycle("active", 200)).toMatchObject({ kind: "defer" });
    expect(coalescer.observeNetwork(WIFI, 300)).toMatchObject({
      kind: "defer",
      reason: "network-online",
    });
    expect(coalescer.observeNetwork(CELLULAR, 400)).toMatchObject({
      kind: "defer",
      reason: "network-path-change",
    });

    expect(coalescer.flush(2_000)).toEqual({ kind: "emit", reason: "network-path-change" });
    expect(coalescer.hasPendingSignal()).toBe(false);
  });

  it("never pushes the deadline out while churn continues, so the signal cannot be starved", () => {
    const coalescer = new ResumeSignalCoalescer({
      minIntervalMs: 2_000,
      initialLifecycleState: "background",
      initialNetworkStatus: WIFI,
    });
    coalescer.observeLifecycle("active", 0);
    expect(coalescer.observeNetwork(CELLULAR, 500)).toMatchObject({ delayMs: 1_500 });
    // A later event inside the window reports the *original* deadline's
    // remaining time (2000 - 1900), not a fresh full window.
    expect(coalescer.observeNetwork(WIFI, 1_900)).toMatchObject({ delayMs: 100 });
  });

  it("emits again immediately once the window has passed", () => {
    const coalescer = new ResumeSignalCoalescer({
      minIntervalMs: 2_000,
      initialLifecycleState: "background",
    });
    coalescer.observeLifecycle("active", 0);
    coalescer.observeLifecycle("background", 100);
    expect(coalescer.observeLifecycle("active", 2_000)).toEqual({
      kind: "emit",
      reason: "foreground",
    });
  });

  it("flush() with nothing pending raises nothing", () => {
    const coalescer = new ResumeSignalCoalescer();
    expect(coalescer.flush(0)).toEqual({ kind: "suppress", because: "nothing-pending" });
  });

  it("defaults the window to a documented constant rather than an inline literal", () => {
    expect(DEFAULT_RESUME_SIGNAL_MIN_INTERVAL_MS).toBe(2_000);
    const coalescer = new ResumeSignalCoalescer({ initialLifecycleState: "background" });
    coalescer.observeLifecycle("active", 0);
    coalescer.observeLifecycle("background", 1);
    expect(coalescer.observeLifecycle("active", 2)).toMatchObject({
      kind: "defer",
      delayMs: DEFAULT_RESUME_SIGNAL_MIN_INTERVAL_MS - 2,
    });
  });
});

describe("attachResumeSignals feeds a real ResumeController (T46A2)", () => {
  function harness(options: { lifecycleState?: AppLifecycleState; nowMs?: number } = {}) {
    const lifecycle = new FakeLifecycle(options.lifecycleState ?? "active");
    const network = new FakeNetworkReachability(WIFI);
    const scheduler = new ManualScheduler();
    const plans: { plan: ResumeSignalPlan; source: ResumeSignalSource }[] = [];
    let nowMs = options.nowMs ?? 0;
    const reconcile = vi.fn<coreConnection.ResumeReconcile>(async () => undefined);
    const controller = new coreConnection.ResumeController({
      runGeneration: new coreTimeline.RunGenerationTracker(),
      clock: new NoopClock(),
      reconcile,
      // Deliberately no `lifecycle`/`network` here: the only path from an
      // OS event to reconcile() is attachResumeSignals().
    });
    const dispose = attachResumeSignals({
      lifecycle,
      network,
      target: controller,
      minIntervalMs: 2_000,
      now: () => nowMs,
      schedule: scheduler.schedule,
      onPlan: (plan, source) => plans.push({ plan, source }),
    });
    return {
      lifecycle,
      network,
      scheduler,
      plans,
      reconcile,
      controller,
      dispose,
      advance: (byMs: number) => {
        nowMs += byMs;
      },
    };
  }

  it("reconciles when the app returns to the foreground", async () => {
    const h = harness();
    h.lifecycle.set("background");
    h.lifecycle.set("active");
    await settle();

    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.reconcile).toHaveBeenCalledWith("resume-signal");
    h.dispose();
    h.controller.dispose();
  });

  it("does not reconcile on backgrounding itself", async () => {
    const h = harness();
    h.lifecycle.set("background");
    await settle();

    expect(h.reconcile).not.toHaveBeenCalled();
    h.dispose();
    h.controller.dispose();
  });

  it("reconciles on a Wi-Fi -> cellular path switch the controller alone would ignore", async () => {
    const h = harness();
    // Let the best-effort getStatus() baseline resolve first.
    await settle();

    h.network.setStatus(CELLULAR);
    await settle();

    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.reconcile).toHaveBeenCalledWith("resume-signal");
    h.dispose();
    h.controller.dispose();
  });

  it("collapses a foreground/connectivity burst into two reconciles, not five", async () => {
    const h = harness();
    await settle();

    h.lifecycle.set("background");
    h.lifecycle.set("active"); // leading edge -> reconcile #1
    h.advance(100);
    h.lifecycle.set("inactive");
    h.lifecycle.set("active"); // inside the window -> deferred
    h.advance(100);
    h.network.setStatus(CELLULAR); // inside the window -> folded in
    h.network.setStatus(WIFI); // inside the window -> folded in
    await settle();

    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.scheduler.pendingDelays).toEqual([1_900]);

    h.advance(1_900);
    h.scheduler.runAll(); // the single trailing reconcile
    await settle();

    expect(h.reconcile).toHaveBeenCalledTimes(2);
    expect(h.scheduler.pendingDelays).toEqual([]);
    h.dispose();
    h.controller.dispose();
  });

  it("seeds the lifecycle baseline from getState(), so a cold start does not reconcile on its own", async () => {
    const h = harness({ lifecycleState: "active" });
    await settle();
    // Android re-reports "active" right after launch; nothing changed.
    h.lifecycle.set("active");
    await settle();

    expect(h.reconcile).not.toHaveBeenCalled();
    expect(h.plans.map((entry) => entry.plan.kind)).toEqual(["suppress"]);
    h.dispose();
    h.controller.dispose();
  });

  it("dispose() unsubscribes both sources and cancels a scheduled flush", async () => {
    const h = harness();
    await settle();
    h.lifecycle.set("background");
    h.lifecycle.set("active");
    h.advance(100);
    h.lifecycle.set("background");
    h.lifecycle.set("active");
    await settle();
    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.scheduler.pendingDelays).toHaveLength(1);

    h.dispose();
    expect(h.scheduler.pendingDelays).toEqual([]);

    h.advance(5_000);
    h.lifecycle.set("background");
    h.lifecycle.set("active");
    h.network.setStatus(CELLULAR);
    await settle();

    expect(h.reconcile).toHaveBeenCalledTimes(1);
    h.dispose(); // idempotent
    h.controller.dispose();
  });

  it("a reconcile that rejects does not stop the next resume signal", async () => {
    const lifecycle = new FakeLifecycle("active");
    const network = new FakeNetworkReachability(WIFI);
    const scheduler = new ManualScheduler();
    let nowMs = 0;
    const reconcile = vi.fn<coreConnection.ResumeReconcile>(async () => {
      throw new Error("daemon unreachable");
    });
    const onReconcileError = vi.fn();
    const controller = new coreConnection.ResumeController({
      runGeneration: new coreTimeline.RunGenerationTracker(),
      clock: new NoopClock(),
      reconcile,
      onReconcileError,
    });
    const dispose = attachResumeSignals({
      lifecycle,
      network,
      target: controller,
      minIntervalMs: 2_000,
      now: () => nowMs,
      schedule: scheduler.schedule,
    });

    lifecycle.set("background");
    lifecycle.set("active");
    await settle();
    expect(onReconcileError).toHaveBeenCalledTimes(1);

    nowMs += 3_000;
    lifecycle.set("background");
    lifecycle.set("active");
    await settle();

    expect(reconcile).toHaveBeenCalledTimes(2);
    dispose();
    controller.dispose();
  });

  it("uses the ambient setTimeout when no scheduler is injected", async () => {
    const lifecycle = new FakeLifecycle("active");
    const network = new FakeNetworkReachability(WIFI);
    const target = { notifyResumeSignal: vi.fn() };
    const dispose = attachResumeSignals({ lifecycle, network, target, minIntervalMs: 50 });

    lifecycle.set("background");
    lifecycle.set("active");
    lifecycle.set("background");
    lifecycle.set("active");
    expect(target.notifyResumeSignal).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(target.notifyResumeSignal).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("survives a NetworkReachability whose getStatus() rejects", async () => {
    const lifecycle = new FakeLifecycle("active");
    const network: NetworkReachability = {
      getStatus: () => Promise.reject(new Error("no permission")),
      subscribe: () => () => {},
    };
    const target = { notifyResumeSignal: vi.fn() };
    const dispose = attachResumeSignals({ lifecycle, network, target });
    await settle();

    lifecycle.set("background");
    lifecycle.set("active");
    expect(target.notifyResumeSignal).toHaveBeenCalledTimes(1);
    dispose();
  });
});

describe("run-generation gating survives this app's wiring (T46A1/T46A2)", () => {
  /**
   * The controller fences every reconcile it starts with the shared
   * `RunGenerationTracker`, and `notifyResumeSignal()` — the single method
   * `attachResumeSignals()` calls — routes through the same `trigger()`
   * path as the controller's own `lifecycle`/`network` subscriptions. These
   * two tests pin that: raising a signal from an Android churn rule is not
   * a side door around the fence.
   */
  function fencedHarness() {
    const lifecycle = new FakeLifecycle("active");
    const network = new FakeNetworkReachability(WIFI);
    const runGeneration = new coreTimeline.RunGenerationTracker();
    runGeneration.beginRun();

    const applied: string[] = [];
    let releaseReconcile!: (apply: () => void) => void;
    const reconcile = vi.fn<coreConnection.ResumeReconcile>(
      () =>
        new Promise<() => void>((resolve) => {
          releaseReconcile = resolve;
        }),
    );
    const controller = new coreConnection.ResumeController({
      runGeneration,
      clock: new NoopClock(),
      reconcile,
    });
    const dispose = attachResumeSignals({
      lifecycle,
      network,
      target: controller,
      schedule: () => () => {},
    });
    return {
      lifecycle,
      runGeneration,
      applied,
      reconcile,
      controller,
      dispose,
      release: () => releaseReconcile(() => applied.push("applied")),
    };
  }

  it("applies a reconcile that lands while its run is still current", async () => {
    const h = fencedHarness();
    await settle();
    h.lifecycle.set("background");
    h.lifecycle.set("active");
    await settle();
    expect(h.reconcile).toHaveBeenCalledTimes(1);

    h.release();
    await settle();

    expect(h.applied).toEqual(["applied"]);
    h.dispose();
    h.controller.dispose();
  });

  it("discards a reconcile that lands after a newer run began, never applying it", async () => {
    const h = fencedHarness();
    await settle();
    h.lifecycle.set("background");
    h.lifecycle.set("active");
    await settle();
    expect(h.reconcile).toHaveBeenCalledTimes(1);

    // A new prompt run starts while the resume reconcile is still in
    // flight; its result is now stale by the time it resolves.
    h.runGeneration.beginRun();
    h.release();
    await settle();

    expect(h.applied).toEqual([]);
    h.dispose();
    h.controller.dispose();
  });
});
