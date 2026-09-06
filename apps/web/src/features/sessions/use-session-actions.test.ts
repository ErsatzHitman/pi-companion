import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SESSIONS_ACTION_UNSUPPORTED } from "./sessions-client.js";
import type { SessionsClient } from "./sessions-client.js";
import type { SessionSummary } from "./types.js";
import { useSessionActions } from "./use-session-actions.js";

const SESSION: SessionSummary = {
  id: "s-1",
  title: "Refactor router",
  provider: "pi",
  cwd: "/repo/demo",
  status: "idle",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const ARCHIVED_SESSION: SessionSummary = { ...SESSION, archivedAt: "2026-01-02T00:00:00.000Z" };

describe("useSessionActions (T27B4)", () => {
  it("archive() applies an optimistic archivedAt before reconciling with the daemon's real one", async () => {
    let resolveArchive!: (result: { archivedAt: string }) => void;
    const archiveSession = vi.fn(
      () =>
        new Promise<{ archivedAt: string }>((resolve) => {
          resolveArchive = resolve;
        }),
    );
    const onArchived = vi.fn();
    const onArchiveFailed = vi.fn();
    const client: SessionsClient = { createSession: vi.fn(), archiveSession };

    const { result } = renderHook(() =>
      useSessionActions({
        client,
        onArchived,
        onArchiveFailed,
        onDeleted: vi.fn(),
        onDeleteFailed: vi.fn(),
      }),
    );

    act(() => result.current.archive(SESSION));

    expect(archiveSession).toHaveBeenCalledWith("s-1");
    // Optimistic call happens synchronously, before the daemon responds.
    expect(onArchived).toHaveBeenCalledTimes(1);
    const [optimisticId, optimisticAt] = onArchived.mock.calls[0]!;
    expect(optimisticId).toBe("s-1");
    expect(typeof optimisticAt).toBe("string");
    expect(result.current.archivingSessionId).toBe("s-1");

    await act(async () => {
      resolveArchive({ archivedAt: "2026-03-01T00:00:00.000Z" });
      await Promise.resolve();
    });

    await waitFor(() => expect(onArchived).toHaveBeenCalledTimes(2));
    expect(onArchived).toHaveBeenLastCalledWith("s-1", "2026-03-01T00:00:00.000Z");
    expect(result.current.archivingSessionId).toBeNull();
    expect(onArchiveFailed).not.toHaveBeenCalled();
  });

  it("archive() rolls back via onArchiveFailed when the daemon rejects", async () => {
    const archiveSession = vi.fn(async () => {
      throw new Error("agent is closed");
    });
    const onArchived = vi.fn();
    const onArchiveFailed = vi.fn();
    const client: SessionsClient = { createSession: vi.fn(), archiveSession };

    const { result } = renderHook(() =>
      useSessionActions({
        client,
        onArchived,
        onArchiveFailed,
        onDeleted: vi.fn(),
        onDeleteFailed: vi.fn(),
      }),
    );

    act(() => result.current.archive(SESSION));

    await waitFor(() => expect(onArchiveFailed).toHaveBeenCalledTimes(1));
    expect(onArchiveFailed).toHaveBeenCalledWith(SESSION, "agent is closed");
    expect(result.current.archivingSessionId).toBeNull();
  });

  it("archive() is a no-op for a session that is already archived", () => {
    const archiveSession = vi.fn();
    const onArchived = vi.fn();
    const client: SessionsClient = { createSession: vi.fn(), archiveSession };
    const { result } = renderHook(() =>
      useSessionActions({
        client,
        onArchived,
        onArchiveFailed: vi.fn(),
        onDeleted: vi.fn(),
        onDeleteFailed: vi.fn(),
      }),
    );

    act(() => result.current.archive(ARCHIVED_SESSION));

    expect(archiveSession).not.toHaveBeenCalled();
    expect(onArchived).not.toHaveBeenCalled();
  });

  it("archive() fails through onArchiveFailed with SESSIONS_ACTION_UNSUPPORTED when the client has no archiveSession", async () => {
    const onArchiveFailed = vi.fn();
    const client: SessionsClient = { createSession: vi.fn() };
    const { result } = renderHook(() =>
      useSessionActions({
        client,
        onArchived: vi.fn(),
        onArchiveFailed,
        onDeleted: vi.fn(),
        onDeleteFailed: vi.fn(),
      }),
    );

    act(() => result.current.archive(SESSION));

    await waitFor(() =>
      expect(onArchiveFailed).toHaveBeenCalledWith(SESSION, SESSIONS_ACTION_UNSUPPORTED),
    );
  });

  it("requestDelete opens the confirmation dialog without calling the client", () => {
    const deleteSession = vi.fn();
    const client: SessionsClient = { createSession: vi.fn(), deleteSession };
    const { result } = renderHook(() =>
      useSessionActions({
        client,
        onArchived: vi.fn(),
        onArchiveFailed: vi.fn(),
        onDeleted: vi.fn(),
        onDeleteFailed: vi.fn(),
      }),
    );

    act(() => result.current.requestDelete(SESSION));

    expect(result.current.deleteDialogOpen).toBe(true);
    expect(result.current.deleteTarget).toBe(SESSION);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("cancelDelete closes the dialog without calling the client", () => {
    const deleteSession = vi.fn();
    const client: SessionsClient = { createSession: vi.fn(), deleteSession };
    const { result } = renderHook(() =>
      useSessionActions({
        client,
        onArchived: vi.fn(),
        onArchiveFailed: vi.fn(),
        onDeleted: vi.fn(),
        onDeleteFailed: vi.fn(),
      }),
    );

    act(() => result.current.requestDelete(SESSION));
    act(() => result.current.cancelDelete());

    expect(result.current.deleteDialogOpen).toBe(false);
    expect(result.current.deleteTarget).toBeNull();
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("confirmDelete removes the session optimistically, then calls the client", async () => {
    let resolveDelete!: () => void;
    const deleteSession = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const onDeleted = vi.fn();
    const onDeleteFailed = vi.fn();
    const client: SessionsClient = { createSession: vi.fn(), deleteSession };
    const { result } = renderHook(() =>
      useSessionActions({
        client,
        onArchived: vi.fn(),
        onArchiveFailed: vi.fn(),
        onDeleted,
        onDeleteFailed,
      }),
    );

    act(() => result.current.requestDelete(SESSION));
    act(() => result.current.confirmDelete());

    // The dialog closes and `onDeleted` fires immediately, before the
    // daemon round-trip resolves.
    expect(result.current.deleteDialogOpen).toBe(false);
    expect(onDeleted).toHaveBeenCalledWith(SESSION);
    expect(deleteSession).toHaveBeenCalledWith("s-1");

    await act(async () => {
      resolveDelete();
      await Promise.resolve();
    });

    expect(onDeleteFailed).not.toHaveBeenCalled();
  });

  it("confirmDelete re-inserts the session via onDeleteFailed when the daemon rejects", async () => {
    const deleteSession = vi.fn(async () => {
      throw new Error("Agent not found: s-1");
    });
    const onDeleted = vi.fn();
    const onDeleteFailed = vi.fn();
    const client: SessionsClient = { createSession: vi.fn(), deleteSession };
    const { result } = renderHook(() =>
      useSessionActions({
        client,
        onArchived: vi.fn(),
        onArchiveFailed: vi.fn(),
        onDeleted,
        onDeleteFailed,
      }),
    );

    act(() => result.current.requestDelete(SESSION));
    act(() => result.current.confirmDelete());

    await waitFor(() => expect(onDeleteFailed).toHaveBeenCalledTimes(1));
    expect(onDeleteFailed).toHaveBeenCalledWith(SESSION, "Agent not found: s-1");
  });

  it("confirmDelete is a no-op with no target", () => {
    const deleteSession = vi.fn();
    const client: SessionsClient = { createSession: vi.fn(), deleteSession };
    const { result } = renderHook(() =>
      useSessionActions({
        client,
        onArchived: vi.fn(),
        onArchiveFailed: vi.fn(),
        onDeleted: vi.fn(),
        onDeleteFailed: vi.fn(),
      }),
    );

    act(() => result.current.confirmDelete());

    expect(deleteSession).not.toHaveBeenCalled();
  });
});
