import type { Clock, TimerHandle } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

import {
  TerminalResizeController,
  type TerminalResizeClaim,
  type TerminalResizeReadiness,
} from "./terminal-resize-controller";

/** Deterministic, manually-advanced `Clock` test double, local to this file. */
class FakeClock implements Clock {
  private currentTime = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { dueAt: number; callback: () => void }>();

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { dueAt: this.currentTime + delayMs, callback });
    return id as unknown as TimerHandle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }

  setInterval(): TimerHandle {
    throw new Error("not used by terminal-resize-controller");
  }

  clearInterval(): void {
    throw new Error("not used by terminal-resize-controller");
  }

  advance(ms: number): void {
    this.currentTime += ms;
    const due = [...this.timers.entries()]
      .filter(([, t]) => t.dueAt <= this.currentTime)
      .sort((a, b) => a[1].dueAt - b[1].dueAt);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
  }

  get pendingCount(): number {
    return this.timers.size;
  }
}

const READY: TerminalResizeReadiness = {
  isVisible: true,
  isConnected: true,
  isTerminalReady: true,
};

function createController(clock: FakeClock, claims: TerminalResizeClaim[], debounceMs = 100) {
  return new TerminalResizeController({
    debounceMs,
    clock,
    onClaim: (claim) => claims.push(claim),
  });
}

describe("TerminalResizeController", () => {
  it("never claims before visible, connected, and terminal-ready are all true", () => {
    const clock = new FakeClock();
    const claims: TerminalResizeClaim[] = [];
    const controller = createController(clock, claims);

    controller.setSize({ rows: 24, cols: 80 });
    controller.setReadiness({ isVisible: true, isConnected: true, isTerminalReady: false });
    clock.advance(1000);
    expect(claims).toHaveLength(0);

    controller.setReadiness({ isVisible: true, isConnected: false, isTerminalReady: true });
    clock.advance(1000);
    expect(claims).toHaveLength(0);

    controller.setReadiness(READY);
    clock.advance(100);
    expect(claims).toEqual([{ rows: 24, cols: 80, intent: "claim" }]);
  });

  it("debounces rapid measurements into a single claim with the final size", () => {
    const clock = new FakeClock();
    const claims: TerminalResizeClaim[] = [];
    const controller = createController(clock, claims);
    controller.setReadiness(READY);

    controller.setSize({ rows: 24, cols: 80 });
    clock.advance(30);
    controller.setSize({ rows: 30, cols: 90 });
    clock.advance(30);
    controller.setSize({ rows: 32, cols: 100 });
    // Only 60ms have elapsed since the last setSize; debounce is 100ms.
    clock.advance(60);
    expect(claims).toHaveLength(0);

    clock.advance(40);
    expect(claims).toEqual([{ rows: 32, cols: 100, intent: "claim" }]);
  });

  it("retains a size measured while not ready and claims it once readiness returns (the 'stuck size' regression)", () => {
    const clock = new FakeClock();
    const claims: TerminalResizeClaim[] = [];
    const controller = createController(clock, claims);

    // Measured while backgrounded — must not be dropped.
    controller.setReadiness({ isVisible: false, isConnected: true, isTerminalReady: true });
    controller.setSize({ rows: 40, cols: 120 });
    clock.advance(10_000);
    expect(claims).toHaveLength(0);

    // Foregrounded later, with no further setSize call.
    controller.setReadiness(READY);
    clock.advance(100);
    expect(claims).toEqual([{ rows: 40, cols: 120, intent: "claim" }]);
  });

  it("cancels an in-flight debounce the instant readiness drops, so it cannot fire while not ready", () => {
    const clock = new FakeClock();
    const claims: TerminalResizeClaim[] = [];
    const controller = createController(clock, claims);
    controller.setReadiness(READY);

    controller.setSize({ rows: 24, cols: 80 });
    clock.advance(50); // Debounce armed, not yet due (100ms).
    controller.setReadiness({ ...READY, isVisible: false }); // App backgrounded mid-debounce.
    clock.advance(1000); // Well past the original due time.
    expect(claims).toHaveLength(0);

    controller.setReadiness(READY); // Foregrounded again.
    clock.advance(100);
    expect(claims).toEqual([{ rows: 24, cols: 80, intent: "claim" }]);
  });

  it("does not re-claim an unchanged size across a readiness flap that never disconnected", () => {
    const clock = new FakeClock();
    const claims: TerminalResizeClaim[] = [];
    const controller = createController(clock, claims);
    controller.setReadiness(READY);
    controller.setSize({ rows: 24, cols: 80 });
    clock.advance(100);
    expect(claims).toHaveLength(1);

    // Visibility flaps off and back on with no size change and no disconnect.
    controller.setReadiness({ ...READY, isVisible: false });
    controller.setReadiness(READY);
    clock.advance(100);
    expect(claims).toHaveLength(1);
  });

  it("re-claims an identical size after a reconnect, since the daemon's PTY may have reset", () => {
    const clock = new FakeClock();
    const claims: TerminalResizeClaim[] = [];
    const controller = createController(clock, claims);
    controller.setReadiness(READY);
    controller.setSize({ rows: 24, cols: 80 });
    clock.advance(100);
    expect(claims).toHaveLength(1);

    controller.setReadiness({ ...READY, isConnected: false });
    controller.setReadiness(READY); // Reconnected.
    clock.advance(100);
    expect(claims).toHaveLength(2);
    expect(claims[1]).toEqual({ rows: 24, cols: 80, intent: "claim" });
  });

  it("ignores a degenerate measurement the daemon's own schema would reject (T35B3, rotation transient)", () => {
    const clock = new FakeClock();
    const claims: TerminalResizeClaim[] = [];
    const controller = createController(clock, claims);
    controller.setReadiness(READY);

    controller.setSize({ rows: 24, cols: 80 });
    clock.advance(100);
    expect(claims).toEqual([{ rows: 24, cols: 80, intent: "claim" }]);

    // Mid-rotation, the fit addon reports a transiently degenerate frame
    // (zero rows) before the layout settles — a size that would fail
    // `TerminalStreamResizeSchema` and be silently dropped server-side.
    controller.setSize({ rows: 0, cols: 80 });
    clock.advance(100);
    // No second claim: the invalid sample never overwrote currentSize,
    // and never armed the debounce timer either.
    expect(claims).toHaveLength(1);

    // The next real measurement still claims normally — currentSize was
    // left exactly as it was, not corrupted by the invalid sample.
    controller.setSize({ rows: 40, cols: 120 });
    clock.advance(100);
    expect(claims).toEqual([
      { rows: 24, cols: 80, intent: "claim" },
      { rows: 40, cols: 120, intent: "claim" },
    ]);
  });

  it("ignores a negative or non-integer measurement the same way", () => {
    const clock = new FakeClock();
    const claims: TerminalResizeClaim[] = [];
    const controller = createController(clock, claims);
    controller.setReadiness(READY);

    controller.setSize({ rows: -1, cols: 80 });
    controller.setSize({ rows: 24.5, cols: 80 });
    clock.advance(100);
    expect(claims).toHaveLength(0);
  });

  it("dispose cancels a pending debounce so it never fires", () => {
    const clock = new FakeClock();
    const claims: TerminalResizeClaim[] = [];
    const controller = createController(clock, claims);
    controller.setReadiness(READY);
    controller.setSize({ rows: 24, cols: 80 });
    controller.dispose();
    clock.advance(1000);
    expect(claims).toHaveLength(0);
    expect(clock.pendingCount).toBe(0);
  });
});
