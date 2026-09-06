/**
 * Tests for T32P1's real, kind-reporting `NetworkReachability` adapter.
 *
 * Two layers:
 * - `mapNetInfoStateToNetworkStatus` / `NativeNetworkReachability`
 *   against a scripted fake `NetInfoModule` — no `react-native` import
 *   anywhere in this file, so plain `vitest` loads it directly.
 * - an end-to-end proof that a Wi-Fi -> cellular reading, run through
 *   this adapter and `../app-shell/resume-signals.ts`'s
 *   `attachResumeSignals()`, reaches a **real**
 *   `connection.ResumeController` from `@picompanion/frontend-core` and
 *   actually invokes its `reconcile()` — not a stand-in target, and not
 *   just the coalescer's own decision (which `resume-signals.test.ts`
 *   already covers against a hand-fed `NetworkStatus`; this proves this
 *   adapter itself produces that same real transition from a native
 *   reading).
 */
import { describe, expect, it, vi } from "vitest";

import type { AppLifecycle, Clock, TimerHandle } from "@picompanion/frontend-core";
import { connection as coreConnection, timeline as coreTimeline } from "@picompanion/frontend-core";

import { attachResumeSignals } from "../app-shell/resume-signals";
import {
  createNativeNetworkReachability,
  mapNetInfoStateToNetworkStatus,
  NativeNetworkReachability,
  type NetInfoModule,
  type NetInfoState,
} from "./native-network-reachability";

// ---------------------------------------------------------------------------
// mapNetInfoStateToNetworkStatus
// ---------------------------------------------------------------------------

describe("mapNetInfoStateToNetworkStatus", () => {
  it("maps a connected Wi-Fi reading", () => {
    const state: NetInfoState = { type: "wifi", isConnected: true, isInternetReachable: true };
    expect(mapNetInfoStateToNetworkStatus(state)).toEqual({ online: true, kind: "wifi" });
  });

  it("maps a connected cellular reading", () => {
    const state: NetInfoState = { type: "cellular", isConnected: true, isInternetReachable: true };
    expect(mapNetInfoStateToNetworkStatus(state)).toEqual({ online: true, kind: "cellular" });
  });

  it("maps a connected ethernet reading", () => {
    const state: NetInfoState = { type: "ethernet", isConnected: true, isInternetReachable: true };
    expect(mapNetInfoStateToNetworkStatus(state)).toEqual({ online: true, kind: "ethernet" });
  });

  it("treats isInternetReachable: null (still determining) as trusting isConnected", () => {
    const state: NetInfoState = { type: "cellular", isConnected: true, isInternetReachable: null };
    expect(mapNetInfoStateToNetworkStatus(state)).toEqual({ online: true, kind: "cellular" });
  });

  it("treats a missing isInternetReachable the same as null", () => {
    const state: NetInfoState = { type: "wifi", isConnected: true };
    expect(mapNetInfoStateToNetworkStatus(state)).toEqual({ online: true, kind: "wifi" });
  });

  it("reports offline for a captive-portal Wi-Fi (connected, but internet unreachable)", () => {
    const state: NetInfoState = { type: "wifi", isConnected: true, isInternetReachable: false };
    expect(mapNetInfoStateToNetworkStatus(state)).toEqual({ online: false, kind: "wifi" });
  });

  it("maps type: none to offline regardless of isConnected", () => {
    const state: NetInfoState = { type: "none", isConnected: false };
    expect(mapNetInfoStateToNetworkStatus(state)).toEqual({ online: false, kind: "none" });
  });

  it("treats isConnected: null as not confirmed online", () => {
    const state: NetInfoState = { type: "wifi", isConnected: null };
    expect(mapNetInfoStateToNetworkStatus(state)).toEqual({ online: false, kind: "wifi" });
  });

  it.each(["bluetooth", "wimax", "vpn", "other", "unknown"] as const)(
    "maps netinfo type %s to kind unknown",
    (type) => {
      const state: NetInfoState = { type, isConnected: true, isInternetReachable: true };
      expect(mapNetInfoStateToNetworkStatus(state)).toEqual({ online: true, kind: "unknown" });
    },
  );
});

