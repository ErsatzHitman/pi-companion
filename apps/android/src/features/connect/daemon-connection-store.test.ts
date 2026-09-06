import { describe, expect, it, vi } from "vitest";
import type { connection } from "@picompanion/frontend-core";

import { parseConnectAddress } from "./connect-form-model.js";
import type { ConnectAttemptResult, DaemonConnectAttempt } from "./daemon-connect-attempt.js";
import {
  buildDaemonHttpOrigin,
  createDaemonConnectionStore,
  parseHostProfileEndpoint,
  type DaemonConnectionSourceProfile,
} from "./daemon-connection-store.js";

const ADDRESS = (() => {
  const result = parseConnectAddress("ws://192.168.1.10:6767");
  if (!result.ok) throw new Error("test address failed to parse");
  return result.value;
})();

/** A non-default port and an IPv6 literal — the two shapes a WS-URL reconstruction would have gotten wrong (see the store's module docstring). */
const IPV6_NON_DEFAULT_PORT_ADDRESS = (() => {
  const result = parseConnectAddress("wss://[2001:db8::1]:8443");
  if (!result.ok) throw new Error("test IPv6 address failed to parse");
  return result.value;
})();

/** Minimal fake standing in for `connection.DaemonClientLifecycle` — this test proves the store's own adopt/teardown bookkeeping, not the real lifecycle (that is `daemon-connect-attempt.fixture.test.ts`'s job). */
function makeFakeLifecycle(): {
  lifecycle: connection.DaemonClientLifecycle;
  dispose: ReturnType<typeof vi.fn>;
  emitStatus: (status: connection.DaemonClientLifecycleStatus) => void;
} {
  const statusListeners = new Set<(status: connection.DaemonClientLifecycleStatus) => void>();
  let currentStatus: connection.DaemonClientLifecycleStatus = "connected";
  const dispose = vi.fn(async () => {});
  const lifecycle = {
    subscribeStatus: (listener: (status: connection.DaemonClientLifecycleStatus) => void) => {
      statusListeners.add(listener);
      listener(currentStatus);
      return () => {
        statusListeners.delete(listener);
      };
    },
    dispose,
  } as unknown as connection.DaemonClientLifecycle;
  return {
    lifecycle,
    dispose,
    emitStatus: (status) => {
      currentStatus = status;
      for (const listener of statusListeners) listener(status);
    },
  };
}

function makeAttempt(
  script: (address: unknown, password: string | undefined) => Promise<ConnectAttemptResult>,
): DaemonConnectAttempt {
  return script as DaemonConnectAttempt;
}

