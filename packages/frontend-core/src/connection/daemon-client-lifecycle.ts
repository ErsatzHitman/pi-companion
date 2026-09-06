/**
 * `DaemonClient` lifecycle owner — plan.md §6/§7.1/§12.1, T19A.
 *
 * `DaemonClientLifecycle` is the one place in `frontend-core` that
 * constructs and owns a `@picompanion/client` `DaemonClient`. It:
 *
 * - performs (by delegating to `DaemonClient`, which already does the
 *   wire-level work) the hello exchange, and resolves `connect()` only
 *   once the daemon's `server_info` reply has arrived;
 * - declares Pi Companion's full hello capability set exactly once, at
 *   `DaemonClient` construction, via `PI_COMPANION_CLIENT_CAPABILITIES`
 *   (see `client-capabilities.ts`) — never per message;
 * - derives a frozen `FeatureGateSnapshot` from `server_info.features`
 *   exactly once per connection generation (see `feature-gates.ts`),
 *   so gates never silently change mid-connection;
 * - exposes a stable `connect`/`disconnect`/`dispose` lifecycle that is
 *   leak-free: every listener this class attaches to the underlying
 *   `DaemonClient` is detached on `disconnect()` and `dispose()`, and
 *   `dispose()` is terminal (no further `connect()` calls).
 *
 * `apps/web` and `apps/android` supply the platform-specific
 * `webSocketFactory` (browser `WebSocket`, RN/Expo `ws`-like polyfill);
 * this module never references a concrete transport, only the
 * `WebSocketFactory`/`WebSocketLike` function types `@picompanion/client`
 * already defines for that purpose.
 */
import { DaemonClient } from "@picompanion/client";
import type { ConnectionState, DaemonClientConfig, DaemonEvent } from "@picompanion/client";
import type { ServerInfoStatusPayload } from "@picompanion/protocol/messages";
import { PI_COMPANION_CLIENT_CAPABILITIES } from "./client-capabilities.js";
import {
  EMPTY_FEATURE_GATE_SNAPSHOT,
  deriveFeatureGateSnapshot,
  isFeatureEnabled,
  type FeatureGateSnapshot,
  type ServerFeatureId,
} from "./feature-gates.js";

export type DaemonEventHandler = (event: DaemonEvent) => void;

/**
 * The subset of `DaemonClient`'s API this class depends on. Kept narrow
 * and exported so tests (and, later, other `connection/` modules) can
 * inject a fake instead of a real `DaemonClient` wired to a real
 * transport. The real `DaemonClient` satisfies this interface as-is.
 */
export interface DaemonClientLike {
  connect(): Promise<void>;
  close(): Promise<void>;
  getConnectionState(): ConnectionState;
  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void;
  subscribe(handler: DaemonEventHandler): () => void;
  getLastServerInfoMessage(): ServerInfoStatusPayload | null;
}

export type DaemonClientFactory = (config: DaemonClientConfig) => DaemonClientLike;

const defaultDaemonClientFactory: DaemonClientFactory = (config) => new DaemonClient(config);

/**
 * Lifecycle status as seen by `frontend-core` consumers. Distinct from
 * `DaemonClient`'s own `ConnectionState.status`: `"disconnected"` here
 * means this lifecycle intentionally tore its client down and can
 * `connect()` again; `"disposed"` is terminal.
 */
export type DaemonClientLifecycleStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "disposed";

export type DaemonClientLifecycleStatusListener = (status: DaemonClientLifecycleStatus) => void;
export type FeatureGateListener = (snapshot: FeatureGateSnapshot) => void;

export interface DaemonClientLifecycleConfig extends DaemonClientConfig {
  /**
   * Merged over `PI_COMPANION_CLIENT_CAPABILITIES`. Exists for tests and
   * narrow per-build overrides, not for per-connection variation — see
   * `client-capabilities.ts`.
   */
  capabilities?: DaemonClientConfig["capabilities"];
  /** Test/DI seam. Defaults to constructing a real `DaemonClient`. */
  createDaemonClient?: DaemonClientFactory;
}

function mapConnectionState(state: ConnectionState): DaemonClientLifecycleStatus {
  return state.status;
}

export class DaemonClientLifecycle {
  private readonly config: DaemonClientLifecycleConfig;
  private readonly createDaemonClient: DaemonClientFactory;

  private client: DaemonClientLike | null = null;
  private clientUnsubscribes: Array<() => void> = [];
  private readonly eventListenerUnsubscribes = new Map<DaemonEventHandler, () => void>();

  private disposed = false;
  private status: DaemonClientLifecycleStatus = "idle";
  private featureGates: FeatureGateSnapshot = EMPTY_FEATURE_GATE_SNAPSHOT;
  private negotiatedForGeneration = false;

  private readonly statusListeners = new Set<DaemonClientLifecycleStatusListener>();
  private readonly featureGateListeners = new Set<FeatureGateListener>();

  constructor(config: DaemonClientLifecycleConfig) {
    this.config = config;
    this.createDaemonClient = config.createDaemonClient ?? defaultDaemonClientFactory;
  }