// ---------------------------------------------------------------------------
// NativeNetworkReachability
// ---------------------------------------------------------------------------

function createFakeNetInfoModule(initial: NetInfoState) {
  let current = initial;
  const listeners = new Set<(state: NetInfoState) => void>();
  const module: NetInfoModule = {
    fetch: () => Promise.resolve(current),
    addEventListener: (listener) => {
      listeners.add(listener);
      // Mirrors the real library: fires immediately with the current state.
      listener(current);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    module,
    emit: (state: NetInfoState) => {
      current = state;
      for (const listener of listeners) listener(state);
    },
    listenerCount: () => listeners.size,
  };
}

const WIFI_STATE: NetInfoState = { type: "wifi", isConnected: true, isInternetReachable: true };
const CELLULAR_STATE: NetInfoState = {
  type: "cellular",
  isConnected: true,
  isInternetReachable: true,
};
const NONE_STATE: NetInfoState = { type: "none", isConnected: false };

describe("NativeNetworkReachability", () => {
  it("getStatus() fetches and maps the native module's current reading", async () => {
    const fake = createFakeNetInfoModule(WIFI_STATE);
    const network = createNativeNetworkReachability(fake.module);
    await expect(network.getStatus()).resolves.toEqual({ online: true, kind: "wifi" });
  });

  it("does not register a native listener before the first subscriber", () => {
    const fake = createFakeNetInfoModule(WIFI_STATE);
    createNativeNetworkReachability(fake.module);
    expect(fake.listenerCount()).toBe(0);
  });

  it("publishes the current reading immediately on subscribe", () => {
    const fake = createFakeNetInfoModule(WIFI_STATE);
    const network = createNativeNetworkReachability(fake.module);
    const seen: Array<{ online: boolean; kind: string }> = [];
    network.subscribe((status) => seen.push(status));
    expect(seen).toEqual([{ online: true, kind: "wifi" }]);
  });

  it("publishes a Wi-Fi -> cellular kind change while staying online", () => {
    const fake = createFakeNetInfoModule(WIFI_STATE);
    const network = createNativeNetworkReachability(fake.module);
    const seen: Array<{ online: boolean; kind: string }> = [];
    network.subscribe((status) => seen.push(status));

    fake.emit(CELLULAR_STATE);

    expect(seen).toEqual([
      { online: true, kind: "wifi" },
      { online: true, kind: "cellular" },
    ]);
  });

  it("publishes an online -> offline transition", () => {
    const fake = createFakeNetInfoModule(WIFI_STATE);
    const network = createNativeNetworkReachability(fake.module);
    const seen: Array<{ online: boolean; kind: string }> = [];
    network.subscribe((status) => seen.push(status));

    fake.emit(NONE_STATE);

    expect(seen).toEqual([
      { online: true, kind: "wifi" },
      { online: false, kind: "none" },
    ]);
  });

  it("does not publish when the reading is unchanged", () => {
    const fake = createFakeNetInfoModule(WIFI_STATE);
    const network = createNativeNetworkReachability(fake.module);
    const listener = vi.fn();
    network.subscribe(listener);
    listener.mockClear();

    fake.emit({ ...WIFI_STATE });

    expect(listener).not.toHaveBeenCalled();
  });

  it("shares one native subscription across multiple listeners and unsubscribes only once the last one leaves", () => {
    const fake = createFakeNetInfoModule(WIFI_STATE);
    const network = createNativeNetworkReachability(fake.module);
    const unsubscribeA = network.subscribe(() => {});
    const unsubscribeB = network.subscribe(() => {});
    expect(fake.listenerCount()).toBe(1);
    expect(network.subscriberCount()).toBe(2);

    unsubscribeA();
    expect(fake.listenerCount()).toBe(1);
    unsubscribeB();
    expect(fake.listenerCount()).toBe(0);
  });

  it("re-registers a native listener on a second subscribe after the first fully unsubscribed", () => {
    const fake = createFakeNetInfoModule(WIFI_STATE);
    const network = createNativeNetworkReachability(fake.module);
    network.subscribe(() => {})();
    expect(fake.listenerCount()).toBe(0);

    const seen: Array<{ online: boolean; kind: string }> = [];
    network.subscribe((status) => seen.push(status));
    expect(fake.listenerCount()).toBe(1);
    expect(seen).toEqual([{ online: true, kind: "wifi" }]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: adapter -> attachResumeSignals -> a real ResumeController
// ---------------------------------------------------------------------------

/** Minimal, file-local `Clock`: this task owns `platform/`, not
 * `connection/resume-controller.ts`, so `ResumeController`'s own
 * `resume-controller.test.ts` keeps the fuller fake; this one only needs
 * to satisfy the constructor since the periodic-check path is never
 * exercised here. */
function createInertClock(): Clock {
  let nextHandle = 1;
  return {
    now: () => 0,
    setTimeout: () => nextHandle++ as unknown as TimerHandle,
    clearTimeout: () => {},
    setInterval: () => nextHandle++ as unknown as TimerHandle,
    clearInterval: () => {},
  };
}

/** Always-foregrounded `AppLifecycle` stand-in, so the only resume
 * signal this test can raise comes from the network side. */
function createAlwaysActiveLifecycle(): AppLifecycle {
  return {
    getState: () => "active",
    subscribe: () => () => {},
  };
}

describe("end-to-end: NativeNetworkReachability -> attachResumeSignals -> a real ResumeController", () => {
  it("a Wi-Fi -> cellular reading from the adapter triggers a real reconcile() call", async () => {
    const fake = createFakeNetInfoModule(WIFI_STATE);
    const network: NativeNetworkReachability = createNativeNetworkReachability(fake.module);

    const reconcileCalls: Array<coreConnection.ResumeTrigger> = [];
    const reconcile: coreConnection.ResumeReconcile = async (trigger) => {
      reconcileCalls.push(trigger);
    };

    const controller = new coreConnection.ResumeController({
      runGeneration: new coreTimeline.RunGenerationTracker(),
      clock: createInertClock(),
      reconcile,
      // Deliberately omitted: lifecycle/network. The only route from the
      // native reading to reconcile() must be attachResumeSignals() below
      // — exactly the property `../app-shell/resume-signals.ts` exists to
      // provide (see that module's doc comment).
    });

    const dispose = attachResumeSignals({
      lifecycle: createAlwaysActiveLifecycle(),
      network,
      target: controller,
    });

    // The immediate wifi reading on subscribe only seeds the coalescer's
    // baseline (first observation); it must not itself reconcile.
    await Promise.resolve();
    expect(reconcileCalls).toEqual([]);

    fake.emit(CELLULAR_STATE);
    // Let the coalescer's "emit" plan and the controller's async
    // reconcile() promise both settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(reconcileCalls).toEqual(["resume-signal"]);

    dispose();
    controller.dispose();
  });

  it("a Wi-Fi -> offline -> Wi-Fi round trip through the adapter also reconciles on the regain", async () => {
    const fake = createFakeNetInfoModule(WIFI_STATE);
    const network: NativeNetworkReachability = createNativeNetworkReachability(fake.module);

    const reconcileCalls: Array<coreConnection.ResumeTrigger> = [];
    const reconcile: coreConnection.ResumeReconcile = async (trigger) => {
      reconcileCalls.push(trigger);
    };

    const controller = new coreConnection.ResumeController({
      runGeneration: new coreTimeline.RunGenerationTracker(),
      clock: createInertClock(),
      reconcile,
    });

    const dispose = attachResumeSignals({
      lifecycle: createAlwaysActiveLifecycle(),
      network,
      target: controller,
    });
    await Promise.resolve();

    fake.emit(NONE_STATE);
    await Promise.resolve();
    expect(reconcileCalls).toEqual([]); // going offline is never a resume signal

    fake.emit(WIFI_STATE);
    await Promise.resolve();
    await Promise.resolve();
    expect(reconcileCalls).toEqual(["resume-signal"]);

    dispose();
    controller.dispose();
  });
});
