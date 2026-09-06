import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDefaultAndroidProbe,
  createPollingNetworkReachability,
  type NetworkReachabilityProbe,
} from "./network-reachability.js";

/** Fake interval scheduler: `advance()` runs every still-registered callback once, synchronously — no real timers. */
function createFakeIntervalScheduler() {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  return {
    setInterval: (callback: () => void) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    clearInterval: (handle: number) => {
      callbacks.delete(handle);
    },
    advance: () => {
      for (const callback of [...callbacks.values()]) callback();
    },
    activeCount: () => callbacks.size,
  };
}

describe("PollingNetworkReachability", () => {
  it("does not probe before the first subscriber", async () => {
    const probe = vi.fn<NetworkReachabilityProbe>(() => Promise.resolve(true));
    createPollingNetworkReachability({ probe, setInterval: () => 1, clearInterval: () => {} });
    await Promise.resolve();
    expect(probe).not.toHaveBeenCalled();
  });

  it("probes immediately on first subscribe and starts the interval", async () => {
    const scheduler = createFakeIntervalScheduler();
    const probe = vi.fn<NetworkReachabilityProbe>(() => Promise.resolve(true));
    const network = createPollingNetworkReachability({
      probe,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
    });

    network.subscribe(() => {});
    await Promise.resolve();
    await Promise.resolve();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(scheduler.activeCount()).toBe(1);
  });

  it("publishes an online -> offline -> online transition, and getStatus() reflects it", async () => {
    const scheduler = createFakeIntervalScheduler();
    let reachable = true;
    const probe: NetworkReachabilityProbe = () => Promise.resolve(reachable);
    const network = createPollingNetworkReachability({
      probe,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
    });

    const seen: boolean[] = [];
    network.subscribe((status) => seen.push(status.online));
    await Promise.resolve();
    await Promise.resolve();

    reachable = false;
    scheduler.advance();
    await Promise.resolve();
    await Promise.resolve();

    reachable = true;
    scheduler.advance();
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toEqual([false, true]);
    await expect(network.getStatus()).resolves.toEqual({ online: true, kind: "unknown" });
  });

  it("does not publish when the probe result is unchanged", async () => {
    const scheduler = createFakeIntervalScheduler();
    const probe: NetworkReachabilityProbe = () => Promise.resolve(true);
    const network = createPollingNetworkReachability({
      probe,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
    });

    const listener = vi.fn();
    network.subscribe(listener);
    await Promise.resolve();
    await Promise.resolve();
    listener.mockClear();

    scheduler.advance();
    await Promise.resolve();
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops polling once the last subscriber unsubscribes", async () => {
    const scheduler = createFakeIntervalScheduler();
    const probe: NetworkReachabilityProbe = () => Promise.resolve(true);
    const network = createPollingNetworkReachability({
      probe,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
    });

    const unsubscribe = network.subscribe(() => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduler.activeCount()).toBe(1);

    unsubscribe();
    expect(scheduler.activeCount()).toBe(0);
  });

  it("treats a rejected/throwing probe as offline, not a crash", async () => {
    const scheduler = createFakeIntervalScheduler();
    const probe: NetworkReachabilityProbe = () => Promise.reject(new Error("network down"));
    const network = createPollingNetworkReachability({
      probe,
      setInterval: scheduler.setInterval,
      clearInterval: scheduler.clearInterval,
    });

    const seen: boolean[] = [];
    network.subscribe((status) => seen.push(status.online));
    await Promise.resolve();
    await Promise.resolve();

    expect(seen).toEqual([false]);
  });

  it("check() runs the probe on demand without waiting for the interval", async () => {
    const probe = vi.fn<NetworkReachabilityProbe>(() => Promise.resolve(false));
    const network = createPollingNetworkReachability({
      probe,
      setInterval: () => 1,
      clearInterval: () => {},
    });

    const status = await network.check();
    expect(status).toEqual({ online: false, kind: "none" });
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe("createDefaultAndroidProbe", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reports reachable without calling fetch when no probe URL is known", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const probe = createDefaultAndroidProbe(() => null);

    await expect(probe()).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("HEADs the current probe URL and reports true on a 2xx response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const probe = createDefaultAndroidProbe(() => "https://daemon.example:6767/");

    await expect(probe()).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("https://daemon.example:6767/", { method: "HEAD" });
  });

  it("treats a 405 (HEAD not allowed, but answered) as reachable", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 405 }) as unknown as typeof fetch;
    const probe = createDefaultAndroidProbe(() => "https://daemon.example:6767/");
    await expect(probe()).resolves.toBe(true);
  });

  it("reports false when fetch rejects (host unreachable)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const probe = createDefaultAndroidProbe(() => "https://daemon.example:6767/");
    await expect(probe()).resolves.toBe(false);
  });

  it("reports false on a real (non-405) error response", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    const probe = createDefaultAndroidProbe(() => "https://daemon.example:6767/");
    await expect(probe()).resolves.toBe(false);
  });
});
