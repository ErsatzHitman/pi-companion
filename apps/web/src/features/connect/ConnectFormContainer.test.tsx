import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { ConnectionState } from "@picompanion/client";
import type { connection } from "@picompanion/frontend-core";

import { CoreProvider } from "../../app/core-context.js";
import { ConnectFormContainer } from "./ConnectFormContainer.js";
import { createApplyConnectionOfferAttempt } from "./apply-connection-offer.js";
import type { CreateApplyConnectionOfferOptions } from "./apply-connection-offer.js";
import { createConnectAndAuthenticateAttempt } from "./authenticate-host.js";
import type { CreateConnectAndAuthenticateOptions } from "./authenticate-host.js";

afterEach(cleanup);

/**
 * A minimal `DaemonClientLike` double whose `connect()` rejects (as a
 * real daemon would for a wrong/missing token) so tests that make the
 * T27A1 reachability probe succeed never fall through to a real
 * `WebSocket` for the authentication step below it, and never reach
 * `HostProfileStore.save()` — which needs real IndexedDB, unavailable
 * under jsdom. The full save/persist/reload/logout path is
 * `authenticate-host.test.ts`'s job, entirely in-memory.
 */
class FakeRejectingDaemonClient implements connection.DaemonClientLike {
  private readonly listeners = new Set<(state: ConnectionState) => void>();
  async connect(): Promise<void> {
    for (const listener of this.listeners) {
      listener({ status: "disconnected", reason: "simulated auth check" });
    }
    throw new Error("simulated auth check");
  }
  async close(): Promise<void> {}
  getConnectionState(): ConnectionState {
    return { status: "disconnected", reason: "simulated auth check" };
  }
  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  subscribe(): () => void {
    return () => {};
  }
  getLastServerInfoMessage() {
    return null;
  }
}

/**
 * T27A1/T27A2: proves valid input really does "produce a connection
 * attempt through core" — `ConnectFormContainer` wires the form to a
 * real `createConnectAndAuthenticateAttempt` (backed by
 * `hosts.ConnectionProber`, `connection.DaemonClientLifecycle`, and
 * `hosts.HostProfileStore`), using this app's real `Clock`/`storage`/
 * `secrets` from `useCore()`. Only the browser `WebSocket`-backed probe
 * transport at the very bottom is faked here (`createAttempt`'s
 * injection point exists solely for this), so the test never opens a
 * real socket while still exercising the same core wiring production
 * code uses. `authenticate-host.test.ts` covers the persistence/logout
 * behavior of that wiring directly, in-memory, without a DOM.
 */
describe("ConnectFormContainer (T27A1/T27A2)", () => {
  it("attempts a real core connection probe for valid input and reports its outcome", async () => {
    const user = userEvent.setup();
    const seenUrls: string[] = [];
    const createAttempt = (options: CreateConnectAndAuthenticateOptions) =>
      createConnectAndAuthenticateAttempt({
        ...options,
        probe: async (url) => {
          seenUrls.push(url);
          throw new Error("simulated: nothing listening");
        },
      });

    render(
      <CoreProvider>
        <ConnectFormContainer createAttempt={createAttempt} />
      </CoreProvider>,
    );

    await user.type(screen.getByLabelText(/^Host address/), "localhost:6767");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Could not reach");
    expect(seenUrls).toEqual(["ws://localhost:6767/ws"]);
  });

  it("reuses the same attempt across submissions instead of rebuilding it on every render", async () => {
    const user = userEvent.setup();
    let buildCount = 0;
    const createAttempt = (options: CreateConnectAndAuthenticateOptions) => {
      buildCount += 1;
      return createConnectAndAuthenticateAttempt({
        ...options,
        probe: async () => {},
        createDaemonClient: () => new FakeRejectingDaemonClient(),
      });
    };

    render(
      <CoreProvider>
        <ConnectFormContainer createAttempt={createAttempt} />
      </CoreProvider>,
    );

    await user.type(screen.getByLabelText(/^Host address/), "localhost:6767");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByRole("status");

    expect(buildCount).toBe(1);
  });

  it("wires a stable, non-empty clientId so the daemon hello exchange never receives an empty identity", async () => {
    const user = userEvent.setup();
    const seenClientIds: string[] = [];
    const createAttempt = (options: CreateConnectAndAuthenticateOptions) => {
      seenClientIds.push(options.clientId);
      return createConnectAndAuthenticateAttempt({
        ...options,
        probe: async () => {},
        createDaemonClient: () => new FakeRejectingDaemonClient(),
      });
    };

    render(
      <CoreProvider>
        <ConnectFormContainer createAttempt={createAttempt} />
      </CoreProvider>,
    );

    await user.type(screen.getByLabelText(/^Host address/), "localhost:6767");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByRole("status");

    expect(seenClientIds).toHaveLength(1);
    expect(seenClientIds[0]).toBeTruthy();
  });
});

