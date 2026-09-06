import { describe, expect, it } from "vitest";

import { TestFrameClock } from "./frame-clock.js";
import type { FrameClock, FrameTickInfo } from "./frame-clock.js";

describe("TestFrameClock", () => {
  it("does not fire when nothing is scheduled", () => {
    const clock = new TestFrameClock();
    expect(clock.hasPendingFrame()).toBe(false);
    expect(clock.tick()).toBe(false);
  });

  it("schedules and fires a single pending callback on tick", () => {
    const clock = new TestFrameClock();
    const seen: FrameTickInfo[] = [];
    clock.requestFrame((info) => seen.push(info));

    expect(clock.hasPendingFrame()).toBe(true);
    const fired = clock.tick();

    expect(fired).toBe(true);
    expect(seen).toHaveLength(1);
    expect(clock.hasPendingFrame()).toBe(false);
  });

  it("clears the pending slot before invoking the callback, so it may reschedule itself", () => {
    const clock = new TestFrameClock();
    let calls = 0;
    const reschedule = () => {
      calls += 1;
      if (calls < 3) {
        clock.requestFrame(reschedule);
      }
    };
    clock.requestFrame(reschedule);

    clock.tick();
    expect(calls).toBe(1);
    expect(clock.hasPendingFrame()).toBe(true);

    clock.tick();
    expect(calls).toBe(2);
    expect(clock.hasPendingFrame()).toBe(true);

    clock.tick();
    expect(calls).toBe(3);
    expect(clock.hasPendingFrame()).toBe(false);
  });

  it("replaces a pending callback when requestFrame is called again before it fires", () => {
    const clock = new TestFrameClock();
    const calls: string[] = [];
    clock.requestFrame(() => calls.push("first"));
    clock.requestFrame(() => calls.push("second"));

    clock.tick();

    expect(calls).toEqual(["second"]);
  });

  it("cancelFrame cancels a pending callback without firing it", () => {
    const clock = new TestFrameClock();
    let fired = false;
    clock.requestFrame(() => {
      fired = true;
    });

    clock.cancelFrame();
    expect(clock.hasPendingFrame()).toBe(false);
    expect(clock.tick()).toBe(false);
    expect(fired).toBe(false);
  });

  it("cancelFrame is a safe no-op when nothing is pending", () => {
    const clock = new TestFrameClock();
    expect(() => clock.cancelFrame()).not.toThrow();
  });

  it("defaults to the foreground phase and reports it on the tick info", () => {
    const clock = new TestFrameClock();
    let observedPhase: string | undefined;
    clock.requestFrame((info) => {
      observedPhase = info.phase;
    });

    clock.tick();

    expect(clock.phase()).toBe("foreground");
    expect(observedPhase).toBe("foreground");
  });

  it("represents a hidden/background pacing state distinctly from foreground", () => {
    const clock = new TestFrameClock();
    clock.setPhase("background");

    let observedPhase: string | undefined;
    clock.requestFrame((info) => {
      observedPhase = info.phase;
    });
    clock.tick();

    expect(clock.phase()).toBe("background");
    expect(observedPhase).toBe("background");
  });

  it("advances its own deterministic timestamp on every tick, ticked or not", () => {
    const clock = new TestFrameClock(1_000);
    expect(clock.now()).toBe(1_000);

    clock.tick(16);
    expect(clock.now()).toBe(1_016);

    clock.requestFrame(() => {});
    clock.tick(16);
    expect(clock.now()).toBe(1_032);
  });

  it("passes the advanced timestamp through to the fired callback", () => {
    const clock = new TestFrameClock(500);
    let seenTimestamp = -1;
    clock.requestFrame((info) => {
      seenTimestamp = info.timestampMs;
    });

    clock.tick(16);

    expect(seenTimestamp).toBe(516);
  });

  it("satisfies the FrameClock interface with no DOM/React import (structural check)", () => {
    const clock: FrameClock = new TestFrameClock();
    expect(typeof clock.requestFrame).toBe("function");
    expect(typeof clock.cancelFrame).toBe("function");
    expect(typeof clock.phase).toBe("function");
  });
});
