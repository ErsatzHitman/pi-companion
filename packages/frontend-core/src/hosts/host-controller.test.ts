import { describe, expect, it } from "vitest";
import type { DaemonClientLifecycleConfig } from "../connection/daemon-client-lifecycle.js";
import { EMPTY_FEATURE_GATE_SNAPSHOT } from "../connection/feature-gates.js";
import type { HostControllerLifecycleLike } from "./host-controller.js";
import { HostController } from "./host-controller.js";
import { FakeClock } from "./test-support/fake-clock.js";
import {
  FakeNetworkReachability,
  InMemorySecureStorage,
  InMemoryStructuredStorage,
} from "./test-support/fakes.js";
import type { HostProfile } from "./types.js";

/**
 * A manually-driven `HostControllerLifecycleLike` double, standing in
 * for `DaemonClientLifecycle` so these tests exercise `HostController`'s
 * own probing/reconnect/relay-switch bookkeeping without a real
 * `@picompanion/client` transport (that machinery is `DaemonClientLifecycle`'s
 * own tests' job — see `daemon-client-lifecycle.test.ts`).
 */
class FakeHostLifecycle implements HostControllerLifecycleLike {
  connectCalls = 0;
  disconnectCalls = 0;
  disposeCalls = 0;
  private status: "idle" | "connecting" | "connected" | "disconnected" | "disposed" = "idle";
  private readonly statusListeners = new Set<(status: FakeHostLifecycle["status"]) => void>();

  constructor(
    public readonly config: DaemonClientLifecycleConfig,
    private readonly onConnect: (self: FakeHostLifecycle) => "connect" | "fail" = () => "connect",
  ) {}

  async connect(): Promise<void> {
    this.connectCalls += 1;
    const outcome = this.onConnect(this);
    if (outcome === "fail") {
      this.setStatus("disconnected");
      throw new Error("connect failed");
    }
    this.setStatus("connected");
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.setStatus("disconnected");
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
    this.setStatus("disposed");
  }

  getStatus() {
    return this.status;
  }

