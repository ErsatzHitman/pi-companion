import { describe, expect, it } from "vitest";
import { ConnectionProber, type HostProbeTransport } from "./connection-prober.js";
import { FakeClock } from "./test-support/fake-clock.js";
import type { HostProfile } from "./types.js";

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

describe("ConnectionProber", () => {
  it("selects direct when it is reachable, without trying relay", async () => {
    const clock = new FakeClock();
    const attemptedUrls: string[] = [];
    const probe: HostProbeTransport = async (url) => {
      attemptedUrls.push(url);
    };
    const prober = new ConnectionProber({ clock, probe });

    const selection = await prober.selectConnection(bothConfigured);
    expect(selection.selectedKind).toBe("direct");
    expect(selection.attempts).toHaveLength(1);
    expect(selection.attempts[0]?.outcome).toBe("reachable");
    expect(attemptedUrls).toHaveLength(1);
  });

  it("falls back to relay deterministically when direct is unreachable", async () => {
    const clock = new FakeClock();
    const probe: HostProbeTransport = async (url) => {
      if (url.includes("relay.paseo.sh")) return;
      throw new Error("ECONNREFUSED");
    };
    const prober = new ConnectionProber({ clock, probe });

    const selection = await prober.selectConnection(bothConfigured);
    expect(selection.selectedKind).toBe("relay");
    expect(selection.attempts.map((attempt) => attempt.kind)).toEqual(["direct", "relay"]);
    expect(selection.attempts[0]?.outcome).toBe("unreachable");
    expect(selection.attempts[0]?.error).toContain("ECONNREFUSED");
    expect(selection.attempts[1]?.outcome).toBe("reachable");
  });

  it("resolves with selectedKind null and every attempt recorded when nothing is reachable", async () => {
    const clock = new FakeClock();
    const probe: HostProbeTransport = async () => {
      throw new Error("unreachable");
    };
    const prober = new ConnectionProber({ clock, probe });

    const selection = await prober.selectConnection(bothConfigured);
    expect(selection.selectedKind).toBeNull();
    expect(selection.selectedUrl).toBeNull();
    expect(selection.attempts).toHaveLength(2);
    expect(selection.attempts.every((attempt) => attempt.outcome === "unreachable")).toBe(true);
  });

  it("times out a hung probe attempt via the injected clock rather than waiting forever", async () => {
    const clock = new FakeClock();
    const probe: HostProbeTransport = () => new Promise(() => {}); // never resolves/rejects
    const prober = new ConnectionProber({ clock, probe, timeoutMs: 500 });

    const selectionPromise = prober.selectConnection({
      ...bothConfigured,
      relay: undefined,
    });
    // Let the microtask queue drain so selectConnection has scheduled the timeout.
    await Promise.resolve();
    clock.advance(500);
    const selection = await selectionPromise;

    expect(selection.selectedKind).toBeNull();
    expect(selection.attempts).toEqual([
      {
        kind: "direct",
        url: "ws://localhost:6767/ws",
        outcome: "timed-out",
        durationMs: 500,
      },
    ]);
  });

  it("respects preferDirect: false, trying relay before direct", async () => {
    const clock = new FakeClock();
    const attemptedKinds: string[] = [];
    const probe: HostProbeTransport = async (url) => {
      attemptedKinds.push(url);
    };
    const prober = new ConnectionProber({ clock, probe });

    const selection = await prober.selectConnection({ ...bothConfigured, preferDirect: false });
    expect(selection.selectedKind).toBe("relay");
    expect(selection.attempts.map((attempt) => attempt.kind)).toEqual(["relay"]);
  });

  it("never throws even when the profile has no configured connection at all", async () => {
    const clock = new FakeClock();
    const prober = new ConnectionProber({
      clock,
      probe: async () => {
        throw new Error("should never be called");
      },
    });
    const selection = await prober.selectConnection({
      ...bothConfigured,
      direct: undefined,
      relay: undefined,
    });
    expect(selection).toEqual({ selectedKind: null, selectedUrl: null, attempts: [] });
  });
});
