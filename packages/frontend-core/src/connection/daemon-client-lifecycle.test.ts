import { describe, expect, it } from "vitest";
import type { ConnectionState, DaemonClientConfig } from "@picompanion/client";
import type { ServerInfoStatusPayload } from "@picompanion/protocol/messages";
import {
  DaemonClientLifecycle,
  type DaemonClientLike,
  type DaemonEventHandler,
} from "./daemon-client-lifecycle.js";
import { EMPTY_FEATURE_GATE_SNAPSHOT } from "./feature-gates.js";

/**
 * A fully in-memory `DaemonClientLike` double, driven manually by tests
 * (`simulateServerInfo`, `emitEvent`, `simulateDisconnectedByPeer`). Used
 * to test `DaemonClientLifecycle`'s own bookkeeping in isolation from
 * `@picompanion/client`'s real hello/reconnect machinery, which the
 * fixture-driven test in `daemon-client-lifecycle.fixture.test.ts`
 * exercises directly instead.
 */
class FakeDaemonClient implements DaemonClientLike {
  connectCalls = 0;
  closeCalls = 0;
  private state: ConnectionState = { status: "idle" };
  private serverInfo: ServerInfoStatusPayload | null = null;
  private readonly statusListeners = new Set<(state: ConnectionState) => void>();
  private readonly eventHandlers = new Set<DaemonEventHandler>();

  constructor(public readonly config: DaemonClientConfig) {}

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.setState({ status: "connecting", attempt: 0 });
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.setState({ status: "disposed" });
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }

  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.state);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  subscribe(handler: DaemonEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  getLastServerInfoMessage(): ServerInfoStatusPayload | null {
    return this.serverInfo;
  }

  simulateServerInfo(serverInfo: ServerInfoStatusPayload): void {
    this.serverInfo = serverInfo;
    this.setState({ status: "connected" });
  }

  simulateDisconnectedByPeer(reason: string): void {
    this.setState({ status: "disconnected", reason });
  }

  emitEvent(event: Parameters<DaemonEventHandler>[0]): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  statusListenerCount(): number {
    return this.statusListeners.size;
  }

  eventListenerCount(): number {
    return this.eventHandlers.size;
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.statusListeners) {
      listener(state);
    }
  }
}

function makeServerInfo(overrides: Partial<ServerInfoStatusPayload> = {}): ServerInfoStatusPayload {
  return {
    status: "server_info",
    serverId: "srv_test_0001",
    hostname: "test-daemon",
    version: "0.0.0-test",
    desktopManaged: false,
    features: { rewind: true, workspaceMultiplicity: true },
    ...overrides,
  };
}

function makeLifecycle(): { lifecycle: DaemonClientLifecycle; clients: FakeDaemonClient[] } {
  const clients: FakeDaemonClient[] = [];
  const lifecycle = new DaemonClientLifecycle({
    url: "ws://fixture.invalid/ws",
    clientId: "clid_test_0001",
    clientType: "browser",
    createDaemonClient: (config) => {
      const client = new FakeDaemonClient(config);
      clients.push(client);
      return client;
    },
  });
  return { lifecycle, clients };
}

