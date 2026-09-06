/**
 * Tests for the resume-reconciliation controller (T46A2, plan.md §7.4).
 */
import { describe, expect, it, vi } from "vitest";

import type { AppLifecycle, AppLifecycleState } from "../platform/lifecycle.js";
import type { Clock, TimerHandle } from "../platform/clock.js";
import type { NetworkReachability, NetworkStatus } from "../platform/network.js";
import { RunGenerationTracker } from "../timeline/run-generation.js";
import { ingestAgentStreamMessage, ingestTimelineWindow } from "../timeline/reducer.js";
import { createEmptyTimelineState } from "../timeline/types.js";
import type { TimelineState } from "../timeline/types.js";
import {
  agentStreamMessageFromFrame,
  fetchAgentTimelineResponseFromFrame,
  frameById,
} from "../timeline/fixtures/wire.js";
import { loadTimelineFixtureScenario } from "../timeline/fixtures/index.js";
import { ResumeController } from "./resume-controller.js";
import type { ResumeReconcile, ResumeTrigger } from "./resume-controller.js";

// ---------------------------------------------------------------------------
// Local test doubles. Deliberately small and file-local: this task owns only
// resume-controller.ts, so its own fixtures stay here rather than growing a
// shared test-support module another task would need to know about.
// ---------------------------------------------------------------------------

interface ScheduledTimer {
  id: number;
  dueAt: number;
  callback: () => void;
  intervalMs: number | null;
}

function toHandle(id: number): TimerHandle {
  return id as unknown as TimerHandle;
}
function fromHandle(handle: TimerHandle): number {
  return handle as unknown as number;
}

class FakeClock implements Clock {
  private currentTime = 0;
  private nextId = 1;
  private readonly timers = new Map<number, ScheduledTimer>();

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { id, dueAt: this.currentTime + delayMs, callback, intervalMs: null });
    return toHandle(id);
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(fromHandle(handle));
  }

  setInterval(callback: () => void, intervalMs: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, {
      id,
      dueAt: this.currentTime + intervalMs,
      callback,
      intervalMs,
    });
    return toHandle(id);
  }

  clearInterval(handle: TimerHandle): void {
    this.timers.delete(fromHandle(handle));
  }

  /** Advances time and synchronously fires every timer now due, in due order. */
  advance(byMs: number): void {
    const target = this.currentTime + byMs;
    for (;;) {
      const due = [...this.timers.values()]
        .filter((timer) => timer.dueAt <= target)
        .sort((a, b) => a.dueAt - b.dueAt);
      const next = due[0];
      if (!next) break;
      this.currentTime = next.dueAt;
      if (next.intervalMs === null) {
        this.timers.delete(next.id);
      } else {
        next.dueAt = this.currentTime + next.intervalMs;
      }
      next.callback();
    }
    this.currentTime = target;
  }

  pendingTimerCount(): number {
    return this.timers.size;
  }
}

