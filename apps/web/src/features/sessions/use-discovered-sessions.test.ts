import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DiscoveredSession, DiscoveredSessionsClient } from "./discovered-sessions-client.js";
import type { SessionSummary } from "./types.js";
import { useDiscoveredSessions } from "./use-discovered-sessions.js";

const DISCOVERED: DiscoveredSession = {
  providerId: "pi",
  providerLabel: "Pi",
  providerHandleId: "pi-terminal-handle-0001",
  cwd: "/repo/terminal-project",
  title: null,
  firstPromptPreview: "help me refactor this",
  lastPromptPreview: "run the tests",
  lastActivityAt: "2026-08-31T09:00:00.000Z",
};

const IMPORTED: SessionSummary = {
  id: "agt-imported-1",
  title: "Imported terminal session",
  provider: "pi",
  cwd: "/repo/terminal-project",
  status: "idle",
  updatedAt: "2026-08-31T09:05:00.000Z",
};

describe("useDiscoveredSessions (T27B5)", () => {
  it("discover() lists discovered sessions distinct from the imported list", async () => {
    const listDiscoveredSessions = vi.fn(async () => [DISCOVERED]);
    const client: DiscoveredSessionsClient = {
      listDiscoveredSessions,
      importSession: vi.fn(),
    };
    const { result } = renderHook(() => useDiscoveredSessions({ client }));

    expect(result.current.sessions).toEqual([]);

    act(() => result.current.discover());
    await waitFor(() => expect(result.current.phase).toBe("idle"));

    expect(listDiscoveredSessions).toHaveBeenCalledTimes(1);
    expect(result.current.sessions).toEqual([DISCOVERED]);
  });

  it("surfaces a friendly explanation when discover() fails", async () => {
    const client: DiscoveredSessionsClient = {
      listDiscoveredSessions: vi.fn(async () => {
        throw new Error("SESSIONS_NOT_CONNECTED");
      }),
      importSession: vi.fn(),
    };
    const { result } = renderHook(() => useDiscoveredSessions({ client }));

    act(() => result.current.discover());
    await waitFor(() => expect(result.current.phase).toBe("error"));

    expect(result.current.errorMessage).toMatch(/connect to a daemon/i);
    expect(result.current.sessions).toEqual([]);
  });

  it("importDiscovered() imports, removes the row, and reports the new session", async () => {
    const importSession = vi.fn(async () => IMPORTED);
    const client: DiscoveredSessionsClient = {
      listDiscoveredSessions: vi.fn(async () => [DISCOVERED]),
      importSession,
    };
    const onImported = vi.fn();
    const { result } = renderHook(() => useDiscoveredSessions({ client, onImported }));

    act(() => result.current.discover());
    await waitFor(() => expect(result.current.sessions).toEqual([DISCOVERED]));

    act(() => result.current.importDiscovered(DISCOVERED));
    await waitFor(() => expect(result.current.importingHandleId).toBeNull());

    expect(importSession).toHaveBeenCalledWith({
      providerId: "pi",
      providerHandleId: "pi-terminal-handle-0001",
      cwd: "/repo/terminal-project",
    });
    expect(onImported).toHaveBeenCalledWith(IMPORTED, DISCOVERED);
    expect(result.current.sessions).toEqual([]);
  });

  it("is idempotent for a synchronous double-call on the same handle: only one import request is sent", async () => {
    let resolveImport!: (session: SessionSummary) => void;
    const importSession = vi.fn(
      () =>
        new Promise<SessionSummary>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const client: DiscoveredSessionsClient = {
      listDiscoveredSessions: vi.fn(async () => [DISCOVERED]),
      importSession,
    };
    const { result } = renderHook(() => useDiscoveredSessions({ client }));

    act(() => result.current.discover());
    await waitFor(() => expect(result.current.sessions).toEqual([DISCOVERED]));

    act(() => {
      result.current.importDiscovered(DISCOVERED);
      // Fired before the first request settles (e.g. a double click).
      result.current.importDiscovered(DISCOVERED);
    });
    expect(importSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveImport(IMPORTED);
    });
    await waitFor(() => expect(result.current.importingHandleId).toBeNull());
    expect(importSession).toHaveBeenCalledTimes(1);
  });

  it("is idempotent for a call after a successful import already completed: no second request is sent", async () => {
    const importSession = vi.fn(async () => IMPORTED);
    const client: DiscoveredSessionsClient = {
      listDiscoveredSessions: vi.fn(async () => [DISCOVERED]),
      importSession,
    };
    const { result } = renderHook(() => useDiscoveredSessions({ client }));

    act(() => result.current.discover());
    await waitFor(() => expect(result.current.sessions).toEqual([DISCOVERED]));

    act(() => result.current.importDiscovered(DISCOVERED));
    await waitFor(() => expect(result.current.sessions).toEqual([]));
    expect(importSession).toHaveBeenCalledTimes(1);

    // A later call for the same (now stale, no longer listed) discovered
    // entry — e.g. a stray click that fired just before the row
    // unmounted — must not re-import it.
    act(() => result.current.importDiscovered(DISCOVERED));
    expect(importSession).toHaveBeenCalledTimes(1);
  });

  it("treats the daemon's 'already imported' rejection as success, not an error toast", async () => {
    const importSession = vi.fn(async () => {
      throw new Error("Provider session is already imported: pi-terminal-handle-0001");
    });
    const client: DiscoveredSessionsClient = {
      listDiscoveredSessions: vi.fn(async () => [DISCOVERED]),
      importSession,
    };
    const onImported = vi.fn();
    const { result } = renderHook(() => useDiscoveredSessions({ client, onImported }));

    act(() => result.current.discover());
    await waitFor(() => expect(result.current.sessions).toEqual([DISCOVERED]));

    act(() => result.current.importDiscovered(DISCOVERED));
    await waitFor(() => expect(result.current.sessions).toEqual([]));

    expect(result.current.errorMessage).toBeNull();
    expect(onImported).not.toHaveBeenCalled();

    // Running it again afterwards is a further no-op, not a second request.
    act(() => result.current.importDiscovered(DISCOVERED));
    expect(importSession).toHaveBeenCalledTimes(1);
  });

  it("surfaces a genuine import failure and allows retrying", async () => {
    const importSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("cwd is required"))
      .mockResolvedValueOnce(IMPORTED);
    const client: DiscoveredSessionsClient = {
      listDiscoveredSessions: vi.fn(async () => [DISCOVERED]),
      importSession,
    };
    const { result } = renderHook(() => useDiscoveredSessions({ client }));

    act(() => result.current.discover());
    await waitFor(() => expect(result.current.sessions).toEqual([DISCOVERED]));

    act(() => result.current.importDiscovered(DISCOVERED));
    await waitFor(() => expect(result.current.errorMessage).toMatch(/cwd is required/i));
    // The row is still there, so the user can retry.
    expect(result.current.sessions).toEqual([DISCOVERED]);

    act(() => result.current.importDiscovered(DISCOVERED));
    await waitFor(() => expect(result.current.sessions).toEqual([]));
    expect(importSession).toHaveBeenCalledTimes(2);
  });
});
