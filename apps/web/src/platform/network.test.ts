import { afterEach, describe, expect, it } from "vitest";

import { createBrowserNetworkReachability } from "./network.js";

/**
 * Tests for the web `NetworkReachability` adapter (T54A3, plan.md §7.3/
 * §7.4). `navigator.onLine` is normally read-only; these tests stub it
 * with a configurable property so `online`/`offline` can be simulated
 * the way a real browser fires them, and dispatch those events on
 * `window` (not a fake emitter) so this proves the real listener wiring
 * this adapter installs.
 *
 * This adapter is what `daemon-client-context.tsx`'s `createWebPlatform()`
 * feeds into `hosts.HostController` as `NetworkReachability` (see
 * `host-controller.ts`'s own `handleNetworkStatus`, T54A3's other half):
 * these tests exist to prove the browser-facing half in isolation, since
 * `host-controller.test.ts` only exercises it through a fake double.
 */
function setOnLine(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

describe("createBrowserNetworkReachability", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(window.navigator, "onLine", originalDescriptor);
    } else {
      delete (window.navigator as { onLine?: boolean }).onLine;
    }
  });

  it("getStatus() reflects navigator.onLine", async () => {
    setOnLine(true);
    const network = createBrowserNetworkReachability();
    await expect(network.getStatus()).resolves.toEqual({ online: true, kind: "unknown" });

    setOnLine(false);
    await expect(network.getStatus()).resolves.toEqual({ online: false, kind: "none" });
  });

  it('subscribe() notifies the listener on a real window "offline" event, synchronously off the event', () => {
    setOnLine(true);
    const network = createBrowserNetworkReachability();
    const seen: boolean[] = [];
    const startedAt = Date.now();
    let observedAt: number | null = null;
    const unsubscribe = network.subscribe((status) => {
      seen.push(status.online);
      observedAt = Date.now();
    });

    setOnLine(false);
    window.dispatchEvent(new Event("offline"));

    expect(seen).toEqual([false]);
    expect(observedAt).not.toBeNull();
    expect((observedAt as unknown as number) - startedAt).toBeLessThan(1000);
    unsubscribe();
  });

  it('subscribe() notifies the listener on a real window "online" event', () => {
    setOnLine(false);
    const network = createBrowserNetworkReachability();
    const seen: boolean[] = [];
    const unsubscribe = network.subscribe((status) => seen.push(status.online));

    setOnLine(true);
    window.dispatchEvent(new Event("online"));

    expect(seen).toEqual([true]);
    unsubscribe();
  });

  it('kind reports "none" while offline regardless of the Network Information API', () => {
    setOnLine(false);
    const network = createBrowserNetworkReachability();
    const seen: Array<{ online: boolean; kind: string }> = [];
    const unsubscribe = network.subscribe((status) => seen.push(status));

    window.dispatchEvent(new Event("offline"));

    expect(seen).toEqual([{ online: false, kind: "none" }]);
    unsubscribe();
  });

  it("unsubscribe() removes both the online and offline listeners, leaking nothing across route changes", () => {
    setOnLine(true);
    const network = createBrowserNetworkReachability();
    const seen: boolean[] = [];
    const unsubscribe = network.subscribe((status) => seen.push(status.online));
    unsubscribe();

    setOnLine(false);
    window.dispatchEvent(new Event("offline"));
    setOnLine(true);
    window.dispatchEvent(new Event("online"));

    expect(seen).toEqual([]);
  });

  it("supports multiple independent subscribers", () => {
    setOnLine(true);
    const network = createBrowserNetworkReachability();
    const a: boolean[] = [];
    const b: boolean[] = [];
    const unsubA = network.subscribe((status) => a.push(status.online));
    const unsubB = network.subscribe((status) => b.push(status.online));

    setOnLine(false);
    window.dispatchEvent(new Event("offline"));

    expect(a).toEqual([false]);
    expect(b).toEqual([false]);
    unsubA();
    unsubB();
  });
});
