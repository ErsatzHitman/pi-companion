/**
 * Host connection orchestration — plan.md §7.1/§12.1, T19B.
 *
 * `HostController` is the one place that ties together everything else
 * in `hosts/` on top of the T19A `DaemonClientLifecycle`:
 *
 * - loads a `HostProfile` (and its password, if any) from
 *   `HostProfileStore`;
 * - uses `ConnectionProber` to pick direct vs. relay deterministically;
 * - constructs/owns one `DaemonClientLifecycle` at a time, pointed at
 *   the selected URL;
 * - on an unexpected disconnect, uses `ReconnectPolicy` to schedule the
 *   next attempt (via the injected `Clock`, never a raw timer) and, once
 *   a kind has failed enough times in a row, switches to the profile's
 *   other configured connection kind — the "relay-switch path" this
 *   task's acceptance criteria call out;
 * - pauses reconnect scheduling while `NetworkReachability` reports
 *   offline, and retries promptly once it reports online again;
 * - broadcasts the transition to `"offline"` the instant
 *   `NetworkReachability` reports the browser/device going offline
 *   (T54A3), rather than only reflecting it once some later event (a
 *   failed reconnect attempt, or the underlying socket's own liveness
 *   heartbeat, up to ~50s away) happens to call `emitInfo()` next --
 *   plan.md §7.4's "Liveness" note treats that heartbeat as a backstop
 *   for a socket that stays open and goes silent, not as the primary
 *   offline signal.
 *
 * A manual `disconnect()` is never followed by an automatic reconnect;
 * only an unexpected disconnect (the underlying lifecycle moving to
 * `"disconnected"` on its own) schedules one.
 */
import type { DaemonClientConfig } from "@picompanion/client";
import type {
  DaemonClientLifecycleConfig,
  DaemonClientLifecycleStatus,
  DaemonClientLifecycleStatusListener,
  DaemonClientLike,
  DaemonEventHandler,
  FeatureGateListener,
} from "../connection/daemon-client-lifecycle.js";
import { DaemonClientLifecycle } from "../connection/daemon-client-lifecycle.js";
import type { FeatureGateSnapshot, ServerFeatureId } from "../connection/feature-gates.js";
import type { Clock, TimerHandle } from "../platform/clock.js";
import type { Logger } from "../platform/logging.js";
import type { NetworkReachability, NetworkStatus } from "../platform/network.js";
import type { SecureStorage } from "../platform/secure-storage.js";
import type { StructuredStorage } from "../platform/storage.js";
import { buildConnectionUrlForKind } from "./connection-url.js";
import type { HostProbeAttempt, HostProbeTransport } from "./connection-prober.js";
import { ConnectionProber } from "./connection-prober.js";
import { HostProfileStore } from "./host-profile-store.js";
import { ReconnectPolicy } from "./reconnect-policy.js";
import type { HostConnectionKind, HostProfile } from "./types.js";

/**
 * The subset of `DaemonClientLifecycle`'s API `HostController` depends
 * on. `DaemonClientLifecycle` satisfies this as-is; tests inject a fake
 * via `createLifecycle`.
 */
export interface HostControllerLifecycleLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  dispose(): Promise<void>;
  getStatus(): DaemonClientLifecycleStatus;
  subscribeStatus(listener: DaemonClientLifecycleStatusListener): () => void;
  subscribeEvents(handler: DaemonEventHandler): () => void;
  subscribeFeatureGates(listener: FeatureGateListener): () => void;
  getFeatureGates(): FeatureGateSnapshot;
  isFeatureEnabled(featureId: ServerFeatureId): boolean;
  getDaemonClient(): DaemonClientLike | null;
}

export type HostLifecycleFactory = (
  config: DaemonClientLifecycleConfig,
) => HostControllerLifecycleLike;

const defaultHostLifecycleFactory: HostLifecycleFactory = (config) =>
  new DaemonClientLifecycle(config);

export type HostControllerConnectionStatus =
  | "idle"
  | "probing"
  | DaemonClientLifecycleStatus
  | "reconnect-pending"
  | "offline";

