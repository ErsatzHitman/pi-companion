import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DaemonAgentSnapshot } from "./daemon-sessions-client.js";
import type { SessionSnapshotSource, SessionUpdateLike } from "./use-session-snapshot.js";
import { useSessionSnapshot } from "./use-session-snapshot.js";

afterEach(cleanup);

const SNAPSHOT: DaemonAgentSnapshot = {
  id: "agent-1",
  provider: "pi",
  cwd: "/repo/pi-companion",
  status: "idle",
  title: "T380 — emulator claims",
  updatedAt: "2026-01-01T12:00:00.000Z",
  model: "opus-5",
  currentModeId: "build",
  availableModes: [{ id: "build", label: "Build" }],
  thinkingOptionId: "xhigh",
  lastUsage: { contextWindowUsedTokens: 131_600 },
};

function fakeSource(overrides: Partial<SessionSnapshotSource> = {}) {
  const listeners = new Set<(message: SessionUpdateLike) => void>();
  const source: SessionSnapshotSource = {
    fetchAgent: async () => ({ agent: SNAPSHOT }),
    subscribeAgentUpdates: (handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    ...overrides,
  };
  return { source, emit: (message: SessionUpdateLike) => listeners.forEach((l) => l(message)) };
}

describe("useSessionSnapshot", () => {
  it("seeds from one fetchAgent read and carries the real model/usage/mode fields through", async () => {
    const { source } = fakeSource();
    const { result } = renderHook(() => useSessionSnapshot(source, "agent-1"));

    await waitFor(() => expect(result.current?.id).toBe("agent-1"));
    expect(result.current?.model).toBe("opus-5");
    expect(result.current?.lastUsage?.contextWindowUsedTokens).toBe(131_600);
    expect(result.current?.currentModeId).toBe("build");
    expect(result.current?.thinkingOptionId).toBe("xhigh");
  });

  it("tracks upserts for this agent and ignores other agents' updates", async () => {
    const { source, emit } = fakeSource();
    const { result } = renderHook(() => useSessionSnapshot(source, "agent-1"));
    await waitFor(() => expect(result.current).not.toBeNull());

    emit({ payload: { kind: "upsert", agent: { ...SNAPSHOT, id: "agent-2", title: "other" } } });
    expect(result.current?.title).toBe("T380 — emulator claims");

    emit({
      payload: {
        kind: "upsert",
        agent: { ...SNAPSHOT, status: "running", title: "Renamed" },
      },
    });
    await waitFor(() => expect(result.current?.title).toBe("Renamed"));
    expect(result.current?.status).toBe("running");
  });

  it("empties on a remove for this agent", async () => {
    const { source, emit } = fakeSource();
    const { result } = renderHook(() => useSessionSnapshot(source, "agent-1"));
    await waitFor(() => expect(result.current).not.toBeNull());

    emit({ payload: { kind: "remove", agentId: "agent-1" } });
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("stays null with no client or no agent id, and on a failed seed read", async () => {
    const { result: noClient } = renderHook(() => useSessionSnapshot(null, "agent-1"));
    expect(noClient.current).toBeNull();

    const { source } = fakeSource();
    const { result: noAgent } = renderHook(() => useSessionSnapshot(source, null));
    expect(noAgent.current).toBeNull();

    const failing = fakeSource({
      fetchAgent: async () => {
        throw new Error("unreachable");
      },
    });
    const { result: failed } = renderHook(() => useSessionSnapshot(failing.source, "agent-1"));
    expect(failed.current).toBeNull();
  });
});
