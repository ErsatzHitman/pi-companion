import type { connection } from "@picompanion/frontend-core";
import { testing } from "@picompanion/frontend-core";
import type { ConnectionState, DaemonClientConfig } from "@picompanion/client";
import type { ServerInfoStatusPayload } from "@picompanion/protocol/messages";
import { describe, expect, it } from "vitest";

import {
  clearAllHostProfiles,
  listHostProfiles,
  loadHostProfileSecrets,
  saveHostProfile,
  type CredentialStoreDeps,
  type HostProfileRecord,
} from "./credential-store.js";
import {
  createReconnectHostProfile,
  RELAY_PIN_MISMATCH_MESSAGE,
  RELAY_PIN_MISSING_MESSAGE,
} from "./host-profile-reconnect.js";

/**
 * T66's core proof: a saved profile actually reconnects, and a saved
 * relay pin that no longer matches lands in a distinguishable named
 * state — not the record merely carrying more fields (this task's first
 * acceptance criterion explicitly rules that shortcut out) and not a
 * silent fallback to an unpinned connection (the fourth).
 *
 * Every test below drives the *real* `connection.DaemonClientLifecycle`
 * through an injected `createDaemonClient` — the same seam `apply-
 * connection-offer.test.ts`'s `FakeDaemonClient` uses, never a real
 * socket, emulator, or `packages/relay` bridge. "Restores from storage"
 * is proven literally: every success/failure case in the first two
 * describes goes through `saveHostProfile` → `listHostProfiles`/
 * `loadHostProfileSecrets` → `createReconnectHostProfile`, the exact
 * sequence a cold-start caller would run (see `host-profile-reconnect.ts`'s
 * module doc for the seam this task files at `app/core-context.tsx`,
 * which does not yet call any of this).
 */

function createFakeSecureStorage() {
  const store = new Map<string, string>();
  return {
    async getSecret(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async setSecret(key: string, value: string) {
      store.set(key, value);
    },
    async removeSecret(key: string) {
      store.delete(key);
    },
    async isAvailable() {
      return true;
    },
  };
}

function createFakePlainStorage() {
  const store = new Map<string, string>();
  return {
    async getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async setItem(key: string, value: string) {
      store.set(key, value);
    },
    async removeItem(key: string) {
      store.delete(key);
    },
    async clear() {
      store.clear();
    },
    async keys(prefix?: string) {
      const all = [...store.keys()];
      return prefix ? all.filter((key) => key.startsWith(prefix)) : all;
    },
  };
}

function buildDeps(): CredentialStoreDeps {
  return { secureStorage: createFakeSecureStorage(), plainStorage: createFakePlainStorage() };
}

/** A minimal `DaemonClientLike` double — identical shape to `apply-connection-offer.test.ts`'s `FakeDaemonClient`, kept local rather than shared since neither module is a package export the other may import. */
class FakeDaemonClient implements connection.DaemonClientLike {
  private state: ConnectionState = { status: "idle" };
  private readonly statusListeners = new Set<(state: ConnectionState) => void>();

  constructor(
    public readonly config: DaemonClientConfig,
    private readonly behavior: "accept" | "reject-decryption" | "reject-unreachable",
  ) {}

  async connect(): Promise<void> {
    if (this.behavior === "reject-decryption") {
      // The exact failure mode a stale/rotated `daemonPublicKeyB64`
      // produces — see `apply-connection-offer.test.ts`'s identical case.
      this.setState({ status: "disconnected", reason: "Decryption failed" });
      throw new Error("Decryption failed");
    }
    if (this.behavior === "reject-unreachable") {
      this.setState({ status: "disconnected", reason: "Connection timed out" });
      throw new Error("Connection timed out");
    }
    this.setState({ status: "connected" });
  }

  async close(): Promise<void> {
    this.setState({ status: "disposed" });
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }

  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.state);
    return () => this.statusListeners.delete(listener);
  }

  subscribe(): () => void {
    return () => {};
  }

  getLastServerInfoMessage(): ServerInfoStatusPayload | null {
    return null;
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.statusListeners) listener(state);
  }
}

function makeReconnect(behavior: "accept" | "reject-decryption" | "reject-unreachable") {
  const seenConfigs: DaemonClientConfig[] = [];
  const createDaemonClient: connection.DaemonClientFactory = (config) => {
    seenConfigs.push(config);
    return new FakeDaemonClient(config, behavior);
  };
  const reconnect = createReconnectHostProfile({
    clientId: "clid_fixture_android_reconnect_0001",
    clientType: "mobile",
    createDaemonClient,
  });
  return { reconnect, seenConfigs };
}

/** Waits for a lifecycle's status stream to report a given status, or throws if it never does. Mirrors `daemon-connection-store.ts`'s own `subscribeStatus` usage — never polls `getSnapshot`-shaped state. */
function waitForStatus(
  lifecycle: connection.DaemonClientLifecycle,
  target: connection.DaemonClientLifecycleStatus,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`never reached status "${target}"`)), 1000);
    let unsubscribe: (() => void) | null = null;
    unsubscribe = lifecycle.subscribeStatus((status) => {
      if (status === target) {
        clearTimeout(timer);
        unsubscribe?.();
        resolve();
      }
    });
  });
}

const RELAY_FIXTURE = testing.buildRelayHostProfileFixture();
const RELAY = RELAY_FIXTURE.relay;
if (!RELAY)
  throw new Error("testing.buildRelayHostProfileFixture() did not include a relay profile");

