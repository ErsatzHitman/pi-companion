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

import {
  ConnectionOfferParseError,
  CONNECTION_OFFER_EXPIRED_MESSAGE,
  createApplyConnectionOfferAttempt,
  parseConnectionOfferInput,
} from "./apply-connection-offer.js";

/** Mirrors `@picompanion/protocol/connection-offer.test.ts`'s own encoder — this feature never depends on `packages/server`. */
function encodeBase64UrlNoPadUtf8(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

const VALID_OFFER_PAYLOAD = {
  v: 2,
  serverId: "server-123",
  daemonPublicKeyB64: "pubkey-abc",
  relay: { endpoint: "relay.paseo.sh:443", useTls: true },
};
const VALID_ENCODED = encodeBase64UrlNoPadUtf8(JSON.stringify(VALID_OFFER_PAYLOAD));
const VALID_URL = `https://app.paseo.sh/#offer=${VALID_ENCODED}`;

describe("parseConnectionOfferInput", () => {
  it("parses a full pairing URL", () => {
    expect(parseConnectionOfferInput(VALID_URL)).toEqual(VALID_OFFER_PAYLOAD);
  });

  it("parses a bare #offer= fragment", () => {
    expect(parseConnectionOfferInput(`#offer=${VALID_ENCODED}`)).toEqual(VALID_OFFER_PAYLOAD);
  });

  it("parses a bare offer= fragment without the leading #", () => {
    expect(parseConnectionOfferInput(`offer=${VALID_ENCODED}`)).toEqual(VALID_OFFER_PAYLOAD);
  });

  it("parses the raw base64url payload on its own", () => {
    expect(parseConnectionOfferInput(VALID_ENCODED)).toEqual(VALID_OFFER_PAYLOAD);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseConnectionOfferInput(`  ${VALID_URL}  \n`)).toEqual(VALID_OFFER_PAYLOAD);
  });

  it("rejects empty input with ConnectionOfferParseError", () => {
    expect(() => parseConnectionOfferInput("")).toThrow(ConnectionOfferParseError);
    expect(() => parseConnectionOfferInput("   ")).toThrow(ConnectionOfferParseError);
  });

  it("rejects non-base64 garbage with ConnectionOfferParseError, not a raw decode error", () => {
    expect(() => parseConnectionOfferInput("not-a-valid-offer-payload!!!")).toThrow(
      ConnectionOfferParseError,
    );
  });

  it("rejects base64 that decodes to invalid JSON", () => {
    const encoded = Buffer.from("not json", "utf8").toString("base64url");
    expect(() => parseConnectionOfferInput(`#offer=${encoded}`)).toThrow(ConnectionOfferParseError);
  });

  it("rejects a payload that fails ConnectionOffer schema validation", () => {
    const encoded = encodeBase64UrlNoPadUtf8(JSON.stringify({ v: 1, foo: "bar" }));
    expect(() => parseConnectionOfferInput(`#offer=${encoded}`)).toThrow(ConnectionOfferParseError);
  });

  it("rejects a v2 payload missing required fields", () => {
    const encoded = encodeBase64UrlNoPadUtf8(
      JSON.stringify({ v: 2, serverId: "server-123" /* missing daemonPublicKeyB64/relay */ }),
    );
    expect(() => parseConnectionOfferInput(`#offer=${encoded}`)).toThrow(ConnectionOfferParseError);
  });

  it("gives a distinct, human-readable message rather than a raw error", () => {
    try {
      parseConnectionOfferInput("garbage");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectionOfferParseError);
      expect((error as Error).message).toContain("isn't valid");
    }
  });
});

/** Deterministic, real-time-free `Clock` test double (mirrors `authenticate-host.test.ts`'s). */
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

/** A minimal `DaemonClientLike` double, mirroring `authenticate-host.test.ts`'s. */
class FakeDaemonClient implements connection.DaemonClientLike {
  private state: ConnectionState = { status: "idle" };
  private readonly statusListeners = new Set<(state: ConnectionState) => void>();

  constructor(
    public readonly config: DaemonClientConfig,
    private readonly behavior: "accept" | "reject" | "reject-decryption",
  ) {}

