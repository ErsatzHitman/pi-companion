import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBrowserFrameClock } from "./frame-clock.js";

/** `Object.defineProperty` is required because `document.hidden` is a
 * getter-only property on the real `Document` prototype in jsdom; a plain
 * assignment (`document.hidden = true`) silently no-ops instead of
 * throwing, which would make a bug here fail confusingly rather than
 * fail loudly. */
function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
}

describe("createBrowserFrameClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDocumentHidden(false);
  });

  afterEach(() => {
    setDocumentHidden(false);
    vi.useRealTimers();
  });

  it("reports foreground when the document is visible and background when hidden", () => {
    const clock = createBrowserFrameClock();
    expect(clock.phase()).toBe("foreground");

    setDocumentHidden(true);
    expect(clock.phase()).toBe("background");
  });

  it("schedules a foreground callback on requestAnimationFrame and reports phase foreground", () => {
    const clock = createBrowserFrameClock();
    const callback = vi.fn();

    clock.requestFrame(callback);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toMatchObject({ phase: "foreground" });
  });

  it("falls back to a timer cadence while the document is hidden instead of requestAnimationFrame", () => {
    setDocumentHidden(true);
    const clock = createBrowserFrameClock();
    const callback = vi.fn();

    clock.requestFrame(callback);

    // requestAnimationFrame's usual ~16ms cadence must not fire this: the
    // hidden-tab fallback uses a slower, explicit timer instead.
    vi.advanceTimersByTime(16);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toMatchObject({ phase: "background" });
  });

  it("holds at most one pending callback: a second requestFrame call replaces the first", () => {
    const clock = createBrowserFrameClock();
    const first = vi.fn();
    const second = vi.fn();

    clock.requestFrame(first);
    clock.requestFrame(second);
    vi.advanceTimersByTime(16);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("cancelFrame cancels a pending requestAnimationFrame callback", () => {
    const clock = createBrowserFrameClock();
    const callback = vi.fn();

    clock.requestFrame(callback);
    clock.cancelFrame();
    vi.advanceTimersByTime(1000);

    expect(callback).not.toHaveBeenCalled();
  });

  it("cancelFrame cancels a pending fallback timer callback", () => {
    setDocumentHidden(true);
    const clock = createBrowserFrameClock();
    const callback = vi.fn();

    clock.requestFrame(callback);
    clock.cancelFrame();
    vi.advanceTimersByTime(5000);

    expect(callback).not.toHaveBeenCalled();
  });

  it("cancelFrame is a safe no-op when nothing is pending", () => {
    const clock = createBrowserFrameClock();
    expect(() => {
      clock.cancelFrame();
    }).not.toThrow();
  });

  it("re-schedules a still-pending callback onto the fallback timer when the tab is backgrounded mid-flight", () => {
    const clock = createBrowserFrameClock();
    const callback = vi.fn();

    clock.requestFrame(callback);
    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));

    // The original rAF tick must no longer fire it...
    vi.advanceTimersByTime(16);
    expect(callback).not.toHaveBeenCalled();

    // ...but the fallback cadence still delivers exactly one call.
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toMatchObject({ phase: "background" });
  });

  it("re-schedules a still-pending callback onto requestAnimationFrame when the tab is foregrounded mid-flight", () => {
    setDocumentHidden(true);
    const clock = createBrowserFrameClock();
    const callback = vi.fn();

    clock.requestFrame(callback);
    setDocumentHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));

    // Fast rAF cadence now delivers it well before the old background timer would have.
    vi.advanceTimersByTime(16);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0]).toMatchObject({ phase: "foreground" });
  });

  it("a visibilitychange event with nothing pending does not schedule or throw", () => {
    const clock = createBrowserFrameClock();
    expect(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(5000);
    }).not.toThrow();
    void clock;
  });

  it("fires only once per requestFrame call, even across a visibilitychange", () => {
    const clock = createBrowserFrameClock();
    const callback = vi.fn();

    clock.requestFrame(callback);
    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    setDocumentHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(1000);

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
