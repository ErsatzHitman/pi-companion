import { describe, expect, it } from "vitest";

import {
  createDaemonSessionService,
  toSessionSummary,
  type DaemonAgentSnapshot,
  type DaemonSessionServiceClient,
} from "./daemon-session-service.js";

function makeSnapshot(overrides: Partial<DaemonAgentSnapshot> = {}): DaemonAgentSnapshot {
  return {
    id: "agent-1",
    provider: "pi",
    cwd: "/home/pi/project",
    status: "idle",
    title: "My session",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeFakeClient(
  overrides: Partial<DaemonSessionServiceClient> = {},
): DaemonSessionServiceClient {
  return {
    createAgent: async () => makeSnapshot(),
    fetchAgent: async () => ({ agent: makeSnapshot() }),
    fetchAgentTimeline: async () =>
      ({
        requestId: "req-1",
        agentId: "agent-1",
        epoch: 1,
        reset: true,
        direction: "tail",
        projection: "full",
        entries: [],
        startCursor: null,
        endCursor: null,
        hasMore: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    archiveAgent: async () => ({ archivedAt: "2026-01-02T00:00:00.000Z" }),
    deleteAgent: async () => {},
    fetchAgents: async () => ({
      entries: [{ agent: makeSnapshot() }],
      pageInfo: { hasMore: false },
    }),
    ...overrides,
  };
}

describe("toSessionSummary", () => {
  it("maps every DaemonAgentSnapshot field onto SessionSummary, omitting absent optionals", () => {
    const summary = toSessionSummary(makeSnapshot());
    expect(summary).toEqual({
      id: "agent-1",
      title: "My session",
      provider: "pi",
      cwd: "/home/pi/project",
      status: "idle",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(summary).not.toHaveProperty("requiresAttention");
    expect(summary).not.toHaveProperty("archivedAt");
  });

  it("carries requiresAttention/archivedAt through when present", () => {
    const summary = toSessionSummary(
      makeSnapshot({ requiresAttention: true, archivedAt: "2026-01-03T00:00:00.000Z" }),
    );
    expect(summary.requiresAttention).toBe(true);
    expect(summary.archivedAt).toBe("2026-01-03T00:00:00.000Z");
  });
});

describe("createDaemonSessionService", () => {
  it("rejects every method with a clear error when getClient() returns null (not connected)", async () => {
    const service = createDaemonSessionService(() => null);
    await expect(service.createSession({ provider: "pi", cwd: "/x" })).rejects.toThrow(
      "Not connected to a daemon",
    );
    await expect(service.openSession("agent-1")).rejects.toThrow("Not connected to a daemon");
    await expect(service.archiveSession("agent-1")).rejects.toThrow("Not connected to a daemon");
    await expect(service.deleteSession("agent-1")).rejects.toThrow("Not connected to a daemon");
  });

  it("createSession calls createAgent with provider/cwd and maps the result", async () => {
    let seen: { provider: string; cwd: string } | null = null;
    const client = makeFakeClient({
      createAgent: async (options) => {
        seen = options;
        return makeSnapshot({ id: "agent-2", cwd: options.cwd, provider: options.provider });
      },
    });
    const service = createDaemonSessionService(() => client);
    const summary = await service.createSession({ provider: "pi", cwd: "/workspace" });
    expect(seen).toEqual({ provider: "pi", cwd: "/workspace" });
    expect(summary).toMatchObject({ id: "agent-2", cwd: "/workspace", provider: "pi" });
  });

  it("openSession fetches the agent, fetches its timeline, and folds it through ingestTimelineWindow", async () => {
    const client = makeFakeClient({
      fetchAgent: async (agentId) => ({ agent: makeSnapshot({ id: agentId }) }),
    });
    const service = createDaemonSessionService(() => client);
    const result = await service.openSession("agent-9");
    expect(result.session.id).toBe("agent-9");
    expect(result.timeline.rows).toEqual([]);
    expect(result.timeline.stale).toBe(false);
  });

  it('openSession rejects with "Agent not found: <id>" when fetchAgent resolves null', async () => {
    const client = makeFakeClient({ fetchAgent: async () => null });
    const service = createDaemonSessionService(() => client);
    await expect(service.openSession("missing-1")).rejects.toThrow("Agent not found: missing-1");
  });

  it("archiveSession archives then refetches for the full updated SessionSummary", async () => {
    const calls: string[] = [];
    const client = makeFakeClient({
      archiveAgent: async (agentId) => {
        calls.push(`archive:${agentId}`);
        return { archivedAt: "2026-02-01T00:00:00.000Z" };
      },
      fetchAgent: async (agentId) => {
        calls.push(`fetch:${agentId}`);
        return { agent: makeSnapshot({ id: agentId, archivedAt: "2026-02-01T00:00:00.000Z" }) };
      },
    });
    const service = createDaemonSessionService(() => client);
    const summary = await service.archiveSession("agent-7");
    expect(calls).toEqual(["archive:agent-7", "fetch:agent-7"]);
    expect(summary.archivedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it('archiveSession rejects with "Agent not found" when the post-archive refetch resolves null', async () => {
    const client = makeFakeClient({ fetchAgent: async () => null });
    const service = createDaemonSessionService(() => client);
    await expect(service.archiveSession("agent-7")).rejects.toThrow("Agent not found: agent-7");
  });

  it("deleteSession calls deleteAgent and resolves void", async () => {
    let seen: string | null = null;
    const client = makeFakeClient({
      deleteAgent: async (agentId) => {
        seen = agentId;
      },
    });
    const service = createDaemonSessionService(() => client);
    await expect(service.deleteSession("agent-3")).resolves.toBeUndefined();
    expect(seen).toBe("agent-3");
  });

  it("calls getClient() fresh on every method, reflecting a later connection change", async () => {
    let client: DaemonSessionServiceClient | null = null;
    const service = createDaemonSessionService(() => client);

    await expect(service.deleteSession("agent-1")).rejects.toThrow("Not connected to a daemon");

    client = makeFakeClient();
    await expect(service.deleteSession("agent-1")).resolves.toBeUndefined();
  });

  describe("refreshSessions", () => {
    it("maps fetchAgents' entries to SessionSummary and includes archived rows (T32B6, item 2)", async () => {
      const client = makeFakeClient({
        fetchAgents: async (options) => {
          expect(options).toEqual({ filter: { includeArchived: true } });
          return {
            entries: [
              { agent: makeSnapshot({ id: "agent-1" }) },
              { agent: makeSnapshot({ id: "agent-2", archivedAt: "2026-03-01T00:00:00.000Z" }) },
            ],
            pageInfo: { hasMore: false },
          };
        },
      });
      const service = createDaemonSessionService(() => client);
      const window = await service.refreshSessions();
      expect(window.sessions.map((s) => s.id)).toEqual(["agent-1", "agent-2"]);
      expect(window.sessions[1]?.archivedAt).toBe("2026-03-01T00:00:00.000Z");
      expect(window.complete).toBe(true);
    });

    it("reports complete: false when pageInfo.hasMore is true, never claiming a partial page is the whole list", async () => {
      const client = makeFakeClient({
        fetchAgents: async () => ({
          entries: [{ agent: makeSnapshot() }],
          pageInfo: { hasMore: true },
        }),
      });
      const service = createDaemonSessionService(() => client);
      const window = await service.refreshSessions();
      expect(window.complete).toBe(false);
    });

    it("rejects with 'Not connected to a daemon' when no client is connected, same as every other method", async () => {
      const service = createDaemonSessionService(() => null);
      await expect(service.refreshSessions()).rejects.toThrow("Not connected to a daemon");
    });
  });
});