describe("createDaemonConnectionStore", () => {
  it("starts idle with no active lifecycle", () => {
    const store = createDaemonConnectionStore(
      makeAttempt(async () => {
        throw new Error("should not be called");
      }),
    );
    expect(store.getSnapshot()).toEqual({
      phase: "idle",
      error: null,
      path: null,
      daemonAddress: null,
    });
    expect(store.getActiveLifecycle()).toBeNull();
  });

  it("publishes 'connecting' immediately, then adopts the lifecycle and forwards its status — with path 'direct' (T32A5) — on success", async () => {
    const { lifecycle, emitStatus } = makeFakeLifecycle();
    const attempt = makeAttempt(async () => ({ ok: true, lifecycle }));
    const store = createDaemonConnectionStore(attempt);

    const snapshots: connection.DaemonClientLifecycleStatus[] = [];
    store.subscribe((snapshot) => snapshots.push(snapshot.phase));

    const result = await store.connect(ADDRESS);
    expect(result.ok).toBe(true);
    expect(store.getActiveLifecycle()).toBe(lifecycle);
    expect(store.getSnapshot()).toEqual({
      phase: "connected",
      error: null,
      path: "direct",
      daemonAddress: { host: "192.168.1.10", port: 6767, useTls: false, isIpv6: false },
    });

    emitStatus("disconnected");
    expect(store.getSnapshot()).toEqual({
      phase: "disconnected",
      error: null,
      path: "direct",
      daemonAddress: { host: "192.168.1.10", port: 6767, useTls: false, isIpv6: false },
    });
    expect(snapshots).toEqual(["connecting", "connected", "disconnected"]);
  });

  it("publishes the classified error and returns to idle with path null on failure, adopting nothing", async () => {
    const attempt = makeAttempt(async () => ({
      ok: false,
      kind: "unreachable",
      error: "Could not reach the daemon. Check the address and try again.",
    }));
    const store = createDaemonConnectionStore(attempt);

    const result = await store.connect(ADDRESS);
    expect(result.ok).toBe(false);
    expect(store.getActiveLifecycle()).toBeNull();
    expect(store.getSnapshot()).toEqual({
      phase: "idle",
      error: "Could not reach the daemon. Check the address and try again.",
      path: null,
      daemonAddress: null,
    });
  });

  it("a second successful connect() disposes the first lifecycle before adopting the second", async () => {
    const first = makeFakeLifecycle();
    const second = makeFakeLifecycle();
    let call = 0;
    const attempt = makeAttempt(async () => {
      call += 1;
      return { ok: true, lifecycle: call === 1 ? first.lifecycle : second.lifecycle };
    });
    const store = createDaemonConnectionStore(attempt);

    await store.connect(ADDRESS);
    expect(store.getActiveLifecycle()).toBe(first.lifecycle);

    await store.connect(ADDRESS);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(store.getActiveLifecycle()).toBe(second.lifecycle);

    // The first lifecycle's status changes no longer reach the store —
    // it was torn down, not merely superseded.
    first.emitStatus("disconnected");
    expect(store.getSnapshot().phase).not.toBe("disconnected");
  });

  it("dispose() tears down the active lifecycle and resets to idle", async () => {
    const { lifecycle, dispose } = makeFakeLifecycle();
    const attempt = makeAttempt(async () => ({ ok: true, lifecycle }));
    const store = createDaemonConnectionStore(attempt);

    await store.connect(ADDRESS);
    expect(store.getActiveLifecycle()).toBe(lifecycle);

    await store.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(store.getActiveLifecycle()).toBeNull();
    expect(store.getSnapshot()).toEqual({
      phase: "idle",
      error: null,
      path: null,
      daemonAddress: null,
    });
  });

  it("adoptLifecycle() publishes the adopted lifecycle's current status immediately — with path 'relay' (T32A5) — and forwards further changes", async () => {
    const { lifecycle, emitStatus } = makeFakeLifecycle();
    const store = createDaemonConnectionStore(
      makeAttempt(async () => {
        throw new Error("should not be called");
      }),
    );

    const snapshots: connection.DaemonClientLifecycleStatus[] = [];
    store.subscribe((snapshot) => snapshots.push(snapshot.phase));

    await store.adoptLifecycle(lifecycle);
    expect(store.getActiveLifecycle()).toBe(lifecycle);
    expect(store.getSnapshot()).toEqual({
      phase: "connected",
      error: null,
      path: "relay",
      daemonAddress: null,
    });

    emitStatus("disconnected");
    expect(store.getSnapshot()).toEqual({
      phase: "disconnected",
      error: null,
      path: "relay",
      daemonAddress: null,
    });
    expect(snapshots).toEqual(["connected", "disconnected"]);
  });

  // P5-W20 merge gate. T66's `ReconnectSuccess.path` reports the real
  // `"direct" | "relay"` for a reconnected saved profile, and T32S14's
  // `deriveReconnectOutcome` threads it to `connection-shell.tsx` — but
  // `adoptLifecycle()` took no path and hardcoded `"relay"`, so a
  // reconnected direct profile was published, and shown, as a relay
  // connection. This is the behavioural proof of the widened signature;
  // the case above still proves the default is unchanged for the
  // QR/pasted-offer callers that pass nothing.
  it("adoptLifecycle() publishes the caller's own path — a reconnected direct profile is 'direct', not 'relay'", async () => {
    const { lifecycle, emitStatus } = makeFakeLifecycle();
    const store = createDaemonConnectionStore(
      makeAttempt(async () => {
        throw new Error("should not be called");
      }),
    );

    await store.adoptLifecycle(lifecycle, "direct");
    expect(store.getSnapshot()).toEqual({
      phase: "connected",
      error: null,
      path: "direct",
      daemonAddress: null,
    });

    // The path survives later status changes exactly like connect()'s does.
    emitStatus("disconnected");
    expect(store.getSnapshot().path).toBe("direct");
  });

  it("path distinguishes connect() ('direct') from adoptLifecycle() ('relay') on the very same store (T32A5, 'connection path is visible')", async () => {
    const direct = makeFakeLifecycle();
    const relay = makeFakeLifecycle();
    const attempt = makeAttempt(async () => ({ ok: true, lifecycle: direct.lifecycle }));
    const store = createDaemonConnectionStore(attempt);

    await store.connect(ADDRESS);
    expect(store.getSnapshot().path).toBe("direct");

    await store.adoptLifecycle(relay.lifecycle);
    expect(store.getSnapshot().path).toBe("relay");
    // Adopting the relay lifecycle tore down the direct one — proven
    // already by the "disposes a prior generation" case below; here we
    // only need `path` to have actually flipped, not stayed "direct".
    expect(direct.dispose).toHaveBeenCalledTimes(1);
  });

  it("adoptLifecycle() disposes a prior generation from connect() before adopting the new one", async () => {
    const first = makeFakeLifecycle();
    const second = makeFakeLifecycle();
    const attempt = makeAttempt(async () => ({ ok: true, lifecycle: first.lifecycle }));
    const store = createDaemonConnectionStore(attempt);

    await store.connect(ADDRESS);
    expect(store.getActiveLifecycle()).toBe(first.lifecycle);

    await store.adoptLifecycle(second.lifecycle);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(store.getActiveLifecycle()).toBe(second.lifecycle);

    first.emitStatus("disconnected");
    expect(store.getSnapshot().phase).not.toBe("disconnected");
  });

  it("unsubscribe stops further notifications", async () => {
    const { lifecycle, emitStatus } = makeFakeLifecycle();
    const attempt = makeAttempt(async () => ({ ok: true, lifecycle }));
    const store = createDaemonConnectionStore(attempt);

    const received: connection.DaemonClientLifecycleStatus[] = [];
    const unsubscribe = store.subscribe((snapshot) => received.push(snapshot.phase));
    await store.connect(ADDRESS);
    unsubscribe();
    emitStatus("disconnected");

    expect(received).not.toContain("disconnected");
  });

  it("carries the daemon's host/port through to a successful connect() untouched — including a bracketed IPv6 literal and a non-default port, the two shapes a WS-URL reconstruction gets wrong (T32A7)", async () => {
    const { lifecycle } = makeFakeLifecycle();
    const attempt = makeAttempt(async () => ({ ok: true, lifecycle }));
    const store = createDaemonConnectionStore(attempt);

    await store.connect(IPV6_NON_DEFAULT_PORT_ADDRESS);

    expect(store.getSnapshot().daemonAddress).toEqual({
      host: "2001:db8::1",
      port: 8443,
      useTls: true,
      isIpv6: true,
    });
    // The origin string is built from those carried fields, not from
    // any WS URL — bracketing the bare IPv6 host itself.
    expect(buildDaemonHttpOrigin(store.getSnapshot().daemonAddress!)).toBe(
      "https://[2001:db8::1]:8443",
    );
  });

  it("builds a plain (non-TLS, non-IPv6) HTTP origin the same way", () => {
    expect(
      buildDaemonHttpOrigin({ host: "192.168.1.10", port: 6767, useTls: false, isIpv6: false }),
    ).toBe("http://192.168.1.10:6767");
  });

  it("daemonAddress is null before any connect(), during 'connecting', on a failed attempt, and after dispose() — only a successful direct connect() ever sets it", async () => {
    const { lifecycle } = makeFakeLifecycle();
    let resolveAttempt: (result: ConnectAttemptResult) => void;
    const pending = new Promise<ConnectAttemptResult>((resolve) => {
      resolveAttempt = resolve;
    });
    const attempt = makeAttempt(async () => pending);
    const store = createDaemonConnectionStore(attempt);

    expect(store.getSnapshot().daemonAddress).toBeNull();

    const connecting = store.connect(ADDRESS);
    // connect() awaits teardownActiveLifecycle() (a no-op microtask here)
    // before publishing "connecting" — give it a turn.
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getSnapshot().phase).toBe("connecting");
    expect(store.getSnapshot().daemonAddress).toBeNull();
    resolveAttempt!({ ok: true, lifecycle });
    await connecting;
    expect(store.getSnapshot().daemonAddress).not.toBeNull();

    await store.dispose();
    expect(store.getSnapshot().daemonAddress).toBeNull();

    const failingAttempt = makeAttempt(async () => ({
      ok: false,
      kind: "unreachable",
      error: "Could not reach the daemon. Check the address and try again.",
    }));
    const failingStore = createDaemonConnectionStore(failingAttempt);
    await failingStore.connect(ADDRESS);
    expect(failingStore.getSnapshot().daemonAddress).toBeNull();
  });

  it("adoptLifecycle() (relay/QR path) never populates daemonAddress — a relay tunnel has no directly-reachable daemon HTTP origin", async () => {
    const { lifecycle, emitStatus } = makeFakeLifecycle();
    const store = createDaemonConnectionStore(
      makeAttempt(async () => {
        throw new Error("should not be called");
      }),
    );

    await store.adoptLifecycle(lifecycle);
    expect(store.getSnapshot().daemonAddress).toBeNull();
    emitStatus("disconnected");
    expect(store.getSnapshot().daemonAddress).toBeNull();
  });

  it("a second connect() to a different address replaces daemonAddress, not merges it — no stale host survives a new generation", async () => {
    const first = makeFakeLifecycle();
    const second = makeFakeLifecycle();
    let call = 0;
    const attempt = makeAttempt(async () => {
      call += 1;
      return { ok: true, lifecycle: call === 1 ? first.lifecycle : second.lifecycle };
    });
    const store = createDaemonConnectionStore(attempt);

    await store.connect(ADDRESS);
    expect(store.getSnapshot().daemonAddress?.port).toBe(6767);

    await store.connect(IPV6_NON_DEFAULT_PORT_ADDRESS);
    expect(store.getSnapshot().daemonAddress).toEqual({
      host: "2001:db8::1",
      port: 8443,
      useTls: true,
      isIpv6: true,
    });
  });

  // T73: found at the P5-W20 merge gate immediately after that gate fixed
  // `path` for a reconnected direct profile — `daemonAddress` was still
  // `null`, so a reconnected direct profile offered no download origin
  // and no probe URL, the two things a direct connection exists to
  // provide. These cases prove the value actually reaches those two real
  // consumers (`buildDaemonHttpOrigin` and `app-shell/core.ts`'s
  // `getProbeUrl`-shaped read), not merely that the field is non-null.
  describe("adoptLifecycle() reconstructs daemonAddress on a direct reconnect (T73)", () => {
    it("a 'direct' adopt with a sourceProfile reconstructs a real daemonAddress, proven by a real download origin/probe URL", async () => {
      const { lifecycle } = makeFakeLifecycle();
      const store = createDaemonConnectionStore(
        makeAttempt(async () => {
          throw new Error("should not be called");
        }),
      );
      const sourceProfile: DaemonConnectionSourceProfile = {
        endpoint: "192.168.1.20:6767",
        useTls: false,
        isIpv6: false,
      };

      await store.adoptLifecycle(lifecycle, "direct", sourceProfile);

      const address = store.getSnapshot().daemonAddress;
      expect(address).toEqual({
        host: "192.168.1.20",
        port: 6767,
        useTls: false,
        isIpv6: false,
      });
      // The value reaching a real consumer — not just a non-null field.
      expect(buildDaemonHttpOrigin(address!)).toBe("http://192.168.1.20:6767");
    });

    it("reconstructs a bracketed IPv6 endpoint the same way", async () => {
      const { lifecycle } = makeFakeLifecycle();
      const store = createDaemonConnectionStore(
        makeAttempt(async () => {
          throw new Error("should not be called");
        }),
      );
      const sourceProfile: DaemonConnectionSourceProfile = {
        endpoint: "[2001:db8::1]:8443",
        useTls: true,
        isIpv6: true,
      };

      await store.adoptLifecycle(lifecycle, "direct", sourceProfile);

      const address = store.getSnapshot().daemonAddress;
      expect(address).toEqual({
        host: "2001:db8::1",
        port: 8443,
        useTls: true,
        isIpv6: true,
      });
      expect(buildDaemonHttpOrigin(address!)).toBe("https://[2001:db8::1]:8443");
    });

    it("a 'relay' adopt never reconstructs daemonAddress even when given a sourceProfile", async () => {
      const { lifecycle } = makeFakeLifecycle();
      const store = createDaemonConnectionStore(
        makeAttempt(async () => {
          throw new Error("should not be called");
        }),
      );
      const sourceProfile: DaemonConnectionSourceProfile = {
        endpoint: "192.168.1.20:6767",
        useTls: false,
        isIpv6: false,
      };

      await store.adoptLifecycle(lifecycle, "relay", sourceProfile);
      expect(store.getSnapshot().daemonAddress).toBeNull();
    });

    it("a malformed or unparseable stored endpoint lands in the named, already-handled null state — never a throw, never a garbage address", async () => {
      const { lifecycle } = makeFakeLifecycle();
      const store = createDaemonConnectionStore(
        makeAttempt(async () => {
          throw new Error("should not be called");
        }),
      );
      const malformed: DaemonConnectionSourceProfile = {
        endpoint: "not-a-valid-endpoint",
        useTls: false,
        isIpv6: false,
      };

      await expect(store.adoptLifecycle(lifecycle, "direct", malformed)).resolves.toBeUndefined();
      expect(store.getSnapshot()).toEqual({
        phase: "connected",
        error: null,
        path: "direct",
        daemonAddress: null,
      });
    });

    it("parseHostProfileEndpoint rejects an IPv6 endpoint missing brackets, a bracketed endpoint claiming isIpv6: false, an out-of-range port, and a non-numeric port", () => {
      expect(
        parseHostProfileEndpoint({ endpoint: "2001:db8::1:8443", useTls: true, isIpv6: true }),
      ).toBeNull();
      expect(
        parseHostProfileEndpoint({
          endpoint: "[2001:db8::1]:8443",
          useTls: true,
          isIpv6: false,
        }),
      ).toBeNull();
      expect(
        parseHostProfileEndpoint({ endpoint: "192.168.1.20:70000", useTls: false, isIpv6: false }),
      ).toBeNull();
      expect(
        parseHostProfileEndpoint({ endpoint: "192.168.1.20:abc", useTls: false, isIpv6: false }),
      ).toBeNull();
    });

    it("an omitted sourceProfile on a 'direct' adopt still publishes daemonAddress: null, not a throw", async () => {
      const { lifecycle } = makeFakeLifecycle();
      const store = createDaemonConnectionStore(
        makeAttempt(async () => {
          throw new Error("should not be called");
        }),
      );

      await store.adoptLifecycle(lifecycle, "direct");
      expect(store.getSnapshot().daemonAddress).toBeNull();
    });

    it("daemonAddress survives a later status change on the same generation, exactly like connect()'s does", async () => {
      const { lifecycle, emitStatus } = makeFakeLifecycle();
      const store = createDaemonConnectionStore(
        makeAttempt(async () => {
          throw new Error("should not be called");
        }),
      );
      const sourceProfile: DaemonConnectionSourceProfile = {
        endpoint: "192.168.1.20:6767",
        useTls: false,
        isIpv6: false,
      };

      await store.adoptLifecycle(lifecycle, "direct", sourceProfile);
      emitStatus("disconnected");
      expect(store.getSnapshot().daemonAddress).toEqual({
        host: "192.168.1.20",
        port: 6767,
        useTls: false,
        isIpv6: false,
      });
    });

    it("never logs the endpoint host or port while reconstructing daemonAddress", async () => {
      const { lifecycle } = makeFakeLifecycle();
      const store = createDaemonConnectionStore(
        makeAttempt(async () => {
          throw new Error("should not be called");
        }),
      );
      const sourceProfile: DaemonConnectionSourceProfile = {
        endpoint: "192.168.1.20:6767",
        useTls: false,
        isIpv6: false,
      };
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        await store.adoptLifecycle(lifecycle, "direct", sourceProfile);
        for (const spy of [logSpy, warnSpy, errorSpy]) {
          expect(spy).not.toHaveBeenCalled();
        }
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });
  });

  it("never logs the daemon host or port across a full connect/status-change/dispose cycle (T32A7's third criterion)", async () => {
    const { lifecycle, emitStatus } = makeFakeLifecycle();
    const attempt = makeAttempt(async () => ({ ok: true, lifecycle }));
    const store = createDaemonConnectionStore(attempt);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    try {
      await store.connect(IPV6_NON_DEFAULT_PORT_ADDRESS);
      emitStatus("disconnected");
      emitStatus("connected");
      await store.dispose();

      for (const spy of [logSpy, warnSpy, errorSpy, infoSpy, debugSpy]) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      infoSpy.mockRestore();
      debugSpy.mockRestore();
    }
  });
});
