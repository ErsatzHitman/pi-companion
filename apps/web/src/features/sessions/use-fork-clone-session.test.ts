import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SESSIONS_ACTION_UNSUPPORTED } from "./sessions-client.js";
import type { SessionsClient } from "./sessions-client.js";
import type { SessionSummary } from "./types.js";
import { useForkCloneSession } from "./use-fork-clone-session.js";

const SOURCE: SessionSummary = {
  id: "s-1",
  title: "Refactor router",
  provider: "pi",
  cwd: "/repo/demo",
  status: "idle",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const FORKED: SessionSummary = { ...SOURCE, id: "s-1-fork", title: null };
const CLONED: SessionSummary = { ...SOURCE, id: "s-1-clone" };

describe("useForkCloneSession (T38A3)", () => {
  it("fork() calls the client with the source id and input, and reports the result only on success", async () => {
    const forkSession = vi.fn(async () => ({
      session: FORKED,
      forkPoint: { messageId: "m5", index: 5 },
    }));
    const onForked = vi.fn();
    const onForkFailed = vi.fn();
    const client: SessionsClient = { createSession: vi.fn(), forkSession };

    const { result } = renderHook(() =>
      useForkCloneSession({
        client,
        onForked,
        onForkFailed,
        onCloned: vi.fn(),
        onCloneFailed: vi.fn(),
      }),
    );

    act(() => result.current.fork(SOURCE, { entryId: "m5", entryIndex: 5 }));

    expect(forkSession).toHaveBeenCalledWith("s-1", { entryId: "m5", entryIndex: 5 });
    expect(result.current.forkingSessionId).toBe("s-1");

    await waitFor(() => expect(onForked).toHaveBeenCalledTimes(1));
    expect(onForked).toHaveBeenCalledWith(SOURCE, {
      session: FORKED,
      forkPoint: { messageId: "m5", index: 5 },
    });
    expect(result.current.forkingSessionId).toBeNull();
    expect(onForkFailed).not.toHaveBeenCalled();
  });

  it("fork() reports failure via onForkFailed and never mutates or reports the source session", async () => {
    const forkSession = vi.fn(async () => {
      throw new Error("entry not found");
    });
    const onForked = vi.fn();
    const onForkFailed = vi.fn();
    const client: SessionsClient = { createSession: vi.fn(), forkSession };
    const sourceSnapshotBefore = { ...SOURCE };

    const { result } = renderHook(() =>
      useForkCloneSession({
        client,
        onForked,
        onForkFailed,
        onCloned: vi.fn(),
        onCloneFailed: vi.fn(),
      }),
    );

    act(() => result.current.fork(SOURCE, { entryId: "m5", entryIndex: 5 }));
    await waitFor(() => expect(onForkFailed).toHaveBeenCalledTimes(1));

    expect(onForkFailed).toHaveBeenCalledWith(SOURCE, "entry not found");
    expect(onForked).not.toHaveBeenCalled();
    // The source object passed in is never mutated by a failed fork.
    expect(SOURCE).toEqual(sourceSnapshotBefore);
    expect(result.current.forkingSessionId).toBeNull();
  });

  it("fork() reports SESSIONS_ACTION_UNSUPPORTED when the client doesn't implement forkSession", async () => {
    const onForkFailed = vi.fn();
    const client: SessionsClient = { createSession: vi.fn() }; // no forkSession

    const { result } = renderHook(() =>
      useForkCloneSession({
        client,
        onForked: vi.fn(),
        onForkFailed,
        onCloned: vi.fn(),
        onCloneFailed: vi.fn(),
      }),
    );

    act(() => result.current.fork(SOURCE, { entryId: "m5", entryIndex: 5 }));
    await waitFor(() => expect(onForkFailed).toHaveBeenCalledTimes(1));
    expect(onForkFailed).toHaveBeenCalledWith(SOURCE, SESSIONS_ACTION_UNSUPPORTED);
  });

  it("ignores a second concurrent fork() while the first is still in flight", async () => {
    let resolveFork!: (result: {
      session: SessionSummary;
      forkPoint: { messageId: string; index: number };
    }) => void;
    const forkSession = vi.fn(
      () =>
        new Promise<{ session: SessionSummary; forkPoint: { messageId: string; index: number } }>(
          (resolve) => {
            resolveFork = resolve;
          },
        ),
    );
    const onForked = vi.fn();
    const client: SessionsClient = { createSession: vi.fn(), forkSession };

    const { result } = renderHook(() =>
      useForkCloneSession({
        client,
        onForked,
        onForkFailed: vi.fn(),
        onCloned: vi.fn(),
        onCloneFailed: vi.fn(),
      }),
    );

    act(() => {
      result.current.fork(SOURCE, { entryId: "m5", entryIndex: 5 });
      result.current.fork(SOURCE, { entryId: "m9", entryIndex: 9 });
    });
    expect(forkSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFork({ session: FORKED, forkPoint: { messageId: "m5", index: 5 } });
      await Promise.resolve();
    });
    await waitFor(() => expect(onForked).toHaveBeenCalledTimes(1));
  });

  it("clone() calls the client with the source id and reports the result only on success", async () => {
    const cloneSession = vi.fn(async () => ({ session: CLONED }));
    const onCloned = vi.fn();
    const onCloneFailed = vi.fn();
    const client: SessionsClient = { createSession: vi.fn(), cloneSession };

    const { result } = renderHook(() =>
      useForkCloneSession({
        client,
        onForked: vi.fn(),
        onForkFailed: vi.fn(),
        onCloned,
        onCloneFailed,
      }),
    );

    act(() => result.current.clone(SOURCE));

    expect(cloneSession).toHaveBeenCalledWith("s-1", undefined);
    expect(result.current.cloningSessionId).toBe("s-1");

    await waitFor(() => expect(onCloned).toHaveBeenCalledTimes(1));
    expect(onCloned).toHaveBeenCalledWith(SOURCE, { session: CLONED });
    expect(result.current.cloningSessionId).toBeNull();
    expect(onCloneFailed).not.toHaveBeenCalled();
  });

  it("clone() reports failure via onCloneFailed and never reports the source session as cloned", async () => {
    const cloneSession = vi.fn(async () => {
      throw new Error("host is full");
    });
    const onCloned = vi.fn();
    const onCloneFailed = vi.fn();
    const client: SessionsClient = { createSession: vi.fn(), cloneSession };

    const { result } = renderHook(() =>
      useForkCloneSession({
        client,
        onForked: vi.fn(),
        onForkFailed: vi.fn(),
        onCloned,
        onCloneFailed,
      }),
    );

    act(() => result.current.clone(SOURCE));
    await waitFor(() => expect(onCloneFailed).toHaveBeenCalledTimes(1));

    expect(onCloneFailed).toHaveBeenCalledWith(SOURCE, "host is full");
    expect(onCloned).not.toHaveBeenCalled();
    expect(result.current.cloningSessionId).toBeNull();
  });
});