export interface HostControllerConnectionInfo {
  status: HostControllerConnectionStatus;
  profileId: string | null;
  kind: HostConnectionKind | null;
}

export type HostControllerConnectionInfoListener = (info: HostControllerConnectionInfo) => void;

export interface HostConnectResult {
  ok: boolean;
  kind: HostConnectionKind | null;
  /** Every probe attempt made while selecting a connection kind. Present whether or not selection succeeded. */
  attempts: HostProbeAttempt[];
}

export interface HostControllerConfig {
  clientId: string;
  clientType?: DaemonClientConfig["clientType"];
  appVersion?: string;
  storage: StructuredStorage;
  secrets: SecureStorage;
  network: NetworkReachability;
  clock: Clock;
  probe: HostProbeTransport;
  probeTimeoutMs?: number;
  reconnect?: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    maxAttemptsPerKind?: number;
  };
  createLifecycle?: HostLifecycleFactory;
  logger?: Logger;
}

export class HostController {
  readonly profiles: HostProfileStore;

  private readonly clientId: string;
  private readonly clientType: DaemonClientConfig["clientType"] | undefined;
  private readonly appVersion: string | undefined;
  private readonly network: NetworkReachability;
  private readonly clock: Clock;
  private readonly prober: ConnectionProber;
  private readonly reconnectPolicy: ReconnectPolicy;
  private readonly createLifecycle: HostLifecycleFactory;
  private readonly logger: Logger | undefined;

  private currentProfile: HostProfile | null = null;
  private currentPassword: string | undefined;
  private currentKind: HostConnectionKind | null = null;
  private lifecycle: HostControllerLifecycleLike | null = null;
  private lifecycleStatusUnsubscribe: (() => void) | null = null;
  private reconnectTimer: TimerHandle | null = null;
  private manuallyDisconnected = true;
  private offline = false;
  private disposed = false;

  private readonly infoListeners = new Set<HostControllerConnectionInfoListener>();
  private readonly networkUnsubscribe: () => void;
  private lastBroadcastStatus: HostControllerConnectionStatus | null = null;

  constructor(config: HostControllerConfig) {
    this.clientId = config.clientId;
    this.clientType = config.clientType;
    this.appVersion = config.appVersion;
    this.network = config.network;
    this.clock = config.clock;
    this.logger = config.logger;
    this.createLifecycle = config.createLifecycle ?? defaultHostLifecycleFactory;
    this.profiles = new HostProfileStore({
      storage: config.storage,
      secrets: config.secrets,
      clock: config.clock,
    });
    this.prober = new ConnectionProber({
      clock: config.clock,
      probe: config.probe,
      ...(config.probeTimeoutMs !== undefined ? { timeoutMs: config.probeTimeoutMs } : {}),
    });
    this.reconnectPolicy = new ReconnectPolicy(config.reconnect ?? {});
    this.networkUnsubscribe = this.network.subscribe((status) => {
      this.handleNetworkStatus(status);
    });
  }

  /**
   * Probes `profile`'s configured connection kinds, connects using the
   * first reachable one, and (unless the caller supplies a password
   * explicitly) uses the password `HostProfileStore` has on file for
   * this profile, if any. Cancels any pending automatic reconnect from a
   * previous connection first.
   */
  async connectToProfile(
    profile: HostProfile,
    options: { password?: string } = {},
  ): Promise<HostConnectResult> {
    this.assertNotDisposed();
    this.clearReconnectTimer();
    this.reconnectPolicy.reset();
    this.manuallyDisconnected = false;
    this.currentProfile = profile;
    this.currentPassword =
      options.password ?? (await this.profiles.getPassword(profile.id)) ?? undefined;

    this.emitInfo("probing");
    const selection = await this.prober.selectConnection(profile);
    if (!selection.selectedKind) {
      this.logger?.warn("host connection probe found no reachable target", {
        profileId: profile.id,
      });
      this.emitInfo("disconnected");
      return { ok: false, kind: null, attempts: selection.attempts };
    }

    await this.connectWithKind(selection.selectedKind);
    return {
      ok: true,
      kind: selection.selectedKind,
      attempts: selection.attempts,
    };
  }