  async connect(): Promise<void> {
    if (this.behavior === "reject") {
      this.setState({ status: "disconnected", reason: "simulated: relay session gone" });
      throw new Error("simulated: relay session gone");
    }
    if (this.behavior === "reject-decryption") {
      // T27A6: the exact failure mode a stale/rotated `daemonPublicKeyB64`
      // produces — `packages/relay/src/crypto.ts`'s `decrypt()` throwing,
      // surfaced via `encrypted-channel.ts`'s `handleMessage` catch closing
      // the transport with this reason.
      this.setState({ status: "disconnected", reason: "Decryption failed" });
      throw new Error("Decryption failed");
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

function makeOptions(behavior: "accept" | "reject" | "reject-decryption") {
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
      createDaemonClient,
    },
  };
}

describe("createApplyConnectionOfferAttempt", () => {
  it("rejects a malformed offer before attempting any connection", async () => {
    const { options, seenConfigs } = makeOptions("accept");
    const attempt = createApplyConnectionOfferAttempt(options);

    const outcome = await attempt("not a pairing link");

    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("malformed");
    expect(outcome.savedProfileId).toBeNull();
    expect(seenConfigs).toHaveLength(0);
  });

  it("reports a well-formed offer whose relay/daemon rejects the handshake as expired, distinct from malformed", async () => {
    const { options } = makeOptions("reject");
    const attempt = createApplyConnectionOfferAttempt(options);

    const outcome = await attempt(VALID_URL);

    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("expired");
    expect(outcome.error).toBe(CONNECTION_OFFER_EXPIRED_MESSAGE);
    expect(outcome.savedProfileId).toBeNull();
  });

  it("reports a stale/rotated daemon key as its own kind, with its own message, distinct from a merely-unreachable relay (T27A6)", async () => {
    const { options } = makeOptions("reject-decryption");
    const attempt = createApplyConnectionOfferAttempt(options);

    const outcome = await attempt(VALID_URL);

    const { WRONG_DAEMON_KEY_MESSAGE } = await import("./connection-error.js");
    expect(outcome.ok).toBe(false);
    expect(outcome.kind).toBe("wrong-daemon-key");
    expect(outcome.error).toBe(WRONG_DAEMON_KEY_MESSAGE);
    expect(outcome.error).not.toBe(CONNECTION_OFFER_EXPIRED_MESSAGE);
    expect(outcome.savedProfileId).toBeNull();
  });

  it("never persists a profile from a wrong-daemon-key offer attempt", async () => {
    const { options, storage } = makeOptions("reject-decryption");
    const attempt = createApplyConnectionOfferAttempt(options);

    await attempt(VALID_URL);

    expect(await storage.list("hosts.profiles")).toEqual([]);
  });

  it("never persists a profile from an expired offer", async () => {
    const { options, storage } = makeOptions("reject");
    const attempt = createApplyConnectionOfferAttempt(options);

    await attempt(VALID_URL);

    expect(await storage.list("hosts.profiles")).toEqual([]);
  });

  it("pins the E2EE transport to the offer's daemon public key, never the connection URL", async () => {
    const { options, seenConfigs } = makeOptions("accept");
    const attempt = createApplyConnectionOfferAttempt(options);

    await attempt(VALID_URL);

    expect(seenConfigs).toHaveLength(1);
    expect(seenConfigs[0]?.e2ee).toEqual({ enabled: true, daemonPublicKeyB64: "pubkey-abc" });
    expect(seenConfigs[0]?.url).not.toContain("pubkey-abc");
    expect(seenConfigs[0]?.url).toContain("serverId=server-123");
  });

  it("persists a relay-only profile and returns its id on success", async () => {
    const { options, storage } = makeOptions("accept");
    const attempt = createApplyConnectionOfferAttempt(options);

    const outcome = await attempt(VALID_URL);

    expect(outcome.ok).toBe(true);
    expect(outcome.kind).toBe("success");
    expect(outcome.savedProfileId).toBeTruthy();

    const saved = await storage.get<hosts.HostProfile>(
      "hosts.profiles",
      outcome.savedProfileId ?? "",
    );
    expect(saved?.relay).toEqual({
      endpoint: "relay.paseo.sh:443",
      useTls: true,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey-abc",
    });
    expect(saved?.direct).toBeUndefined();
    expect(saved?.preferDirect).toBe(false);
  });

  it("never asks HostProfileStore to persist a password for an offer-derived profile", async () => {
    const { options, secrets } = makeOptions("accept");
    const attempt = createApplyConnectionOfferAttempt(options);

    const outcome = await attempt(VALID_URL);

    expect(await secrets.getSecret(`hosts.profile.${outcome.savedProfileId}.password`)).toBeNull();
  });
});