  subscribeStatus(listener: (status: FakeHostLifecycle["status"]) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  subscribeEvents(): () => void {
    return () => {};
  }

  subscribeFeatureGates(
    listener: (snapshot: typeof EMPTY_FEATURE_GATE_SNAPSHOT) => void,
  ): () => void {
    listener(EMPTY_FEATURE_GATE_SNAPSHOT);
    return () => {};
  }

  getFeatureGates() {
    return EMPTY_FEATURE_GATE_SNAPSHOT;
  }

  isFeatureEnabled(): boolean {
    return false;
  }

  getDaemonClient() {
    return null;
  }

  simulateDisconnected(): void {
    this.setStatus("disconnected");
  }

  private setStatus(status: FakeHostLifecycle["status"]): void {
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}

/** Drains a handful of microtask turns so chained `await`s inside `HostController`'s reconnect path (teardown -> probe -> connect -> record outcome) settle before assertions run. */
async function flush(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

const bothConfigured: HostProfile = {
  id: "host_1",
  label: "Both",
  preferDirect: true,
  direct: { endpoint: "localhost:6767", useTls: false },
  relay: {
    endpoint: "relay.paseo.sh:443",
    useTls: true,
    serverId: "srv_1",
    daemonPublicKeyB64: "k",
  },
  createdAt: 0,
  updatedAt: 0,
  lastConnectedAt: null,
  lastConnectionKind: null,
};

function makeController(
  overrides: {
    reachable?: (url: string) => boolean;
    reconnect?: { baseDelayMs?: number; maxDelayMs?: number; maxAttemptsPerKind?: number };
    onConnect?: (self: FakeHostLifecycle) => "connect" | "fail";
  } = {},
) {
  const clock = new FakeClock();
  const storage = new InMemoryStructuredStorage();
  const secrets = new InMemorySecureStorage();
  const network = new FakeNetworkReachability();
  const lifecycles: FakeHostLifecycle[] = [];
  const reachable = overrides.reachable ?? (() => true);

  const controller = new HostController({
    clientId: "clid_test",
    clientType: "browser",
    storage,
    secrets,
    network,
    clock,
    probe: async (url) => {
      if (!reachable(url)) throw new Error(`unreachable: ${url}`);
    },
    ...(overrides.reconnect !== undefined ? { reconnect: overrides.reconnect } : {}),
    createLifecycle: (config) => {
      const fake = new FakeHostLifecycle(config, overrides.onConnect);
      lifecycles.push(fake);
      return fake;
    },
  });

  return { controller, clock, storage, secrets, network, lifecycles };
}

describe("HostController", () => {
  it("connects using the direct target when it is reachable", async () => {
    const { controller, lifecycles } = makeController();
    const result = await controller.connectToProfile(bothConfigured);
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("direct");
    expect(lifecycles).toHaveLength(1);
    expect(lifecycles[0]?.config.url).toBe("ws://localhost:6767/ws");
    expect(controller.getCurrentKind()).toBe("direct");
  });

  it("falls back to relay when direct is unreachable, deterministically", async () => {
    const { controller, lifecycles } = makeController({
      reachable: (url) => url.includes("relay.paseo.sh"),
    });
    const result = await controller.connectToProfile(bothConfigured);
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("relay");
    expect(lifecycles).toHaveLength(1);
    expect(new URL(lifecycles[0]!.config.url).searchParams.get("role")).toBe("client");
    expect(controller.getCurrentKind()).toBe("relay");
  });

  it("reports failure without constructing a lifecycle when nothing is reachable", async () => {
    const { controller, lifecycles } = makeController({ reachable: () => false });
    const result = await controller.connectToProfile(bothConfigured);
    expect(result.ok).toBe(false);
    expect(result.kind).toBeNull();
    expect(result.attempts).toHaveLength(2);
    expect(lifecycles).toHaveLength(0);
    expect(controller.getCurrentKind()).toBeNull();
  });

  it("records the successful connection outcome on the host profile", async () => {
    const { controller, storage, clock } = makeController();
    clock.advance(42);
    await controller.connectToProfile(bothConfigured);
    const stored = await storage.get<HostProfile>("hosts.profiles", bothConfigured.id);
    // connectToProfile is given a profile object directly (not necessarily
    // already saved) — recordConnectionOutcome is a no-op when the store
    // has no record for that id yet, which is expected: profile
    // persistence itself is the caller's job via `controller.profiles`.
    expect(stored).toBeNull();

    await controller.profiles.save({
      id: bothConfigured.id,
      label: bothConfigured.label,
      direct: bothConfigured.direct,
    });
    await controller.connectToProfile(bothConfigured);
    const afterSave = await storage.get<HostProfile>("hosts.profiles", bothConfigured.id);
    expect(afterSave?.lastConnectionKind).toBe("direct");
  });

  it("schedules a reconnect with exponential backoff after an unexpected disconnect", async () => {
    const { controller, clock, lifecycles } = makeController({
      reconnect: { baseDelayMs: 1000, maxAttemptsPerKind: 100 },
    });
    await controller.connectToProfile(bothConfigured);
    expect(lifecycles).toHaveLength(1);

    lifecycles[0]!.simulateDisconnected();
    expect(controller.getConnectionInfo().status).toBe("reconnect-pending");
    expect(lifecycles).toHaveLength(1); // not yet reconnected

    clock.advance(999);
    expect(lifecycles).toHaveLength(1);
    clock.advance(1);
    await flush();
    expect(lifecycles).toHaveLength(2);
    expect(lifecycles[1]?.config.url).toBe(lifecycles[0]?.config.url);
  });

  it("switches to the alternate kind after enough consecutive failures on one kind (relay-switch path)", async () => {
    let createdCount = 0;
    const { controller, clock, lifecycles } = makeController({
      reconnect: { baseDelayMs: 10, maxDelayMs: 10, maxAttemptsPerKind: 2 },
      // The 2nd lifecycle created (the first automatic reconnect attempt)
      // fails outright, so two consecutive direct failures happen without
      // an intervening success: the established connection dropping, then
      // the reconnect attempt itself failing.
      onConnect: () => {
        createdCount += 1;
        return createdCount === 2 ? "fail" : "connect";
      },
    });
    await controller.connectToProfile(bothConfigured);
    expect(controller.getCurrentKind()).toBe("direct");

    // The established connection drops unexpectedly: 1st consecutive
    // failure on "direct" (< maxAttemptsPerKind 2), so the next attempt
    // still targets direct.
    lifecycles[0]!.simulateDisconnected();
    clock.advance(10);
    await flush();
    expect(lifecycles).toHaveLength(2);
    expect(lifecycles[1]?.config.url).toBe("ws://localhost:6767/ws");

    // That reconnect attempt (lifecycles[1]) fails outright, which is the
    // 2nd consecutive direct failure and reaches maxAttemptsPerKind on its
    // own — no extra manual step needed, since the fake's synchronous
    // failure already scheduled the next reconnect targeting relay.
    clock.advance(10);
    await flush();
    expect(lifecycles).toHaveLength(3);
    expect(controller.getCurrentKind()).toBe("relay");
    expect(new URL(lifecycles[2]!.config.url).searchParams.get("role")).toBe("client");
  });

  it("does not schedule a reconnect after a manual disconnect()", async () => {
    const { controller, clock, lifecycles } = makeController({
      reconnect: { baseDelayMs: 100 },
    });
    await controller.connectToProfile(bothConfigured);
    await controller.disconnect();
    expect(lifecycles[0]?.disconnectCalls).toBe(1);

    clock.advance(100_000);
    await flush();
    expect(lifecycles).toHaveLength(1);
    expect(controller.getConnectionInfo().status).toBe("idle");
  });

  it("pauses reconnect scheduling while offline and retries immediately once back online", async () => {
    const { controller, clock, lifecycles, network } = makeController({
      reconnect: { baseDelayMs: 1000 },
    });
    await controller.connectToProfile(bothConfigured);

    network.setOnline(false);
    lifecycles[0]!.simulateDisconnected();
    expect(controller.getConnectionInfo().status).toBe("offline");

    clock.advance(100_000);
    await flush();
    expect(lifecycles).toHaveLength(1); // no reconnect attempted while offline

    network.setOnline(true);
    await flush();
    expect(lifecycles).toHaveLength(2); // reconnected immediately on network recovery
  });

  it("T54A3: reports the connection as offline the instant NetworkReachability reports offline, without waiting for the socket to notice", async () => {
    const { controller, lifecycles, network } = makeController({
      reconnect: { baseDelayMs: 1000 },
    });
    await controller.connectToProfile(bothConfigured);
    expect(controller.getConnectionInfo().status).toBe("connected");

    const seen: string[] = [];
    controller.subscribeConnectionInfo((info) => {
      seen.push(info.status);
    });
    seen.length = 0; // drop the synchronous replay of the current status

    network.setOnline(false);

    // No `simulateDisconnected()` here: the underlying lifecycle still
    // reports "connected" (the socket hasn't noticed anything yet) --
    // this must come from the browser signal alone, same tick, not from a
    // reconnect attempt or the liveness heartbeat.
    expect(lifecycles[0]!.getStatus()).toBe("connected");
    expect(controller.getConnectionInfo().status).toBe("offline");
    expect(seen).toEqual(["offline"]);
  });

  it("T54A3: cancels an already-scheduled reconnect attempt when the network drops out from under it", async () => {
    const { controller, clock, lifecycles, network } = makeController({
      reconnect: { baseDelayMs: 1000 },
      onConnect: () => "fail",
    });
    await controller.connectToProfile(bothConfigured).catch(() => {});
    // The initial connect attempt fails outright in this fixture, which
    // (per `handleLifecycleStatus`) already schedules an automatic
    // reconnect.
    expect(controller.getConnectionInfo().status).toBe("reconnect-pending");

    network.setOnline(false);
    expect(controller.getConnectionInfo().status).toBe("offline");

    // The cancelled timer must not still fire later and attempt to
    // connect into a network we now know is down.
    const before = lifecycles.length;
    clock.advance(100_000);
    await flush();
    expect(lifecycles).toHaveLength(before);
  });

  it("dispose() tears down the lifecycle, stops reconnects, and unsubscribes from network status", async () => {
    const { controller, clock, lifecycles, network } = makeController({
      reconnect: { baseDelayMs: 100 },
    });
    await controller.connectToProfile(bothConfigured);
    expect(network.listenerCount()).toBe(1);

    await controller.dispose();
    expect(lifecycles[0]?.disposeCalls).toBe(1);
    expect(network.listenerCount()).toBe(0);

    clock.advance(100_000);
    await flush();
    expect(lifecycles).toHaveLength(1);

    await expect(controller.connectToProfile(bothConfigured)).rejects.toThrow(/disposed/i);
  });

  it("subscribeConnectionInfo replays the current status immediately and reflects later status changes", async () => {
    const { controller, lifecycles } = makeController();
    const seen: string[] = [];
    controller.subscribeConnectionInfo((info) => seen.push(info.status));
    expect(seen).toEqual(["idle"]);

    await controller.connectToProfile(bothConfigured);
    // "probing" while selecting a target, then the freshly-wired (but not
    // yet connected) lifecycle synchronously reporting its still-"idle"
    // status once, then "connected" once `connect()` settles.
    expect(seen).toEqual(["idle", "probing", "idle", "connected"]);

    lifecycles[0]!.simulateDisconnected();
    expect(seen.at(-1)).toBe("reconnect-pending");
  });
});