  /** Manual disconnect: tears the connection down and does not schedule a reconnect. */
  async disconnect(): Promise<void> {
    this.manuallyDisconnected = true;
    this.clearReconnectTimer();
    const lifecycle = this.lifecycle;
    if (lifecycle) {
      await lifecycle.disconnect();
    }
    this.emitInfo("idle");
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.manuallyDisconnected = true;
    this.clearReconnectTimer();
    this.networkUnsubscribe();
    this.lifecycleStatusUnsubscribe?.();
    this.lifecycleStatusUnsubscribe = null;
    if (this.lifecycle) {
      await this.lifecycle.dispose();
      this.lifecycle = null;
    }
    this.infoListeners.clear();
  }

  getCurrentProfile(): HostProfile | null {
    return this.currentProfile;
  }

  getCurrentKind(): HostConnectionKind | null {
    return this.currentKind;
  }

  getConnectionInfo(): HostControllerConnectionInfo {
    return {
      status: this.currentInfoStatus(),
      profileId: this.currentProfile?.id ?? null,
      kind: this.currentKind,
    };
  }

  subscribeConnectionInfo(listener: HostControllerConnectionInfoListener): () => void {
    this.infoListeners.add(listener);
    listener(this.getConnectionInfo());
    return () => {
      this.infoListeners.delete(listener);
    };
  }

  /** Passthrough to the current lifecycle's event stream; stays subscribed across an internal relay-switch/reconnect since a fresh lifecycle is always wired to the same handler set is not guaranteed — callers should `subscribeConnectionInfo`/`subscribeStatus` for cross-reconnect status and re-derive event handling per the emitted lifecycle if they need raw events across a kind switch. For the common case (one connect for the process lifetime), this simply forwards to the live lifecycle. */
  subscribeEvents(handler: DaemonEventHandler): () => void {
    if (!this.lifecycle) return () => {};
    return this.lifecycle.subscribeEvents(handler);
  }

  getDaemonClient(): DaemonClientLike | null {
    return this.lifecycle?.getDaemonClient() ?? null;
  }

  private async connectWithKind(kind: HostConnectionKind): Promise<void> {
    const profile = this.currentProfile;
    if (!profile) {
      throw new Error("HostController.connectWithKind called with no current profile");
    }
    await this.teardownLifecycle();

    this.currentKind = kind;
    const url = buildConnectionUrlForKind(profile, kind);
    const lifecycleConfig: DaemonClientLifecycleConfig = {
      url,
      clientId: this.clientId,
      ...(this.clientType !== undefined ? { clientType: this.clientType } : {}),
      ...(this.appVersion !== undefined ? { appVersion: this.appVersion } : {}),
      ...(this.currentPassword !== undefined ? { password: this.currentPassword } : {}),
      ...(kind === "relay" && profile.relay
        ? { e2ee: { enabled: true, daemonPublicKeyB64: profile.relay.daemonPublicKeyB64 } }
        : {}),
      // The transport-level reconnect stays on for same-URL blips; the
      // kind-switch decision above it is this controller's own policy.
      reconnect: { enabled: true },
    };

    const lifecycle = this.createLifecycle(lifecycleConfig);
    this.lifecycle = lifecycle;
    this.lifecycleStatusUnsubscribe = lifecycle.subscribeStatus((status) => {
      this.handleLifecycleStatus(kind, status);
    });

    await lifecycle.connect();
    this.reconnectPolicy.recordSuccess(kind);
    await this.profiles.recordConnectionOutcome(profile.id, kind);
    // No explicit emitInfo() here: `lifecycle.subscribeStatus` above already
    // broadcast the "connected" transition (or whatever status connect()
    // settled on) the moment it happened.
  }

  private handleLifecycleStatus(
    kind: HostConnectionKind,
    status: DaemonClientLifecycleStatus,
  ): void {
    this.emitInfo(status);
    if (status !== "disconnected") return;
    if (this.manuallyDisconnected || this.disposed) return;
    if (this.currentKind !== kind) return; // stale listener from a superseded lifecycle
    this.scheduleReconnect(kind);
  }

