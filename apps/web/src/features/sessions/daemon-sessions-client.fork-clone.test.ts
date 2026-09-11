import { describe, expect, it, vi } from "vitest";

import { createDaemonSessionsClient } from "./daemon-sessions-client.js";
import type { DaemonAgentClient, DaemonAgentSnapshot } from "./daemon-sessions-client.js";

/**
 * Proves `createDaemonSessionsClient`'s fork/clone adapter logic against
 * a FAKE `DaemonAgentClient`, not a live daemon and not the real
 * `@picompanion/client` `DaemonClient` class (which does not implement
 * `forkAgent`/`cloneAgent` at all — see that interface's doc comment in
 * `daemon-sessions-client.ts` for the disclosed protocol/client gap).
 * Unlike `daemon-sessions-client.fixture.test.ts` (real `DaemonClient` +
 * a recorded `@picompanion/protocol` wire fixture, proving
 * create/archive/delete/fetch against an actual protocol shape), this
 * file never opens a socket and never touches a real daemon — it only
 * proves that `createDaemonSessionsClient` builds the right request and
 * maps the right response, given something shaped like the interface a
 * future wire message would back.
 */
const AGENT: DaemonAgentSnapshot = {
  id: "agt_fork_0001",
  provider: "pi",
  cwd: "/repo/demo",
  status: "idle",
  title: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  model: null,
  currentModeId: null,
  availableModes: [],
};

function baseFakeDaemon(): DaemonAgentClient {
  return {
    createAgent: vi.fn(),
    archiveAgent: vi.fn(),
    deleteAgent: vi.fn(),
    fetchAgents: vi.fn(),
  };
}

describe("createDaemonSessionsClient fork/clone (T38A3, fake daemon — no live daemon contacted)", () => {
  it("does not expose forkSession/cloneSession when the injected daemon lacks forkAgent/cloneAgent", () => {
    const client = createDaemonSessionsClient(baseFakeDaemon());
    expect(client.forkSession).toBeUndefined();
    expect(client.cloneSession).toBeUndefined();
  });

  it("forkSession sends the source id and input to daemon.forkAgent and maps the result", async () => {
    const forkAgent = vi.fn(async () => ({
      agent: AGENT,
      forkPoint: { messageId: "m3", index: 3 },
    }));
    const client = createDaemonSessionsClient({ ...baseFakeDaemon(), forkAgent });

    const result = await client.forkSession?.("agt_source_0001", {
      entryId: "m3",
      entryIndex: 3,
      name: "Branch A",
    });

    expect(forkAgent).toHaveBeenCalledWith("agt_source_0001", {
      entryId: "m3",
      entryIndex: 3,
      name: "Branch A",
    });
    expect(result?.session.id).toBe("agt_fork_0001");
    expect(result?.forkPoint).toEqual({ messageId: "m3", index: 3 });
  });

  it("forkSession propagates a rejection from daemon.forkAgent without mapping anything", async () => {
    const forkAgent = vi.fn(async () => {
      throw new Error("entry not found");
    });
    const client = createDaemonSessionsClient({ ...baseFakeDaemon(), forkAgent });

    await expect(
      client.forkSession?.("agt_source_0001", { entryId: "missing", entryIndex: 0 }),
    ).rejects.toThrow("entry not found");
  });

  it("cloneSession sends the source id and input to daemon.cloneAgent and maps the result", async () => {
    const cloneAgent = vi.fn(async () => ({ agent: AGENT }));
    const client = createDaemonSessionsClient({ ...baseFakeDaemon(), cloneAgent });

    const result = await client.cloneSession?.("agt_source_0001", { name: "Copy" });

    expect(cloneAgent).toHaveBeenCalledWith("agt_source_0001", { name: "Copy" });
    expect(result?.session.id).toBe("agt_fork_0001");
  });

  it("cloneSession works with no input at all (name is optional)", async () => {
    const cloneAgent = vi.fn(async () => ({ agent: AGENT }));
    const client = createDaemonSessionsClient({ ...baseFakeDaemon(), cloneAgent });

    await client.cloneSession?.("agt_source_0001");

    expect(cloneAgent).toHaveBeenCalledWith("agt_source_0001", { name: undefined });
  });

  it("cloneSession propagates a rejection from daemon.cloneAgent without mapping anything", async () => {
    const cloneAgent = vi.fn(async () => {
      throw new Error("host is full");
    });
    const client = createDaemonSessionsClient({ ...baseFakeDaemon(), cloneAgent });

    await expect(client.cloneSession?.("agt_source_0001")).rejects.toThrow("host is full");
  });
});