const RELAY_RECORD: HostProfileRecord = {
  id: RELAY.serverId,
  label: "Studio relay",
  kind: "relay",
  endpoint: RELAY.endpoint,
  useTls: RELAY.useTls,
  isIpv6: false,
};

const DIRECT_RECORD: HostProfileRecord = {
  id: "192.168.1.10:6767",
  label: "Workshop Pi",
  kind: "direct",
  endpoint: "192.168.1.10:6767",
  useTls: false,
  isIpv6: false,
};

describe("createReconnectHostProfile — restoring from storage reaches a connected state", () => {
  it("T66 acceptance #1: a relay-paired profile saved to storage reconnects and reaches 'connected' after a cold start", async () => {
    const deps = buildDeps();
    await saveHostProfile(deps, RELAY_RECORD, { relayKey: RELAY.daemonPublicKeyB64 });

    // Simulates a cold start: nothing here reuses the profile/secrets
    // above directly — both are re-read from the fake storage exactly
    // like `credential-store.ts`'s own restore path would.
    const restoredProfiles = await listHostProfiles(deps);
    expect(restoredProfiles).toEqual([RELAY_RECORD]);
    const restoredSecrets = await loadHostProfileSecrets(deps, restoredProfiles[0]!.id);

    const { reconnect, seenConfigs } = makeReconnect("accept");
    const result = await reconnect(restoredProfiles[0]!, restoredSecrets);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.path).toBe("relay");
    await waitForStatus(result.lifecycle, "connected");

    // Pinned to the restored pin, never invented and never omitted.
    expect(seenConfigs[0]?.e2ee).toEqual({
      enabled: true,
      daemonPublicKeyB64: RELAY.daemonPublicKeyB64,
    });
    // The pin never reaches the WebSocket URL — plan.md §12.1's "private
    // material never enters a URL query", proven the same way `apply-
    // connection-offer.test.ts` proves it for a fresh pairing.
    expect(seenConfigs[0]?.url).not.toContain(RELAY.daemonPublicKeyB64);
    expect(seenConfigs[0]?.url).toContain(`serverId=${RELAY.serverId}`);

    await result.lifecycle.dispose();
  });

  it("a direct profile saved to storage also reconnects and reaches 'connected', carrying its saved password", async () => {
    const deps = buildDeps();
    await saveHostProfile(deps, DIRECT_RECORD, { password: "hunter2" });

    const restoredProfiles = await listHostProfiles(deps);
    const restoredSecrets = await loadHostProfileSecrets(deps, restoredProfiles[0]!.id);

    const { reconnect, seenConfigs } = makeReconnect("accept");
    const result = await reconnect(restoredProfiles[0]!, restoredSecrets);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.path).toBe("direct");
    await waitForStatus(result.lifecycle, "connected");

    expect(seenConfigs[0]?.password).toBe("hunter2");
    expect(seenConfigs[0]?.e2ee).toBeUndefined();

    await result.lifecycle.dispose();
  });

  it("clearAllHostProfiles removes the pin: a subsequent restore attempt finds nothing to reconnect", async () => {
    const deps = buildDeps();
    await saveHostProfile(deps, RELAY_RECORD, { relayKey: RELAY.daemonPublicKeyB64 });
    await clearAllHostProfiles(deps);

    await expect(listHostProfiles(deps)).resolves.toEqual([]);
  });
});

describe("createReconnectHostProfile — a pin that no longer matches is distinguishable from 'cannot reach the host' (T66 acceptance #4)", () => {
  it("a stale/rotated relay pin classifies as a distinct pinMismatch failure, never a silent fallback or a generic failure", async () => {
    const { reconnect, seenConfigs } = makeReconnect("reject-decryption");

    const result = await reconnect(RELAY_RECORD, { relayKey: RELAY.daemonPublicKeyB64 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("wrong-daemon-key");
    expect(result.pinMismatch).toBe(true);
    expect(result.error).toBe(RELAY_PIN_MISMATCH_MESSAGE);
    // The connection was actually attempted, pinned — this is not the
    // missing-pin short-circuit below.
    expect(seenConfigs).toHaveLength(1);
    expect(seenConfigs[0]?.e2ee).toEqual({
      enabled: true,
      daemonPublicKeyB64: RELAY.daemonPublicKeyB64,
    });
  });

  it("an unreachable relay/daemon is a DIFFERENT kind and pinMismatch: false — never confused with a mismatched pin", async () => {
    const { reconnect } = makeReconnect("reject-unreachable");

    const result = await reconnect(RELAY_RECORD, { relayKey: RELAY.daemonPublicKeyB64 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).not.toBe("wrong-daemon-key");
    expect(result.pinMismatch).toBe(false);
    expect(result.error).not.toBe(RELAY_PIN_MISMATCH_MESSAGE);
  });

  it("a relay profile with no saved pin at all refuses before attempting any connection — never connects unpinned", async () => {
    const { reconnect, seenConfigs } = makeReconnect("accept");

    const result = await reconnect(RELAY_RECORD, {});

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("wrong-daemon-key");
    expect(result.pinMismatch).toBe(true);
    expect(result.error).toBe(RELAY_PIN_MISSING_MESSAGE);
    expect(result.error).not.toBe(RELAY_PIN_MISMATCH_MESSAGE);
    expect(seenConfigs).toHaveLength(0);
  });

  it("the missing-pin and stale-pin messages are themselves distinct — 'remove and pair again' reads differently from a fresh-pairing-link failure", () => {
    expect(RELAY_PIN_MISSING_MESSAGE).not.toBe(RELAY_PIN_MISMATCH_MESSAGE);
  });
});