  /**
   * Connects, constructing a fresh underlying `DaemonClient` (a new
   * "connection generation") the first time, or after `disconnect()`.
   * Idempotent while already connecting/connected, matching
   * `DaemonClient.connect()`. Resolves once hello/`server_info`
   * negotiation has completed and feature gates have been derived.
   */
  async connect(): Promise<void> {
    if (this.disposed) {
      throw new Error("DaemonClientLifecycle is disposed");
    }
    if (!this.client) {
      this.negotiatedForGeneration = false;
      this.featureGates = EMPTY_FEATURE_GATE_SNAPSHOT;
      const client = this.createDaemonClient(this.buildDaemonClientConfig());
      this.client = client;
      this.wireClient(client);
    }
    await this.client.connect();
    this.maybeNegotiateFeatureGates();
  }

  /**
   * Tears the current connection generation down: unsubscribes every
   * listener this class attached, closes the underlying `DaemonClient`,
   * and resets feature gates. Non-terminal — `connect()` afterwards
   * builds a fresh `DaemonClient` and renegotiates gates from scratch.
   * Handlers registered via `subscribeEvents` remain registered and are
   * reattached automatically on the next `connect()`.
   */
  async disconnect(): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.teardownClient();
    this.setStatus("disconnected");
  }

  /** Terminal: tears the connection down and rejects any further `connect()` call. */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await this.teardownClient();
    this.eventListenerUnsubscribes.clear();
    this.setStatus("disposed");
    this.statusListeners.clear();
    this.featureGateListeners.clear();
  }

  getStatus(): DaemonClientLifecycleStatus {
    return this.status;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  getFeatureGates(): FeatureGateSnapshot {
    return this.featureGates;
  }

  isFeatureEnabled(featureId: ServerFeatureId): boolean {
    return isFeatureEnabled(this.featureGates, featureId);
  }

  /** The live `DaemonClient` for the current connection generation, or `null` between/before connections. */
  getDaemonClient(): DaemonClientLike | null {
    return this.client;
  }

  subscribeStatus(listener: DaemonClientLifecycleStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  subscribeFeatureGates(listener: FeatureGateListener): () => void {
    this.featureGateListeners.add(listener);
    listener(this.featureGates);
    return () => {
      this.featureGateListeners.delete(listener);
    };
  }

  /**
   * Subscribes to the raw `DaemonEvent` stream. Stays attached across
   * `disconnect()`/`connect()` cycles (reattached to each new
   * generation's `DaemonClient` automatically); detached for good once
   * the returned unsubscribe function is called, or on `dispose()`.
   */
  subscribeEvents(handler: DaemonEventHandler): () => void {
    if (this.disposed) {
      return () => {};
    }
    if (!this.eventListenerUnsubscribes.has(handler)) {
      const unsubscribeFromClient = this.client ? this.client.subscribe(handler) : () => {};
      this.eventListenerUnsubscribes.set(handler, unsubscribeFromClient);
    }
    return () => {
      const unsubscribeFromClient = this.eventListenerUnsubscribes.get(handler);
      if (unsubscribeFromClient) {
        unsubscribeFromClient();
        this.eventListenerUnsubscribes.delete(handler);
      }
    };
  }

  private async teardownClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    for (const unsubscribe of this.clientUnsubscribes.splice(0)) {
      unsubscribe();
    }
    for (const [handler, unsubscribeFromClient] of this.eventListenerUnsubscribes) {
      unsubscribeFromClient();
      this.eventListenerUnsubscribes.set(handler, () => {});
    }
    this.negotiatedForGeneration = false;
    this.featureGates = EMPTY_FEATURE_GATE_SNAPSHOT;
    if (client) {
      await client.close();
    }
  }

  private wireClient(client: DaemonClientLike): void {
    const unsubscribeStatus = client.subscribeConnectionStatus((state) => {
      this.setStatus(mapConnectionState(state));
      if (state.status === "connected") {
        this.maybeNegotiateFeatureGates();
      }
    });
    this.clientUnsubscribes.push(unsubscribeStatus);

    for (const handler of this.eventListenerUnsubscribes.keys()) {
      this.eventListenerUnsubscribes.set(handler, client.subscribe(handler));
    }
  }

  private maybeNegotiateFeatureGates(): void {
    if (this.negotiatedForGeneration || !this.client) {
      return;
    }
    const serverInfo = this.client.getLastServerInfoMessage();
    if (!serverInfo) {
      return;
    }
    this.negotiatedForGeneration = true;
    this.featureGates = deriveFeatureGateSnapshot(serverInfo);
    for (const listener of this.featureGateListeners) {
      listener(this.featureGates);
    }
  }

  private setStatus(status: DaemonClientLifecycleStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private buildDaemonClientConfig(): DaemonClientConfig {
    const { createDaemonClient: _createDaemonClient, capabilities, ...rest } = this.config;
    return {
      ...rest,
      capabilities: { ...PI_COMPANION_CLIENT_CAPABILITIES, ...capabilities },
    };
  }
}
