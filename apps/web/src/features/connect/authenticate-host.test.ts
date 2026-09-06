import type {
  Clock,
  SecureStorage,
  StructuredStorage,
  StructuredStorageListOptions,
  TimerHandle,
} from "@picompanion/frontend-core";
import type { connection, hosts } from "@picompanion/frontend-core";
import type { ConnectionState, DaemonClientConfig } from "@picompanion/client";
import type { ServerInfoStatusPayload } from "@picompanion/protocol/messages";
import { describe, expect, it } from "vitest";

import { createConnectAndAuthenticateAttempt, forgetHostCredentials } from "./authenticate-host.js";
import type { ConnectDraft } from "./validate-connect-form.js";

/** Deterministic, real-time-free `Clock` test double (mirrors `attempt-host-connection.test.ts`'s). */
class FakeClock implements Clock {
  private nowMs = 0;
  private nextHandle = 0;
  now(): number {
    return this.nowMs;
  }
  setTimeout(): TimerHandle {
    this.nextHandle += 1;
    return this.nextHandle as unknown as TimerHandle;
  }
  clearTimeout(): void {}
  setInterval(): TimerHandle {
    throw new Error("not used");
  }
  clearInterval(): void {}
}

class InMemoryStructuredStorage implements StructuredStorage {
  private readonly collections = new Map<string, Map<string, unknown>>();
  private collection(name: string): Map<string, unknown> {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new Map();
      this.collections.set(name, collection);
    }
    return collection;
  }
  async get<T>(collection: string, id: string): Promise<T | null> {
    return (this.collection(collection).get(id) as T | undefined) ?? null;
  }
  async put<T>(collection: string, id: string, value: T): Promise<void> {
    this.collection(collection).set(id, value);
  }
  async delete(collection: string, id: string): Promise<void> {
    this.collection(collection).delete(id);
  }
  async list<T>(collection: string, options?: StructuredStorageListOptions): Promise<T[]> {
    let values = [...this.collection(collection).entries()];
    if (options?.idPrefix !== undefined) {
      values = values.filter(([id]) => id.startsWith(options.idPrefix ?? ""));
    }
    return values.map(([, value]) => value as T);
  }
  async clear(collection: string): Promise<void> {
    this.collections.delete(collection);
  }
}

