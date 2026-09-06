import { describe, expect, it, vi } from "vitest";

import { createBrowserClock } from "./clock.js";

describe("createBrowserClock", () => {
  it("now() returns the current time in milliseconds", () => {
    const clock = createBrowserClock();
    const before = Date.now();
    const now = clock.now();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it("setTimeout/clearTimeout schedule and cancel work", async () => {
    vi.useFakeTimers();
    const clock = createBrowserClock();
    const callback = vi.fn();
    const handle = clock.setTimeout(callback, 1000);
    clock.clearTimeout(handle);
    vi.advanceTimersByTime(2000);
    expect(callback).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("setInterval/clearInterval schedule and cancel repeating work", () => {
    vi.useFakeTimers();
    const clock = createBrowserClock();
    const callback = vi.fn();
    const handle = clock.setInterval(callback, 100);
    vi.advanceTimersByTime(250);
    expect(callback).toHaveBeenCalledTimes(2);
    clock.clearInterval(handle);
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
