import type { Clock, TimerHandle } from "@picompanion/frontend-core";
import type { hosts } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

import { createHostConnectAttempt } from "./attempt-host-connection.js";
import type { ConnectDraft } from "./validate-connect-form.js";

/**
 * Deterministic, real-time-free `Clock` for tests (mirrors
 * `frontend-core`'s own fake clocks). `ConnectionProber` always races its
 * probe against a timeout timer, so `setTimeout` must return a real,
 * cancellable handle even though these tests never let it fire.
 */
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

const draft: ConnectDraft = {
  label: "My daemon",
  direct: { endpoint: "localhost:6767", useTls: false },
  preferDirect: true,
};

describe("createHostConnectAttempt", () => {
  it("reports a reachable direct target as a successful attempt through core", async () => {
    const probe: hosts.HostProbeTransport = async () => {
      /* resolves: reachable */
    };
    const attempt = createHostConnectAttempt({ clock: new FakeClock(), probe });

    const outcome = await attempt(draft);

    expect(outcome.ok).toBe(true);
    expect(outcome.selectedKind).toBe("direct");
    expect(outcome.attempts).toEqual([
      {
        kind: "direct",
        url: "ws://localhost:6767/ws",
        outcome: "reachable",
        durationMs: 0,
      },
    ]);
  });

  it("reports an unreachable direct target without throwing", async () => {
    const probe: hosts.HostProbeTransport = async () => {
      throw new Error("ECONNREFUSED");
    };
    const attempt = createHostConnectAttempt({ clock: new FakeClock(), probe });

    const outcome = await attempt(draft);

    expect(outcome.ok).toBe(false);
    expect(outcome.selectedKind).toBeNull();
    expect(outcome.attempts).toEqual([
      {
        kind: "direct",
        url: "ws://localhost:6767/ws",
        outcome: "unreachable",
        durationMs: 0,
        error: "ECONNREFUSED",
      },
    ]);
  });

  it("passes the draft's TLS preference through to the probed URL", async () => {
    const seenUrls: string[] = [];
    const probe: hosts.HostProbeTransport = async (url) => {
      seenUrls.push(url);
    };
    const attempt = createHostConnectAttempt({ clock: new FakeClock(), probe });

    await attempt({ ...draft, direct: { endpoint: "example.com:8443", useTls: true } });

    expect(seenUrls).toEqual(["wss://example.com:8443/ws"]);
  });
});