describe("DaemonClientLifecycle", () => {
  it("starts idle with no negotiated feature gates", () => {
    const { lifecycle } = makeLifecycle();
    expect(lifecycle.getStatus()).toBe("idle");
    expect(lifecycle.getFeatureGates()).toBe(EMPTY_FEATURE_GATE_SNAPSHOT);
    expect(lifecycle.getDaemonClient()).toBeNull();
  });

  it("constructs the underlying client with Pi Companion's declared capabilities merged over any override", async () => {
    const { lifecycle, clients } = makeLifecycle();
    await lifecycle.connect();
    expect(clients).toHaveLength(1);
    expect(clients[0]?.config.capabilities).toMatchObject({
      selective_agent_timeline: true,
      pi_ui_bridge: true,
      voice: false,
    });
  });

  it("derives feature gates from server_info exactly once per connection generation", async () => {
    const { lifecycle, clients } = makeLifecycle();
    let negotiationCount = 0;
    lifecycle.subscribeFeatureGates((snapshot) => {
      if (snapshot.negotiated) {
        negotiationCount += 1;
      }
    });

    await lifecycle.connect();
    const client = clients[0];
    if (!client) throw new Error("expected a client to have been constructed");

    client.simulateServerInfo(makeServerInfo());
    expect(negotiationCount).toBe(1);
    expect(lifecycle.getFeatureGates().negotiated).toBe(true);
    expect(lifecycle.isFeatureEnabled("rewind")).toBe(true);
    expect(lifecycle.isFeatureEnabled("daemonSelfUpdate")).toBe(false);

    // A second server_info on the same connection generation (the daemon
    // does not normally resend one, but the gate contract must hold even
    // if it did) must not change the already-negotiated snapshot.
    const firstSnapshot = lifecycle.getFeatureGates();
    client.simulateServerInfo(makeServerInfo({ features: { rewind: false } }));
    expect(lifecycle.getFeatureGates()).toBe(firstSnapshot);
    expect(negotiationCount).toBe(1);
  });

  it("is idempotent: connect() while already connecting/connected does not construct a second client", async () => {
    const { lifecycle, clients } = makeLifecycle();
    await lifecycle.connect();
    await lifecycle.connect();
    expect(clients).toHaveLength(1);
    expect(clients[0]?.connectCalls).toBe(2);
  });

  it("disconnect() closes the client, resets feature gates, and is non-terminal", async () => {
    const { lifecycle, clients } = makeLifecycle();
    await lifecycle.connect();
    const first = clients[0];
    if (!first) throw new Error("expected a client");
    first.simulateServerInfo(makeServerInfo());
    expect(lifecycle.getFeatureGates().negotiated).toBe(true);

    await lifecycle.disconnect();
    expect(first.closeCalls).toBe(1);
    expect(lifecycle.getStatus()).toBe("disconnected");
    expect(lifecycle.getFeatureGates()).toBe(EMPTY_FEATURE_GATE_SNAPSHOT);
    expect(lifecycle.getDaemonClient()).toBeNull();
    expect(lifecycle.isDisposed()).toBe(false);

    // connect() after disconnect() builds a fresh client (a new
    // connection generation) and renegotiates gates from scratch.
    await lifecycle.connect();
    expect(clients).toHaveLength(2);
    const second = clients[1];
    if (!second) throw new Error("expected a second client");
    expect(second).not.toBe(first);
    expect(lifecycle.getFeatureGates().negotiated).toBe(false);
    second.simulateServerInfo(makeServerInfo({ features: { rewind: true } }));
    expect(lifecycle.isFeatureEnabled("rewind")).toBe(true);
  });

  it("disconnect() is leak-free: the old client's listeners are detached and cannot affect the lifecycle afterward", async () => {
    const { lifecycle, clients } = makeLifecycle();
    await lifecycle.connect();
    const first = clients[0];
    if (!first) throw new Error("expected a client");
    expect(first.statusListenerCount()).toBe(1);

    let statusCallsAfterDisconnect = 0;
    await lifecycle.disconnect();
    expect(first.statusListenerCount()).toBe(0);

    lifecycle.subscribeStatus(() => {
      statusCallsAfterDisconnect += 1;
    });
    statusCallsAfterDisconnect = 0; // discard the synchronous initial call
    first.simulateServerInfo(makeServerInfo());
    expect(statusCallsAfterDisconnect).toBe(0);
  });

  it("subscribeEvents stays attached across a disconnect()/connect() cycle without re-subscribing", async () => {
    const { lifecycle, clients } = makeLifecycle();
    const received: unknown[] = [];
    const unsubscribe = lifecycle.subscribeEvents((event) => received.push(event));

    await lifecycle.connect();
    const first = clients[0];
    if (!first) throw new Error("expected a client");
    expect(first.eventListenerCount()).toBe(1);
    first.emitEvent({ type: "error", message: "boom-1" });

    await lifecycle.disconnect();
    expect(first.eventListenerCount()).toBe(0);

    await lifecycle.connect();
    const second = clients[1];
    if (!second) throw new Error("expected a second client");
    expect(second.eventListenerCount()).toBe(1);
    second.emitEvent({ type: "error", message: "boom-2" });

    expect(received).toEqual([
      { type: "error", message: "boom-1" },
      { type: "error", message: "boom-2" },
    ]);

    unsubscribe();
    second.emitEvent({ type: "error", message: "boom-3" });
    expect(received).toHaveLength(2);
    expect(second.eventListenerCount()).toBe(0);
  });

  it("dispose() is terminal: closes the client, clears every listener, and rejects further connect() calls", async () => {
    const { lifecycle, clients } = makeLifecycle();
    let statusCalls = 0;
    let featureGateCalls = 0;
    lifecycle.subscribeStatus(() => {
      statusCalls += 1;
    });
    lifecycle.subscribeFeatureGates(() => {
      featureGateCalls += 1;
    });
    lifecycle.subscribeEvents(() => {});

    await lifecycle.connect();
    const client = clients[0];
    if (!client) throw new Error("expected a client");
    client.simulateServerInfo(makeServerInfo());

    statusCalls = 0;
    featureGateCalls = 0;

    await lifecycle.dispose();
    expect(client.closeCalls).toBe(1);
    expect(lifecycle.getStatus()).toBe("disposed");
    expect(lifecycle.isDisposed()).toBe(true);
    expect(client.statusListenerCount()).toBe(0);
    expect(client.eventListenerCount()).toBe(0);

    await expect(lifecycle.connect()).rejects.toThrow(/disposed/i);
    expect(clients).toHaveLength(1); // no new client was constructed after dispose

    // Listeners registered before dispose() do hear the final "disposed"
    // status transition exactly once, then dispose() clears the listener
    // sets so nothing can fire again afterward (checked below).
    expect(statusCalls).toBe(1);
    expect(featureGateCalls).toBe(0);

    // dispose() itself is idempotent and does not re-notify already-cleared listeners.
    await expect(lifecycle.dispose()).resolves.toBeUndefined();
    expect(statusCalls).toBe(1);
  });

  it("subscribeStatus/subscribeFeatureGates immediately replay the current value to a new subscriber", async () => {
    const { lifecycle, clients } = makeLifecycle();
    await lifecycle.connect();
    const client = clients[0];
    if (!client) throw new Error("expected a client");
    client.simulateServerInfo(makeServerInfo());

    const statuses: string[] = [];
    lifecycle.subscribeStatus((status) => statuses.push(status));
    expect(statuses).toEqual(["connected"]);

    const snapshots: boolean[] = [];
    lifecycle.subscribeFeatureGates((snapshot) => snapshots.push(snapshot.negotiated));
    expect(snapshots).toEqual([true]);
  });
});