  private scheduleReconnect(failedKind: HostConnectionKind): void {
    if (this.offline) {
      // Wait for the network to come back rather than burning through
      // the retry budget while there is definitely nothing to reach.
      this.emitInfo("offline");
      return;
    }
    const decision = this.reconnectPolicy.recordFailure(failedKind);
    const profile = this.currentProfile;
    const nextKind =
      decision.shouldSwitchKind && profile
        ? (this.alternateKindOf(profile, failedKind) ?? failedKind)
        : failedKind;

    this.clearReconnectTimer();
    this.emitInfo("reconnect-pending");
    this.reconnectTimer = this.clock.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectWithKind(nextKind).catch((error: unknown) => {
        this.logger?.warn("host reconnect attempt failed", {
          kind: nextKind,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, decision.delayMs);
  }

  private handleNetworkStatus(status: NetworkStatus): void {
    const wasOffline = this.offline;
    this.offline = !status.online;
    if (!wasOffline && this.offline) {
      // T54A3: the browser's own `offline` event (plan.md §7.4's
      // "Liveness" note -- the socket heartbeat is a backstop, not the
      // primary signal) is authoritative *now*, same tick, well before a
      // silent/still-open socket's liveness heartbeat would ever notice
      // (up to ~50s: 10s interval, 15s timeout, two consecutive
      // failures). Cancel any reconnect already scheduled -- it would
      // otherwise fire into a network we now know is down, and its
      // `"reconnect-pending"` status would also outrank `currentInfoStatus()`'s
      // fresher `"offline"` read below -- then broadcast the transition
      // immediately so every `subscribeConnectionInfo` listener (e.g. the
      // session rail's `useSessionListSync`) marks itself stale without
      // waiting on anything socket-level.
      this.clearReconnectTimer();
      this.emitInfo(this.currentInfoStatus());
    }
    if (wasOffline && status.online && !this.manuallyDisconnected && this.currentKind) {
      // Network just came back: retry immediately instead of waiting out
      // whatever backoff was in effect when connectivity dropped.
      this.reconnectPolicy.reset();
      this.clearReconnectTimer();
      const kind = this.currentKind;
      void this.connectWithKind(kind).catch((error: unknown) => {
        this.logger?.warn("host reconnect after network recovery failed", {
          kind,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  private alternateKindOf(
    profile: HostProfile,
    kind: HostConnectionKind,
  ): HostConnectionKind | null {
    const other: HostConnectionKind = kind === "direct" ? "relay" : "direct";
    if (other === "direct" && profile.direct) return "direct";
    if (other === "relay" && profile.relay) return "relay";
    return null;
  }

  private async teardownLifecycle(): Promise<void> {
    this.lifecycleStatusUnsubscribe?.();
    this.lifecycleStatusUnsubscribe = null;
    const lifecycle = this.lifecycle;
    this.lifecycle = null;
    if (lifecycle) {
      await lifecycle.dispose();
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      this.clock.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private currentInfoStatus(): HostControllerConnectionStatus {
    if (this.disposed) return "disposed";
    if (this.reconnectTimer) return "reconnect-pending";
    // A manual disconnect() always reads as "idle" from here, regardless of
    // whatever raw status the (still-attached, not yet reconnecting)
    // underlying lifecycle reports.
    if (this.manuallyDisconnected) return "idle";
    if (this.offline && this.currentProfile) return "offline";
    return this.lifecycle?.getStatus() ?? "idle";
  }

  /** Broadcasts to `subscribeConnectionInfo` listeners, deduplicating consecutive identical statuses so an internal replay (e.g. a freshly wired lifecycle synchronously reporting its current, unchanged status) never appears as a spurious repeat notification. */
  private emitInfo(status: HostControllerConnectionStatus): void {
    if (this.lastBroadcastStatus === status) return;
    this.lastBroadcastStatus = status;
    const info: HostControllerConnectionInfo = {
      status,
      profileId: this.currentProfile?.id ?? null,
      kind: this.currentKind,
    };
    for (const listener of this.infoListeners) {
      listener(info);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("HostController is disposed");
    }
  }
}
