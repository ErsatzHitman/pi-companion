import { afterEach, describe, expect, it } from "vitest";

import { createDocumentVisibilityLifecycle } from "./lifecycle.js";

/**
 * Tests for the web `AppLifecycle` adapter (T46A3, plan.md §7.3/§7.4).
 *
 * `document.visibilityState` is normally read-only; these tests stub it
 * with a configurable property so `visibilitychange` can be simulated the
 * way a real backgrounded tab or minimized window would fire it.
 */
function setVisibilityState(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("createDocumentVisibilityLifecycle", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(document, "visibilityState", originalDescriptor);
    }
  });

  it('getState() maps a visible document to "active"', () => {
    setVisibilityState("visible");
    const lifecycle = createDocumentVisibilityLifecycle();
    expect(lifecycle.getState()).toBe("active");
  });

  it('getState() maps a hidden document to "background"', () => {
    setVisibilityState("hidden");
    const lifecycle = createDocumentVisibilityLifecycle();
    expect(lifecycle.getState()).toBe("background");
  });

  it('never reports "inactive": that state is reserved for platforms with a true intermediate state', () => {
    setVisibilityState("visible");
    const lifecycle = createDocumentVisibilityLifecycle();
    expect(lifecycle.getState()).not.toBe("inactive");
    setVisibilityState("hidden");
    expect(lifecycle.getState()).not.toBe("inactive");
  });

  it("subscribe() notifies the listener with the new state on visibilitychange", () => {
    setVisibilityState("visible");
    const lifecycle = createDocumentVisibilityLifecycle();
    const seen: string[] = [];
    const unsubscribe = lifecycle.subscribe((state) => seen.push(state));

    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(seen).toEqual(["background", "active"]);
    unsubscribe();
  });

  it("subscribe() fires synchronously off the browser event, so a resume is observable within the same tick", () => {
    setVisibilityState("hidden");
    const lifecycle = createDocumentVisibilityLifecycle();
    let observedAt: number | null = null;
    const startedAt = Date.now();
    const unsubscribe = lifecycle.subscribe(() => {
      observedAt = Date.now();
    });

    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(observedAt).not.toBeNull();
    expect((observedAt as unknown as number) - startedAt).toBeLessThan(1000);
    unsubscribe();
  });

  it("unsubscribe() stops further notifications", () => {
    setVisibilityState("visible");
    const lifecycle = createDocumentVisibilityLifecycle();
    const seen: string[] = [];
    const unsubscribe = lifecycle.subscribe((state) => seen.push(state));
    unsubscribe();

    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(seen).toEqual([]);
  });

  it("supports multiple independent subscribers", () => {
    setVisibilityState("visible");
    const lifecycle = createDocumentVisibilityLifecycle();
    const a: string[] = [];
    const b: string[] = [];
    const unsubA = lifecycle.subscribe((state) => a.push(state));
    const unsubB = lifecycle.subscribe((state) => b.push(state));

    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(a).toEqual(["background"]);
    expect(b).toEqual(["background"]);
    unsubA();
    unsubB();
  });
});
