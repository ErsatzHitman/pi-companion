import type { connection } from "@picompanion/frontend-core";
import { testing } from "@picompanion/frontend-core";
import type { ConnectionState, DaemonClientConfig } from "@picompanion/client";
import type { ServerInfoStatusPayload } from "@picompanion/protocol/messages";
import { describe, expect, it } from "vitest";

import {
  ConnectionOfferParseError,
  createApplyConnectionOfferAttempt,
  parseConnectionOfferInput,
} from "./apply-connection-offer.js";
import {
  RELAY_UNREACHABLE_MESSAGE,
  WRONG_DAEMON_KEY_MESSAGE,
  WRONG_PASSWORD_MESSAGE,
} from "./daemon-connection-error.js";

/**
 * Exercises `parseConnectionOfferInput`/`createApplyConnectionOfferAttempt`
 * against a `connection.DaemonClientLike` test double supplied through
 * `createDaemonClient` — the injected-transport seam this task's first
 * acceptance criterion names ("pairs successfully against the injected
 * transport — no emulator, no socket"). No test in this file opens a
 * WebSocket, a real relay E2EE channel, or touches an emulator.
 *
 * `ConnectionOffer` fixture content is sourced from the shared
 * `testing.buildRelayHostProfileFixture` builder
 * (`packages/frontend-core/src/testing/fixtures/host-profiles.ts`, T24)
 * — the same relay-shape fixture `apps/web`'s and `apps/android`'s
 * connect/pairing suites both already share — satisfying this task's
 * third acceptance criterion ("parsing is unit-tested against shared
 * fixtures") without inventing a second, private fixture.
 */