class InMemorySecureStorage implements SecureStorage {
  private readonly secrets = new Map<string, string>();
  async getSecret(key: string): Promise<string | null> {
    return this.secrets.get(key) ?? null;
  }
  async setSecret(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }
  async removeSecret(key: string): Promise<void> {
    this.secrets.delete(key);
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

/** A minimal `DaemonClientLike` double, mirroring `daemon-client-lifecycle.test.ts`'s `FakeDaemonClient`. */
class FakeDaemonClient implements connection.DaemonClientLike {
  closeCalls = 0;
  private state: ConnectionState = { status: "idle" };
  private readonly statusListeners = new Set<(state: ConnectionState) => void>();

  constructor(
    public readonly config: DaemonClientConfig,
    private readonly behavior: "accept" | "reject-auth" | "reject-decryption" | "reject-unknown",
  ) {}

  async connect(): Promise<void> {
    if (this.behavior === "reject-auth") {
      this.setState({ status: "disconnected", reason: "Incorrect password" });
      throw new Error("Incorrect password");
    }
    if (this.behavior === "reject-decryption") {
      // T27A6: the real relay-only failure mode
      // (`packages/relay/src/crypto.ts`'s `decrypt()`); a direct
      // connection never actually produces this, but the taxonomy must
      // still classify it correctly rather than mislabeling it a wrong
      // password (see `connection-error.test.ts` for the pure-function
      // coverage of the classifier itself).
      this.setState({ status: "disconnected", reason: "Decryption failed" });
      throw new Error("Decryption failed");
    }
    if (this.behavior === "reject-unknown") {
      this.setState({ status: "disconnected", reason: "Incompatible protocol version" });
      throw new Error("Incompatible protocol version");
    }
    this.setState({ status: "connected" });
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

const draft: ConnectDraft = {
  label: "My daemon",
  direct: { endpoint: "localhost:6767", useTls: false },
  preferDirect: true,
  password: "correct-token",
};

function makeOptions(behavior: "accept" | "reject-auth" | "reject-decryption" | "reject-unknown") {
  const clock = new FakeClock();
  const storage = new InMemoryStructuredStorage();
  const secrets = new InMemorySecureStorage();
  const seenConfigs: DaemonClientConfig[] = [];
  const createDaemonClient: connection.DaemonClientFactory = (config) => {
    seenConfigs.push(config);
    return new FakeDaemonClient(config, behavior);
  };
  return {
    clock,
    storage,
    secrets,
    seenConfigs,
    options: {
      clock,
      storage,
      secrets,
      clientId: "test-client",
      clientType: "browser" as const,
      probe: async () => {
        /* reachable */
      },
      createDaemonClient,
    },
  };
}

describe("createConnectAndAuthenticateAttempt", () => {
  it("reports an unreachable target without attempting authentication", async () => {
    const { options } = makeOptions("accept");
    const attempt = createConnectAndAuthenticateAttempt({
      ...options,
      probe: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    const outcome = await attempt(draft);

    expect(outcome).toEqual({
      ok: false,
      reachable: false,
      authenticated: false,
      savedProfileId: null,
      error: "Could not reach the daemon. Check the address and try again.",
    });
  });

  it("reports a rejected token without persisting anything", async () => {
    const { options, storage } = makeOptions("reject-auth");
    const attempt = createConnectAndAuthenticateAttempt(options);

    const outcome = await attempt(draft);

    expect(outcome.ok).toBe(false);
    expect(outcome.reachable).toBe(true);
    expect(outcome.authenticated).toBe(false);
    expect(outcome.savedProfileId).toBeNull();
    expect(outcome.error).toBe("Incorrect password");
    expect(await storage.list("hosts.profiles")).toEqual([]);
  });

  it("classifies a wrong password distinctly from a wrong daemon key (T27A6)", async () => {
    // `FakeDaemonClient`'s "reject-auth" behavior rejects with the exact
    // string the real daemon's `attachAuthenticatedSocket` closes with
    // (`packages/server/src/server/websocket-server.ts`) — the same raw
    // message `describeDirectConnectionError` classifies. "reject-decryption"
    // mirrors the relay-only failure mode from
    // `packages/relay/src/crypto.ts`'s `decrypt()`; a direct connection
    // never actually surfaces it, but the taxonomy must still degrade to
    // distinct, correct copy rather than mislabeling it a wrong password.
    const { WRONG_DAEMON_KEY_MESSAGE, WRONG_PASSWORD_MESSAGE, DIRECT_UNKNOWN_MESSAGE } =
      await import("./connection-error.js");

    const wrongPassword = await createConnectAndAuthenticateAttempt(
      makeOptions("reject-auth").options,
    )(draft);
    const wrongDaemonKey = await createConnectAndAuthenticateAttempt(
      makeOptions("reject-decryption").options,
    )(draft);
    const unknown = await createConnectAndAuthenticateAttempt(
      makeOptions("reject-unknown").options,
    )(draft);

    expect(wrongPassword.error).toBe(WRONG_PASSWORD_MESSAGE);
    expect(wrongDaemonKey.error).toBe(DIRECT_UNKNOWN_MESSAGE);
    expect(unknown.error).toBe(DIRECT_UNKNOWN_MESSAGE);
    expect(wrongPassword.error).not.toBe(WRONG_DAEMON_KEY_MESSAGE);
    expect(wrongPassword.error).not.toBe(wrongDaemonKey.error);
  });

  it("never puts the token in the connection URL, only in DaemonClientLifecycleConfig.password", async () => {
    const { options, seenConfigs } = makeOptions("accept");
    const attempt = createConnectAndAuthenticateAttempt(options);

    await attempt(draft);

    expect(seenConfigs).toHaveLength(1);
    expect(seenConfigs[0]?.url).toBe("ws://localhost:6767/ws");
    expect(seenConfigs[0]?.url).not.toContain("correct-token");
    expect(seenConfigs[0]?.password).toBe("correct-token");
  });

  it("persists the profile and token through the platform storage interfaces on success", async () => {
    const { options, storage, secrets } = makeOptions("accept");
    const attempt = createConnectAndAuthenticateAttempt(options);

    const outcome = await attempt(draft);

    expect(outcome.ok).toBe(true);
    expect(outcome.authenticated).toBe(true);
    expect(outcome.savedProfileId).toBeTruthy();

    const saved = await storage.get<hosts.HostProfile>(
      "hosts.profiles",
      outcome.savedProfileId ?? "",
    );
    expect(saved?.label).toBe("My daemon");
    expect(saved?.direct).toEqual({ endpoint: "localhost:6767", useTls: false });
    expect(await secrets.getSecret(`hosts.profile.${outcome.savedProfileId}.password`)).toBe(
      "correct-token",
    );
  });

  it("persisted credentials survive a reload: a fresh store over the same storage still sees them", async () => {
    const { options, storage, secrets, clock } = makeOptions("accept");
    const attempt = createConnectAndAuthenticateAttempt(options);
    const outcome = await attempt(draft);
    const profileId = outcome.savedProfileId;
    expect(profileId).toBeTruthy();

    // Simulate a page reload: a brand-new `HostProfileStore` (as
    // `ConnectFormContainer` would build on the next mount) reads from
    // the same underlying `StructuredStorage`/`SecureStorage`, not any
    // in-memory state this attempt's closure kept.
    const { hosts: hostsModule } = await import("@picompanion/frontend-core");
    const reloaded = new hostsModule.HostProfileStore({ storage, secrets, clock });
    expect((await reloaded.get(profileId ?? ""))?.label).toBe("My daemon");
    expect(await reloaded.getPassword(profileId ?? "")).toBe("correct-token");
  });

  it("connects without a password when no token was entered", async () => {
    const { options, seenConfigs } = makeOptions("accept");
    const attempt = createConnectAndAuthenticateAttempt(options);

    await attempt({ ...draft, password: undefined });

    expect(seenConfigs[0]?.password).toBeUndefined();
  });
});

describe("forgetHostCredentials", () => {
  it("clears a saved profile's metadata and token", async () => {
    const { options, storage, secrets } = makeOptions("accept");
    const attempt = createConnectAndAuthenticateAttempt(options);
    const outcome = await attempt(draft);
    const profileId = outcome.savedProfileId ?? "";

    await forgetHostCredentials(options, profileId);

    expect(await storage.get("hosts.profiles", profileId)).toBeNull();
    expect(await secrets.getSecret(`hosts.profile.${profileId}.password`)).toBeNull();
  });
});
