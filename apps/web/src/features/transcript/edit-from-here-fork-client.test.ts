import { describe, expect, it, vi } from "vitest";
import { DaemonClient } from "@picompanion/client";

import { adaptEditFromHereForkClient } from "./edit-from-here-fork-client.js";

/**
 * T105 (WEB-ARCH-1 move): `adaptEditFromHereForkClient` is the one place
 * this app adapts a real `DaemonClient` to `features/transcript`'s narrow
 * `EditFromHereForkClient`. `client: null` (the disconnected case) must
 * resolve to `undefined`, not throw; a real `DaemonClient` — whose
 * `forkAgent` is a required, non-optional method — must be unwrapped
 * correctly. A mutation that skips the `agent.id` unwrap (e.g. returns
 * `agent` itself as `agentId`) fails the second assertion below.
 */
describe("adaptEditFromHereForkClient (T105)", () => {
  it("returns undefined for a null client (the disconnected case)", () => {
    expect(adaptEditFromHereForkClient(null)).toBeUndefined();
  });

  it("adapts a client that implements forkAgent, unwrapping agent.id to agentId", async () => {
    const forkAgent = vi.fn(async (_agentId: string, _options: unknown) => ({
      agent: { id: "forked-agent-7" },
    }));
    const fakeClient = { forkAgent } as unknown as DaemonClient;

    const adapted = adaptEditFromHereForkClient(fakeClient);
    expect(adapted).toBeDefined();

    const result = await adapted!.forkAgent("source-session", { entryId: "m1", entryIndex: 0 });

    expect(forkAgent).toHaveBeenCalledTimes(1);
    expect(forkAgent).toHaveBeenCalledWith("source-session", { entryId: "m1", entryIndex: 0 });
    expect(result).toEqual({ agentId: "forked-agent-7" });
  });

  it("adapts a real DaemonClient (live path — the fork wire has landed)", async () => {
    const realClient = new DaemonClient({
      url: "ws://127.0.0.1:1/ws",
      clientId: "clid_host_screen_fork_live_0001",
      clientType: "browser",
      reconnect: { enabled: false },
    });
    try {
      expect(typeof realClient.forkAgent).toBe("function");
      const adapted = adaptEditFromHereForkClient(realClient);
      expect(adapted).toBeDefined();
      expect(typeof adapted?.forkAgent).toBe("function");
    } finally {
      await realClient.close().catch(() => {});
    }
  });

  it("rejects rather than mapping a null-agent resolution (mirrors the wire's failure shape)", async () => {
    const forkAgent = vi.fn(async (_agentId: string, _options: unknown) => ({
      agent: null,
    }));
    const fakeClient = { forkAgent } as unknown as DaemonClient;

    const adapted = adaptEditFromHereForkClient(fakeClient);
    expect(adapted).toBeDefined();
    await expect(
      adapted!.forkAgent("source-session", { entryId: "m1", entryIndex: 0 }),
    ).rejects.toThrow("did not return a new session");
  });
});