describe("ConnectFormContainer daemon-injected bootstrap (T27A5)", () => {
  it("attempts a connection from the injected hint without ever rendering the manual form", async () => {
    const createAttempt = (options: CreateConnectAndAuthenticateOptions) =>
      createConnectAndAuthenticateAttempt({
        ...options,
        probe: async () => new Promise(() => {}), // never resolves; keeps phase "connecting"
      });
    const readBootstrap = () => ({
      label: "my-mac",
      direct: { endpoint: "daemon.example.test:6767", useTls: false },
      preferDirect: true as const,
    });

    render(
      <CoreProvider>
        <ConnectFormContainer createAttempt={createAttempt} readBootstrap={readBootstrap} />
      </CoreProvider>,
    );

    const status = await screen.findByTestId("bootstrap-connect-status");
    expect(status.textContent).toContain("Connecting to my-mac");
    expect(screen.queryByLabelText(/^Host address/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });

  it("falls back to the manual form when there is no bootstrap hint", () => {
    render(
      <CoreProvider>
        <ConnectFormContainer readBootstrap={() => null} />
      </CoreProvider>,
    );

    expect(screen.getByLabelText(/^Host address/)).toBeTruthy();
    expect(screen.queryByTestId("bootstrap-connect-status")).toBeNull();
  });

  it("falls back to the manual form for a real malformed daemon-injected global, without throwing", () => {
    const globalWithBadHint = window as unknown as Record<string, unknown>;
    globalWithBadHint.__PASEO_INITIAL_DAEMON_CONNECTION__ = { listen: "", useTls: "nope" };
    try {
      render(
        <CoreProvider>
          <ConnectFormContainer />
        </CoreProvider>,
      );

      expect(screen.getByLabelText(/^Host address/)).toBeTruthy();
      expect(screen.queryByTestId("bootstrap-connect-status")).toBeNull();
    } finally {
      delete globalWithBadHint.__PASEO_INITIAL_DAEMON_CONNECTION__;
    }
  });

  it("never silently overrides an explicit user-entered host: switching to manual leaves the address field untouched", async () => {
    const user = userEvent.setup();
    const createAttempt = (options: CreateConnectAndAuthenticateOptions) =>
      createConnectAndAuthenticateAttempt({
        ...options,
        probe: async () => {},
        createDaemonClient: () => new FakeRejectingDaemonClient(),
      });
    const readBootstrap = () => ({
      label: "my-mac",
      direct: { endpoint: "daemon.example.test:6767", useTls: false },
      preferDirect: true as const,
    });

    render(
      <CoreProvider>
        <ConnectFormContainer createAttempt={createAttempt} readBootstrap={readBootstrap} />
      </CoreProvider>,
    );

    // The bootstrap attempt fails (simulated auth check) and lands on the
    // error phase, which offers an explicit "connect to a different
    // daemon" escape hatch.
    await screen.findByTestId("bootstrap-connect-error-banner");
    await user.click(screen.getByRole("button", { name: "Connect to a different daemon" }));

    const addressField = (await screen.findByLabelText(/^Host address/)) as HTMLInputElement;
    expect(addressField.value).toBe("");
    await user.type(addressField, "user-typed-host:1234");
    expect(addressField.value).toBe("user-typed-host:1234");
  });
});

/** Mirrors `apply-connection-offer.test.ts`'s own encoder. */
function encodeBase64UrlNoPadUtf8(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
const VALID_OFFER_URL = `https://app.paseo.sh/#offer=${encodeBase64UrlNoPadUtf8(
  JSON.stringify({
    v: 2,
    serverId: "server-123",
    daemonPublicKeyB64: "pubkey-abc",
    relay: { endpoint: "relay.paseo.sh:443", useTls: true },
  }),
)}`;

describe("ConnectFormContainer pairing-link offers (T27A3)", () => {
  it("wires the real createApplyConnectionOfferAttempt so a valid offer pairs through core", async () => {
    const user = userEvent.setup();
    const seenUrls: string[] = [];
    const createApplyOffer = (options: CreateApplyConnectionOfferOptions) =>
      createApplyConnectionOfferAttempt({
        ...options,
        createDaemonClient: (config) => {
          seenUrls.push(config.url);
          return new FakeRejectingDaemonClient();
        },
      });

    render(
      <CoreProvider>
        <ConnectFormContainer createApplyOffer={createApplyOffer} />
      </CoreProvider>,
    );

    await user.type(screen.getByLabelText("Pairing link"), VALID_OFFER_URL);
    await user.click(screen.getByRole("button", { name: "Pair" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("no longer valid");
    expect(seenUrls).toHaveLength(1);
    expect(seenUrls[0]).toContain("serverId=server-123");
  });

  it("rejects a malformed pairing link without ever building a connection", async () => {
    const user = userEvent.setup();
    let buildCount = 0;
    const createApplyOffer = (options: CreateApplyConnectionOfferOptions) => {
      const attempt = createApplyConnectionOfferAttempt({
        ...options,
        createDaemonClient: () => {
          buildCount += 1;
          return new FakeRejectingDaemonClient();
        },
      });
      return attempt;
    };

    render(
      <CoreProvider>
        <ConnectFormContainer createApplyOffer={createApplyOffer} />
      </CoreProvider>,
    );

    await user.type(screen.getByLabelText("Pairing link"), "not a pairing link");
    await user.click(screen.getByRole("button", { name: "Pair" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("isn't valid");
    expect(buildCount).toBe(0);
  });
});
