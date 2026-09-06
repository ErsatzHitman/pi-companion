/**
 * Proves the real browser `AppLifecycle`/`NetworkReachability` adapters
 * (T46A3, plan.md §7.4 "Liveness") correctly drive the core
 * `ResumeController` (T46A2): a backgrounded-then-foregrounded tab and a
 * regained network connection both reach `reconcile()`, and a realistic
 * reconcile built the T20B way (`ingestTimelineWindow`) leaves the
 * transcript correct once applied.
 *
 * `resume-controller.test.ts` (in `packages/frontend-core`) already
 * proves the controller's own logic against fake `AppLifecycle`/
 * `NetworkReachability` doubles; this file's job is narrower and
 * web-specific — proving the *real* `document.visibilitychange`/
 * `navigator.onLine` adapters this app ships translate into the same
 * `trigger()` path, which is exactly T46A3's acceptance criteria.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { connection as coreConnection, timeline as coreTimeline } from "@picompanion/frontend-core";
import type { Clock, TimerHandle } from "@picompanion/frontend-core";

import { createDocumentVisibilityLifecycle } from "./lifecycle.js";
import { createBrowserNetworkReachability } from "./network.js";

function setVisibilityState(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

/** A no-op `Clock`: these tests never exercise the bounded periodic check. */
class NoopClock implements Clock {
  now(): number {
    return Date.now();
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

/** One `fetch_agent_timeline_response`-shaped window with a single entry, mirroring `use-resume-session.test.ts`'s precedent. */
function timelineWindow(options: {
  epoch: string;
  seq: number;
  text: string;
}): Parameters<typeof coreTimeline.ingestTimelineWindow>[1] {
  return {
    type: "fetch_agent_timeline_response",
    payload: {
      requestId: `req-${options.seq}`,
      agentId: "agt-1",
      agent: null,
      direction: "tail",
      projection: "projected",
      epoch: options.epoch,
      reset: options.seq === 0,
      staleCursor: false,
      gap: false,
      window: { minSeq: options.seq, maxSeq: options.seq, nextSeq: options.seq + 1 },
      startCursor: { epoch: options.epoch, seq: options.seq },
      endCursor: { epoch: options.epoch, seq: options.seq },
      hasOlder: options.seq > 0,
      hasNewer: false,
      entries: [
        {
          provider: "pi",
          item: { type: "assistant_message", text: options.text },
          timestamp: "2026-01-02T00:00:00.000Z",
          seqStart: options.seq,
          seqEnd: options.seq,
          sourceSeqRanges: [{ startSeq: options.seq, endSeq: options.seq }],
          collapsed: [],
        },
      ],
      error: null,
    },
  } as Parameters<typeof coreTimeline.ingestTimelineWindow>[1];
}

describe("web ResumeController wiring (T46A3)", () => {
  const originalVisibility = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
  const originalOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");

  afterEach(() => {
    if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
    if (originalOnLine) Object.defineProperty(window.navigator, "onLine", originalOnLine);
    vi.restoreAllMocks();
  });

  it("returning to a backgrounded tab triggers reconciliation within one second of visibility", async () => {
    setVisibilityState("hidden");
    const lifecycle = createDocumentVisibilityLifecycle();
    const reconcile = vi.fn<coreConnection.ResumeReconcile>(async () => undefined);
    const controller = new coreConnection.ResumeController({
      runGeneration: new coreTimeline.RunGenerationTracker(),
      clock: new NoopClock(),
      reconcile,
      lifecycle,
    });

    const startedAt = Date.now();
    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith("resume-signal");
    expect(Date.now() - startedAt).toBeLessThan(1000);
    controller.dispose();
  });

  it("does not reconcile on backgrounding itself, only on the return to visible", async () => {
    setVisibilityState("visible");
    const lifecycle = createDocumentVisibilityLifecycle();
    const reconcile = vi.fn<coreConnection.ResumeReconcile>(async () => undefined);
    const controller = new coreConnection.ResumeController({
      runGeneration: new coreTimeline.RunGenerationTracker(),
      clock: new NoopClock(),
      reconcile,
      lifecycle,
    });

    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(reconcile).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("regaining network connectivity triggers the same resume-signal path", async () => {
    setOnline(false);
    const network = createBrowserNetworkReachability();
    const reconcile = vi.fn<coreConnection.ResumeReconcile>(async () => undefined);
    const controller = new coreConnection.ResumeController({
      runGeneration: new coreTimeline.RunGenerationTracker(),
      clock: new NoopClock(),
      reconcile,
      network,
    });
    // Let the controller's best-effort getStatus() resolve first, matching
    // resume-controller.test.ts's precedent for this exact race.
    await Promise.resolve();
    await Promise.resolve();

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    await Promise.resolve();

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith("resume-signal");
    controller.dispose();
  });

  it("going offline alone does not trigger reconciliation, only the return to online", async () => {
    setOnline(true);
    const network = createBrowserNetworkReachability();
    const reconcile = vi.fn<coreConnection.ResumeReconcile>(async () => undefined);
    const controller = new coreConnection.ResumeController({
      runGeneration: new coreTimeline.RunGenerationTracker(),
      clock: new NoopClock(),
      reconcile,
      network,
    });
    await Promise.resolve();
    await Promise.resolve();

    setOnline(false);
    window.dispatchEvent(new Event("offline"));
    await Promise.resolve();

    expect(reconcile).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("backgrounds the page during an active run and restores the correct transcript on return", async () => {
    // "During a run": the periodic check is active (notifyRunActive()),
    // matching how a caller would drive this in a real session.
    setVisibilityState("visible");
    const lifecycle = createDocumentVisibilityLifecycle();
    const runGeneration = new coreTimeline.RunGenerationTracker();
    runGeneration.beginRun();

    // What the transcript looked like right before the tab was
    // backgrounded: one authoritative row at seq 0.
    let state = coreTimeline.ingestTimelineWindow(
      coreTimeline.createEmptyTimelineState(),
      timelineWindow({ epoch: "epoch-1", seq: 0, text: "hello" }),
    );
    expect(state.rows.map((row) => row.seqStart)).toEqual([0]);

    // While the tab is hidden, the daemon keeps moving: a new row lands
    // at seq 1 that the backgrounded tab's live socket never delivered
    // (the exact "socket stays open but goes silent" gap this task
    // closes — plan.md §7.4). The authoritative fetch this reconcile
    // performs is built the T20B way, matching resume-controller.test.ts's
    // "reuses the T20B gap-detection path" fixture.
    const authoritativeWindow = timelineWindow({ epoch: "epoch-1", seq: 1, text: "still here" });
    const reconcile: coreConnection.ResumeReconcile = async () => {
      return () => {
        state = coreTimeline.ingestTimelineWindow(state, authoritativeWindow);
      };
    };

    const controller = new coreConnection.ResumeController({
      runGeneration,
      clock: new NoopClock(),
      reconcile,
      lifecycle,
    });
    controller.notifyRunActive();

    // Backgrounded, then returns to the foreground.
    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(state.rows.map((row) => row.seqStart)).toEqual([0, 1]);
    expect(state.rows[1]?.item).toMatchObject({ type: "assistant_message", text: "still here" });

    controller.notifyRunSettled();
    controller.dispose();
  });
});