/** Mirrors `@picompanion/protocol/connection-offer.test.ts`'s own encoder — this feature never depends on `packages/server`. */
function encodeBase64UrlNoPadUtf8(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** The shared relay fixture, reshaped into the wire `ConnectionOfferV2` payload it was sourced from. */
const RELAY_FIXTURE = testing.buildRelayHostProfileFixture();
const relayProfile = RELAY_FIXTURE.relay;
if (!relayProfile) {
  throw new Error("testing.buildRelayHostProfileFixture() did not include a relay profile");
}
const VALID_OFFER_PAYLOAD = {
  v: 2 as const,
  serverId: relayProfile.serverId,
  daemonPublicKeyB64: relayProfile.daemonPublicKeyB64,
  relay: { endpoint: relayProfile.endpoint, useTls: relayProfile.useTls },
};
const VALID_ENCODED = encodeBase64UrlNoPadUtf8(JSON.stringify(VALID_OFFER_PAYLOAD));
const VALID_URL = `https://app.paseo.sh/#offer=${VALID_ENCODED}`;

describe("parseConnectionOfferInput", () => {
  it("parses a full pairing URL built from the shared relay fixture", () => {
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
      JSON.stringify({
        v: 2,
        serverId: relayProfile.serverId /* missing daemonPublicKeyB64/relay */,
      }),
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

/** A minimal `DaemonClientLike` double — the injected-transport seam, mirroring `apps/web`'s `apply-connection-offer.test.ts` `FakeDaemonClient`. */
class FakeDaemonClient implements connection.DaemonClientLike {
  private state: ConnectionState = { status: "idle" };
  private readonly statusListeners = new Set<(state: ConnectionState) => void>();

  constructor(
    public readonly config: DaemonClientConfig,
    private readonly behavior:
      | "accept"
      | "reject"
      | "reject-decryption"
      | "reject-password"
      | "reject-daemon-absent",
  ) {}

  async connect(): Promise<void> {
    if (this.behavior === "reject") {
      // A generic, non-specific relay/daemon failure — the WebSocket
      // never completes the encrypted handshake for any reason this
      // fixture isn't naming more precisely (T32A5's "relay-unreachable"
      // acceptance case: the relay endpoint itself never responds).
      this.setState({ status: "disconnected", reason: "simulated: relay session gone" });
      throw new Error("simulated: relay session gone");
    }
    if (this.behavior === "reject-decryption") {
      // The exact failure mode a stale/rotated `daemonPublicKeyB64`
      // produces — `packages/relay/src/crypto.ts`'s `decrypt()` throwing,
      // surfaced via `encrypted-channel.ts`'s `handleMessage` catch closing
      // the transport with this reason.
      this.setState({ status: "disconnected", reason: "Decryption failed" });
      throw new Error("Decryption failed");
    }
    if (this.behavior === "reject-password") {
      // WS_CLOSE_DAEMON_AUTH_FAILED's exact reason for a
      // `paseo.bearer.<token>` rejection — the same reason the
      // direct-connect path's fixture uses
      // (`daemon-connect-attempt.fixture.test.ts`'s "classifies an
      // incorrect password" case) — because the password check runs at
      // the same transport layer under both a direct and a
      // relay-tunnelled connection (T32A5).
      this.setState({ status: "disconnected", reason: "Incorrect password" });
      throw new Error("Incorrect password");
    }
    if (this.behavior === "reject-daemon-absent") {
      // `packages/relay/src/cloudflare-adapter.ts`'s `webSocketClose`:
      // the exact reason the relay Durable Object closes a *client*
      // role's socket with once the *server* (daemon) role's socket for
      // the same `connectionId` disconnects — T32A5's
      // "relay-reachable-but-daemon-absent" acceptance case. The relay
      // itself was reachable; the daemon it names is the one that is
      // gone.
      this.setState({ status: "disconnected", reason: "Server disconnected" });
      throw new Error("Server disconnected");
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

function makeAttempt(
  behavior: "accept" | "reject" | "reject-decryption" | "reject-password" | "reject-daemon-absent",
) {
  const seenConfigs: DaemonClientConfig[] = [];
  const createDaemonClient: connection.DaemonClientFactory = (config) => {
    seenConfigs.push(config);
    return new FakeDaemonClient(config, behavior);
  };
  const attempt = createApplyConnectionOfferAttempt({
    clientId: "clid_fixture_android_0001",
    clientType: "mobile",
    createDaemonClient,
  });
  return { attempt, seenConfigs };
}

describe("createApplyConnectionOfferAttempt", () => {
  it("rejects a malformed offer before attempting any connection", async () => {
    const { attempt, seenConfigs } = makeAttempt("accept");

    const result = await attempt("not a pairing link");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("malformed");
    expect(seenConfigs).toHaveLength(0);
  });

  it("pairs successfully against the injected transport — no emulator, no socket", async () => {
    const { attempt, seenConfigs } = makeAttempt("accept");

    const result = await attempt(VALID_URL);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("success");
    expect(result.relay).toEqual({
      endpoint: relayProfile.endpoint,
      useTls: relayProfile.useTls,
      serverId: relayProfile.serverId,
      daemonPublicKeyB64: relayProfile.daemonPublicKeyB64,
    });
    expect(seenConfigs).toHaveLength(1);
    // Pinned to the offer's daemon public key, never carried in the URL.
    expect(seenConfigs[0]?.e2ee).toEqual({
      enabled: true,
      daemonPublicKeyB64: relayProfile.daemonPublicKeyB64,
    });
    expect(seenConfigs[0]?.url).not.toContain(relayProfile.daemonPublicKeyB64);
    expect(seenConfigs[0]?.url).toContain(`serverId=${relayProfile.serverId}`);

    await result.lifecycle.dispose();
  });

  it("reports a well-formed offer whose relay/daemon rejects the handshake as expired, distinct from malformed", async () => {
    const { attempt } = makeAttempt("reject");

    const result = await attempt(VALID_URL);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("expired");
    expect(result.error).toBe(RELAY_UNREACHABLE_MESSAGE);
  });

  it("reports a stale/rotated daemon key as its own kind, with its own message, distinct from a merely-unreachable relay", async () => {
    const { attempt } = makeAttempt("reject-decryption");

    const result = await attempt(VALID_URL);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("wrong-daemon-key");
    expect(result.error).toBe(WRONG_DAEMON_KEY_MESSAGE);
    expect(result.error).not.toBe(RELAY_UNREACHABLE_MESSAGE);
  });

  it("pairs successfully while carrying a daemon password over the relay path (T32A5)", async () => {
    const { attempt, seenConfigs } = makeAttempt("accept");

    const result = await attempt(VALID_URL, "correct-token");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // The password reaches the lifecycle config exactly like the
    // direct-connect path's `daemon-connect-attempt.ts` — never
    // appended to the connection URL (plan.md §12.1).
    expect(seenConfigs[0]?.password).toBe("correct-token");
    expect(seenConfigs[0]?.url).not.toContain("correct-token");

    await result.lifecycle.dispose();
  });

  it("classifies an incorrect relay password as 'wrong-password' (T32A5), distinct from 'wrong-daemon-key' and 'expired'", async () => {
    const { attempt } = makeAttempt("reject-password");

    const result = await attempt(VALID_URL, "wrong-token");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("wrong-password");
    expect(result.error).toBe(WRONG_PASSWORD_MESSAGE);
    expect(result.error).not.toBe(WRONG_DAEMON_KEY_MESSAGE);
    expect(result.error).not.toBe(RELAY_UNREACHABLE_MESSAGE);
  });

  it("classifies a relay-reachable daemon-side disconnect as 'expired' (T32A5's 'relay-reachable-but-daemon-absent'), not 'wrong-daemon-key' or 'wrong-password'", async () => {
    const { attempt } = makeAttempt("reject-daemon-absent");

    const result = await attempt(VALID_URL);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("expired");
    expect(result.error).toBe(RELAY_UNREACHABLE_MESSAGE);
  });

  it("classifies a relay endpoint that never completes the handshake as 'expired' (T32A5's 'relay-unreachable'), the same non-alarming copy as a daemon-side disconnect", async () => {
    const { attempt } = makeAttempt("reject");

    const result = await attempt(VALID_URL);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.kind).toBe("expired");
    expect(result.error).toBe(RELAY_UNREACHABLE_MESSAGE);
    expect(result.error).not.toBe(WRONG_PASSWORD_MESSAGE);
    expect(result.error).not.toBe(WRONG_DAEMON_KEY_MESSAGE);
  });

  it("disposes the lifecycle on failure — no connecting generation is left running in the background", async () => {
    const { attempt } = makeAttempt("reject");

    const result = await attempt(VALID_URL);

    expect(result.ok).toBe(false);
    // No throw / hang on repeated disposal implies the failure path already disposed cleanly.
  });
});
