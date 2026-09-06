import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SessionSummary } from "./types.js";
import type { SessionListConnectionState, SessionListSyncClient } from "./use-session-list-sync.js";
import { useSessionListSync } from "./use-session-list-sync.js";

const SYNC_WAIT = { timeout: 15_000 } as const;

const EXISTING: SessionSummary = {
  id: "s-existing",
  title: "Refactor router",
  provider: "pi",
  cwd: "/repo/existing",
  status: "idle",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const UPDATED_EXISTING: SessionSummary = { ...EXISTING, status: "running" };

const NEW_FROM_ELSEWHERE: SessionSummary = {
  id: "s-new",
  title: "Started elsewhere while offline",
  provider: "pi",
  cwd: "/repo/new",
  status: "idle",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

function renderSync(options: {
  client: SessionListSyncClient;
  connectionState: SessionListConnectionState;
  sessions: readonly SessionSummary[];
  onSynced: (sessions: SessionSummary[]) => void;
  onSyncFailed?: (message: string) => void;
}) {
  return renderHook(
    (props: { connectionState: SessionListConnectionState; sessions: readonly SessionSummary[] }) =>
      useSessionListSync({
        client: options.client,
        connectionState: props.connectionState,
        getSessions: () => props.sessions,
        onSynced: options.onSynced,
        onSyncFailed: options.onSyncFailed,
      }),
    { initialProps: { connectionState: options.connectionState, sessions: options.sessions } },
  );
}

describe("useSessionListSync (T27B6)", () => {
  it("syncs on initial connect and reports the merged, deduplicated list", async () => {
    const fetchSessions = vi.fn(async () => [UPDATED_EXISTING, NEW_FROM_ELSEWHERE]);
    const onSynced = vi.fn();

    renderSync({
      client: { fetchSessions },
      connectionState: "connected",
      sessions: [EXISTING],
      onSynced,
    });

    await waitFor(() => expect(onSynced).toHaveBeenCalledTimes(1), SYNC_WAIT);
    const merged = onSynced.mock.calls[0]![0] as SessionSummary[];
    expect(merged.map((s) => s.id)).toEqual(["s-existing", "s-new"]);
    expect(merged.find((s) => s.id === "s-existing")?.status).toBe("running");
  });

  it("marks the list stale as soon as the connection leaves connected", async () => {
    const { result, rerender } = renderSync({
      client: { fetchSessions: async () => [EXISTING] },
      connectionState: "connected",
      sessions: [EXISTING],
      onSynced: vi.fn(),
    });

    await waitFor(() => expect(result.current.stale).toBe(false), SYNC_WAIT);

    rerender({ connectionState: "disconnected", sessions: [EXISTING] });
    expect(result.current.stale).toBe(true);

    rerender({ connectionState: "connecting", sessions: [EXISTING] });
    expect(result.current.stale).toBe(true);
  });

  it("a forced reconnect clears stale and refetches without duplicating existing rows", async () => {
    const fetchSessions = vi.fn(async () => [EXISTING]);
    const onSynced = vi.fn();
    const { result, rerender } = renderSync({
      client: { fetchSessions },
      connectionState: "connected",
      sessions: [EXISTING],
      onSynced,
    });
    await waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(1), SYNC_WAIT);

    rerender({ connectionState: "disconnected", sessions: [EXISTING] });
    expect(result.current.stale).toBe(true);

    rerender({ connectionState: "connected", sessions: [EXISTING] });

    await waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(2), SYNC_WAIT);
    await waitFor(() => expect(result.current.stale).toBe(false), SYNC_WAIT);

    const lastCall = onSynced.mock.calls.at(-1)![0] as SessionSummary[];
    expect(lastCall.map((s) => s.id)).toEqual(["s-existing"]);
    expect(new Set(lastCall.map((s) => s.id)).size).toBe(lastCall.length);
  });

  it("discards a slow, superseded fetch instead of applying it after a newer one", async () => {
    let resolveFirst!: (sessions: SessionSummary[]) => void;
    const firstFetch = new Promise<SessionSummary[]>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchSessions = vi
      .fn<() => Promise<SessionSummary[]>>()
      .mockImplementationOnce(() => firstFetch)
      .mockImplementationOnce(async () => [UPDATED_EXISTING]);
    const onSynced = vi.fn();

    const { rerender } = renderSync({
      client: { fetchSessions },
      connectionState: "connected",
      sessions: [EXISTING],
      onSynced,
    });
    await waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(1), SYNC_WAIT);

    // Disconnect and reconnect before the first fetch resolves: this
    // starts a second, newer attempt.
    rerender({ connectionState: "disconnected", sessions: [EXISTING] });
    rerender({ connectionState: "connected", sessions: [EXISTING] });
    await waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(2), SYNC_WAIT);
    await waitFor(() => expect(onSynced).toHaveBeenCalledTimes(1), SYNC_WAIT);

    // The abandoned first attempt resolves late; it must not overwrite
    // the newer, already-applied result.
    resolveFirst([EXISTING]);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onSynced).toHaveBeenCalledTimes(1);
    expect(onSynced.mock.calls[0]![0]).toEqual([UPDATED_EXISTING]);
  });

  it("stays trivially in sync (not stuck stale) when the client has no fetchSessions capability", async () => {
    const { result } = renderSync({
      client: {},
      connectionState: "connected",
      sessions: [EXISTING],
      onSynced: vi.fn(),
    });

    await waitFor(() => expect(result.current.stale).toBe(false), SYNC_WAIT);
  });

  it("reports a sync failure without throwing and without crashing the hook", async () => {
    const onSyncFailed = vi.fn();
    const { result } = renderSync({
      client: {
        fetchSessions: async () => {
          throw new Error("SESSIONS_NOT_CONNECTED");
        },
      },
      connectionState: "connected",
      sessions: [EXISTING],
      onSynced: vi.fn(),
      onSyncFailed,
    });

    await waitFor(
      () => expect(onSyncFailed).toHaveBeenCalledWith("SESSIONS_NOT_CONNECTED"),
      SYNC_WAIT,
    );
    expect(result.current.stale).toBe(false);
  });
});
