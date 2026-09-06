import { describe, expect, it, vi } from "vitest";

import { createDaemonSessionsClient } from "./daemon-sessions-client.js";
import type { DaemonAgentClient, DaemonAgentSnapshot } from "./daemon-sessions-client.js";

/**
 * Proves `createDaemonSessionsClient`'s rename adapter logic against a
 * FAKE `DaemonAgentClient`, not a live daemon and not the real
 * `@picompanion/client` `DaemonClient` class (which does not implement
 * `renameAgent` at all — see that interface's doc comment in
 * `daemon-sessions-client.ts` for the disclosed protocol/client gap,
 * the same shape as `forkAgent`/`cloneAgent`'s). Mirrors
 * `daemon-sessions-client.fork-clone.test.ts`'s structure exactly. No
 * socket is opened and no live daemon (dev or production) is contacted
 * anywhere in this file.
 */
const AGENT: DaemonAgentSnapshot = {
  id: "agt_rename_0001",
  provider: "pi",
  cwd: "/repo/demo",
  status: "idle",
  title: "Renamed title",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function baseFakeDaemon(): DaemonAgentClient {
  return {
    createAgent: vi.fn(),
    archiveAgent: vi.fn(),
    deleteAgent: vi.fn(),
    fetchAgents: vi.fn(),
  };
}

describe("createDaemonSessionsClient rename (T38A4, fake daemon — no live daemon contacted)", () => {
  it("does not expose renameSession when the injected daemon lacks renameAgent", () => {
    const client = createDaemonSessionsClient(baseFakeDaemon());
    expect(client.renameSession).toBeUndefined();
  });

  it("still does not expose renameSession on a daemon that only implements forkAgent/cloneAgent", () => {
    const client = createDaemonSessionsClient({
      ...baseFakeDaemon(),
      forkAgent: vi.fn(),
      cloneAgent: vi.fn(),
    });
    expect(client.renameSession).toBeUndefined();
  });

  it("renameSession sends the session id and name to daemon.renameAgent and maps the result", async () => {
    const renameAgent = vi.fn(async () => ({ agent: AGENT }));
    const client = createDaemonSessionsClient({ ...baseFakeDaemon(), renameAgent });

    const result = await client.renameSession?.("agt_rename_0001", { name: "Renamed title" });

    expect(renameAgent).toHaveBeenCalledWith("agt_rename_0001", { name: "Renamed title" });
    expect(result?.session.id).toBe("agt_rename_0001");
    expect(result?.session.title).toBe("Renamed title");
  });

  it("renameSession propagates a rejection from daemon.renameAgent without mapping anything", async () => {
    const renameAgent = vi.fn(async () => {
      throw new Error("session not found");
    });
    const client = createDaemonSessionsClient({ ...baseFakeDaemon(), renameAgent });

    await expect(client.renameSession?.("agt_rename_0001", { name: "New name" })).rejects.toThrow(
      "session not found",
    );
  });
});