class FakeAppLifecycle implements AppLifecycle {
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
    return () => this.listeners.delete(listener);
  }

  setState(state: AppLifecycleState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

class FakeNetworkReachability implements NetworkReachability {
  private status: NetworkStatus;
  private readonly listeners = new Set<(status: NetworkStatus) => void>();

  constructor(initial: NetworkStatus = { online: true, kind: "wifi" }) {
    this.status = initial;
  }

  async getStatus(): Promise<NetworkStatus> {
    return this.status;
  }

  subscribe(listener: (status: NetworkStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setStatus(status: NetworkStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

/** A controllable reconcile double: resolves only when `resolve()` is called for that call, recording every invocation. */
function deferredReconcile() {
  const calls: Array<{ trigger: ResumeTrigger; resolve: (apply?: () => void) => void }> = [];
  const reconcile: ResumeReconcile = (trigger) =>
    new Promise((resolve) => {
      calls.push({ trigger, resolve: (apply) => resolve(apply) });
    });
  return { reconcile, calls };
}

describe("ResumeController: host-supplied resume signal", () => {
  it("triggers reconciliation when AppLifecycle moves from background to active", async () => {
    const lifecycle = new FakeAppLifecycle("background");
    const applied = vi.fn();
    const reconcile: ResumeReconcile = async (trigger) => {
      expect(trigger).toBe("resume-signal");
      return applied;
    };
    const controller = new ResumeController({
      runGeneration: new RunGenerationTracker(),
      clock: new FakeClock(),
      reconcile,
      lifecycle,
    });

    lifecycle.setState("active");
    await Promise.resolve();
    await Promise.resolve();

    expect(applied).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("does not trigger on a background->inactive transition, only ->active", async () => {
    const lifecycle = new FakeAppLifecycle("background");
    const reconcile = vi.fn<ResumeReconcile>(async () => undefined);
    const controller = new ResumeController({
      runGeneration: new RunGenerationTracker(),
      clock: new FakeClock(),
      reconcile,
      lifecycle,
    });

    lifecycle.setState("inactive");
    await Promise.resolve();

    expect(reconcile).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("triggers reconciliation when NetworkReachability moves from offline to online", async () => {
    const network = new FakeNetworkReachability({ online: false, kind: "none" });
    const applied = vi.fn();
    const reconcile: ResumeReconcile = async (trigger) => {
      expect(trigger).toBe("resume-signal");
      return applied;
    };
    const controller = new ResumeController({
      runGeneration: new RunGenerationTracker(),
      clock: new FakeClock(),
      reconcile,
      network,
    });
    // Let the constructor's best-effort getStatus() resolve before the
    // real transition, so it is unambiguous which one is under test.
    await Promise.resolve();
    await Promise.resolve();

    network.setStatus({ online: true, kind: "wifi" });
    await Promise.resolve();
    await Promise.resolve();

    expect(applied).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("does not trigger on a same-status network notification", async () => {
    const network = new FakeNetworkReachability({ online: true, kind: "wifi" });
    const reconcile = vi.fn<ResumeReconcile>(async () => undefined);
    const controller = new ResumeController({
      runGeneration: new RunGenerationTracker(),
      clock: new FakeClock(),
      reconcile,
      network,
    });
    await Promise.resolve();
    await Promise.resolve();

    network.setStatus({ online: true, kind: "cellular" }); // still online, just a kind change
    await Promise.resolve();

    expect(reconcile).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("supports an explicit notifyResumeSignal() call for a host that manages its own subscriptions", async () => {
    const applied = vi.fn();
    const reconcile: ResumeReconcile = async (trigger) => {
      expect(trigger).toBe("resume-signal");
      return applied;
    };
    const controller = new ResumeController({
      runGeneration: new RunGenerationTracker(),
      clock: new FakeClock(),
      reconcile,
    });

    controller.notifyResumeSignal();
    await Promise.resolve();
    await Promise.resolve();

    expect(applied).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("does not blindly trust cached state: every resume signal actually calls reconcile()", async () => {
    const reconcile = vi.fn<ResumeReconcile>(async () => undefined);
    const controller = new ResumeController({
      runGeneration: new RunGenerationTracker(),
      clock: new FakeClock(),
      reconcile,
    });

    controller.notifyResumeSignal();
    await Promise.resolve();

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith("resume-signal");
    controller.dispose();
  });
});

describe("ResumeController: bounded periodic check while a run is active", () => {
  it("runs a periodic reconcile on the configured interval only while active", async () => {
    const clock = new FakeClock();
    const reconcile = vi.fn<ResumeReconcile>(async () => undefined);
    const controller = new ResumeController({
      runGeneration: new RunGenerationTracker(),
      clock,
      reconcile,
      periodicIntervalMs: 5_000,
    });

    expect(controller.isPeriodicCheckActive()).toBe(false);
    controller.notifyRunActive();
    expect(controller.isPeriodicCheckActive()).toBe(true);

    clock.advance(5_000);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenLastCalledWith("periodic");
    // Let the in-flight reconcile's promise settle before the next tick,
    // otherwise it coalesces into a pending trigger instead of a fresh call.
    await Promise.resolve();
    await Promise.resolve();

    clock.advance(5_000);
    expect(reconcile).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    await Promise.resolve();

    controller.notifyRunSettled();
    expect(controller.isPeriodicCheckActive()).toBe(false);

    clock.advance(20_000);
    expect(reconcile).toHaveBeenCalledTimes(2); // no further ticks once settled

    controller.dispose();
  });

  it("notifyRunActive() is idempotent while already active", () => {
    const clock = new FakeClock();
    const reconcile = vi.fn<ResumeReconcile>(async () => undefined);
    const controller = new ResumeController({
      runGeneration: new RunGenerationTracker(),
      clock,
      reconcile,
      periodicIntervalMs: 1_000,
    });

    controller.notifyRunActive();
    controller.notifyRunActive();
    controller.notifyRunActive();
    expect(clock.pendingTimerCount()).toBe(1);

    controller.dispose();
  });

  it("notifyRunSettled() before any active run is a harmless no-op", () => {
    const controller = new ResumeController({
      runGeneration: new RunGenerationTracker(),
      clock: new FakeClock(),
      reconcile: async () => undefined,
    });

    expect(() => controller.notifyRunSettled()).not.toThrow();
    expect(controller.isPeriodicCheckActive()).toBe(false);
    controller.dispose();
  });
});

describe("ResumeController: run-generation gating", () => {
  it("discards a slow reconcile's apply step once a newer run has begun", async () => {
    const tracker = new RunGenerationTracker();
    tracker.beginRun(); // generation 1, current when the reconcile starts
    const applied = vi.fn();
    const { reconcile, calls } = deferredReconcile();
    const controller = new ResumeController({
      runGeneration: tracker,
      clock: new FakeClock(),
      reconcile,
    });

    controller.notifyResumeSignal();
    await Promise.resolve();
    expect(calls).toHaveLength(1);

    // A newer run begins while the reconcile is still in flight.
    tracker.beginRun(); // generation 2

    calls[0]?.resolve(applied);
    await Promise.resolve();
    await Promise.resolve();

    expect(applied).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("applies a reconcile's result when no newer run began while it was in flight", async () => {
    const tracker = new RunGenerationTracker();
    tracker.beginRun();
    const applied = vi.fn();
    const { reconcile, calls } = deferredReconcile();
    const controller = new ResumeController({
      runGeneration: tracker,
      clock: new FakeClock(),
      reconcile,
    });

    controller.notifyResumeSignal();
    await Promise.resolve();
    calls[0]?.resolve(applied);
    await Promise.resolve();
    await Promise.resolve();

    expect(applied).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("a fixture proves a late resume reconcile from an abandoned run cannot resurrect stale state", async () => {
    // Mirrors run-generation.test.ts's own fixture shape, applied to the
    // resume path instead of a direct agent_stream response: a reconcile
    // kicked off under generation 1 resolves only after generation 2 has
    // begun, and must never be allowed to overwrite whatever generation 2
    // has already produced.
    const tracker = new RunGenerationTracker();
    let sharedState = "generation-1-state";
    tracker.beginRun();
    const { reconcile, calls } = deferredReconcile();
    const controller = new ResumeController({
      runGeneration: tracker,
      clock: new FakeClock(),
      reconcile,
    });

    controller.notifyResumeSignal();
    await Promise.resolve();

    tracker.beginRun();
    sharedState = "generation-2-state"; // the newer run has already produced real state

    calls[0]?.resolve(() => {
      sharedState = "stale reconcile from generation 1";
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(sharedState).toBe("generation-2-state");
    controller.dispose();
  });
});

describe("ResumeController: coalesces overlapping triggers", () => {
  it("runs at most one more reconcile after the in-flight one settles, not one per trigger", async () => {
    const { reconcile, calls } = deferredReconcile();
    const controller = new ResumeController({
      runGeneration: new RunGenerationTracker(),
      clock: new FakeClock(),
      reconcile,
    });

    controller.notifyResumeSignal();
    await Promise.resolve();
    expect(calls).toHaveLength(1);

    // Three more triggers arrive while the first is still in flight.
    controller.notifyResumeSignal();
    controller.notifyResumeSignal();
    controller.notifyResumeSignal();
    expect(calls).toHaveLength(1); // none started a second concurrent attempt

    calls[0]?.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toHaveLength(2); // exactly one coalesced follow-up
    calls[1]?.resolve();
    await Promise.resolve();

    controller.dispose();
  });
});

describe("ResumeController: reuses the T20B gap-detection path", () => {
  it("a reconcile built from ingestTimelineWindow closes a real gap, proving no second recovery route exists", async () => {
    const scenario = loadTimelineFixtureScenario("gap-backfill");
    let state: TimelineState = createEmptyTimelineState();
    state = ingestAgentStreamMessage(
      state,
      agentStreamMessageFromFrame(frameById(scenario.frames, "live-seq-10")),
    );
    state = ingestAgentStreamMessage(
      state,
      agentStreamMessageFromFrame(frameById(scenario.frames, "live-seq-20")),
    );
    expect(state.gap).toEqual({ epoch: "epoch-t20b-0001", fromSeq: 11, toSeq: 19 });

    const page1 = fetchAgentTimelineResponseFromFrame(
      frameById(scenario.frames, "gap-backfill-page-1"),
    );
    const page2 = fetchAgentTimelineResponseFromFrame(
      frameById(scenario.frames, "gap-backfill-page-2"),
    );

    const reconcile: ResumeReconcile = async () => {
      // The exact T20B path: fetch_agent_timeline_response -> ingestTimelineWindow.
      // No parallel "resume" ingestion function is invented here.
      return () => {
        state = ingestTimelineWindow(state, page1);
        state = ingestTimelineWindow(state, page2);
      };
    };
    const controller = new ResumeController({
      runGeneration: new RunGenerationTracker(),
      clock: new FakeClock(),
      reconcile,
    });

    controller.notifyResumeSignal();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(state.gap).toBeNull();
    expect(state.rows.map((row) => row.seqStart)).toEqual([10, 11, 15, 20]);
    controller.dispose();
  });
});

describe("ResumeController: dispose()", () => {
  it("unsubscribes lifecycle/network listeners and stops the periodic timer", () => {
    const lifecycle = new FakeAppLifecycle("active");
    const network = new FakeNetworkReachability({ online: true, kind: "wifi" });
    const clock = new FakeClock();
    const reconcile = vi.fn<ResumeReconcile>(async () => undefined);
    const controller = new ResumeController({
      runGeneration: new RunGenerationTracker(),
      clock,
      reconcile,
      lifecycle,
      network,
      periodicIntervalMs: 1_000,
    });
    controller.notifyRunActive();

    expect(lifecycle.listenerCount()).toBe(1);
    expect(network.listenerCount()).toBe(1);
    expect(clock.pendingTimerCount()).toBe(1);

    controller.dispose();

    expect(lifecycle.listenerCount()).toBe(0);
    expect(network.listenerCount()).toBe(0);
    expect(clock.pendingTimerCount()).toBe(0);
  });

  it("further signals after dispose() are ignored", async () => {
    const reconcile = vi.fn<ResumeReconcile>(async () => undefined);
    const controller = new ResumeController({
      runGeneration: new RunGenerationTracker(),
      clock: new FakeClock(),
      reconcile,
    });
    controller.dispose();

    controller.notifyResumeSignal();
    controller.notifyRunActive();
    await Promise.resolve();

    expect(reconcile).not.toHaveBeenCalled();
    expect(controller.isPeriodicCheckActive()).toBe(false);
  });
});
