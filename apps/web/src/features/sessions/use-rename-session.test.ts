import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SESSIONS_ACTION_UNSUPPORTED } from "./sessions-client.js";
import type { RenameSessionInput, RenameSessionResult, SessionsClient } from "./sessions-client.js";
import { FakeClock } from "./test-doubles.js";
import type { SessionSummary } from "./types.js";
import { MAX_EXPLICIT_AGENT_TITLE_CHARS } from "./validate-session-name.js";
import { useRenameSession } from "./use-rename-session.js";

const SESSION: SessionSummary = {
  id: "s-1",
  title: "Refactor router",
  provider: "pi",
  cwd: "/repo/demo",
  status: "idle",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function clientWith(
  renameSession?: (sessionId: string, input: RenameSessionInput) => Promise<RenameSessionResult>,
): SessionsClient {
  return renameSession ? { createSession: vi.fn(), renameSession } : { createSession: vi.fn() };
}

describe("useRenameSession (T38A4)", () => {
  it("requestRename opens the dialog prefilled with the session's current title", () => {
    const clock = new FakeClock();
    const { result } = renderHook(() =>
      useRenameSession({
        client: clientWith(),
        clock,
        onRenamed: vi.fn(),
        onRenameFailed: vi.fn(),
      }),
    );

    act(() => result.current.requestRename(SESSION));

    expect(result.current.renameDialogOpen).toBe(true);
    expect(result.current.renameTarget).toEqual(SESSION);
    expect(result.current.renameDraft).toBe("Refactor router");
  });

  it("requestRename prefills an empty draft for a session with no title yet", () => {
    const untitled: SessionSummary = { ...SESSION, title: null };
    const clock = new FakeClock();
    const { result } = renderHook(() =>
      useRenameSession({
        client: clientWith(),
        clock,
        onRenamed: vi.fn(),
        onRenameFailed: vi.fn(),
      }),
    );

    act(() => result.current.requestRename(untitled));

    expect(result.current.renameDraft).toBe("");
  });

  it("confirmRename rejects an empty draft without calling the client or closing the dialog", () => {
    const renameSession = vi.fn();
    const clock = new FakeClock();
    const { result } = renderHook(() =>
      useRenameSession({
        client: clientWith(renameSession),
        clock,
        onRenamed: vi.fn(),
        onRenameFailed: vi.fn(),
      }),
    );

    act(() => {
      result.current.requestRename(SESSION);
      result.current.setRenameDraft("   ");
    });
    act(() => result.current.confirmRename());

    expect(renameSession).not.toHaveBeenCalled();
    expect(result.current.renameDialogOpen).toBe(true);
    expect(result.current.renameValidationError).toBe("Enter a name for this session.");
  });

  it("confirmRename rejects a draft over the bound (boundary: one over the cap) without calling the client", () => {
    const renameSession = vi.fn();
    const clock = new FakeClock();
    const { result } = renderHook(() =>
      useRenameSession({
        client: clientWith(renameSession),
        clock,
        onRenamed: vi.fn(),
        onRenameFailed: vi.fn(),
      }),
    );

    act(() => {
      result.current.requestRename(SESSION);
      result.current.setRenameDraft("x".repeat(MAX_EXPLICIT_AGENT_TITLE_CHARS + 1));
    });
    act(() => result.current.confirmRename());

    expect(renameSession).not.toHaveBeenCalled();
    expect(result.current.renameValidationError).toMatch(/at most 200 characters/);
  });

  it("confirmRename applies the new title optimistically, closes the dialog, and round-trips through the client", async () => {
    const renameSession = vi.fn(async () => ({ session: { ...SESSION, title: "New name" } }));
    const onRenamed = vi.fn();
    const clock = new FakeClock();
    const { result } = renderHook(() =>
      useRenameSession({
        client: clientWith(renameSession),
        clock,
        onRenamed,
        onRenameFailed: vi.fn(),
      }),
    );

    act(() => result.current.requestRename(SESSION));
    act(() => result.current.setRenameDraft("New name"));
    act(() => result.current.confirmRename());

    // Optimistic: applied and the dialog closed before the round trip settles.
    expect(onRenamed).toHaveBeenCalledWith("s-1", "New name");
    expect(result.current.renameDialogOpen).toBe(false);
    expect(renameSession).toHaveBeenCalledWith("s-1", { name: "New name" });

    await waitFor(() => expect(result.current.renamePhase).toBe("idle"));
    // The daemon confirmed exactly the name that was sent: no second
    // `onRenamed` call is needed (would be redundant, not wrong).
    expect(onRenamed).toHaveBeenCalledTimes(1);
  });

  it("trims the draft before sending it to the client", async () => {
    const renameSession = vi.fn(async () => ({ session: { ...SESSION, title: "Trimmed" } }));
    const clock = new FakeClock();
    const { result } = renderHook(() =>
      useRenameSession({
        client: clientWith(renameSession),
        clock,
        onRenamed: vi.fn(),
        onRenameFailed: vi.fn(),
      }),
    );

    act(() => result.current.requestRename(SESSION));
    act(() => result.current.setRenameDraft("  Trimmed  "));
    act(() => result.current.confirmRename());

    expect(renameSession).toHaveBeenCalledWith("s-1", { name: "Trimmed" });
    await waitFor(() => expect(result.current.renamePhase).toBe("idle"));
  });

  it("reconciles with a daemon-normalized title once the round trip resolves", async () => {
    const renameSession = vi.fn(async () => ({
      session: { ...SESSION, title: "Normalized Name" },
    }));
    const onRenamed = vi.fn();
    const clock = new FakeClock();
    const { result } = renderHook(() =>
      useRenameSession({
        client: clientWith(renameSession),
        clock,
        onRenamed,
        onRenameFailed: vi.fn(),
      }),
    );

    act(() => result.current.requestRename(SESSION));
    act(() => result.current.setRenameDraft("normalized name"));
    act(() => result.current.confirmRename());

    expect(onRenamed).toHaveBeenNthCalledWith(1, "s-1", "normalized name");
    await waitFor(() => expect(onRenamed).toHaveBeenCalledTimes(2));
    expect(onRenamed).toHaveBeenNthCalledWith(2, "s-1", "Normalized Name");
  });

  it("rolls back and reports failure via onRenameFailed when the client rejects", async () => {
    const renameSession = vi.fn(async () => {
      throw new Error("session is archived");
    });
    const onRenameFailed = vi.fn();
    const clock = new FakeClock();
    const { result } = renderHook(() =>
      useRenameSession({
        client: clientWith(renameSession),
        clock,
        onRenamed: vi.fn(),
        onRenameFailed,
      }),
    );

    act(() => result.current.requestRename(SESSION));
    act(() => result.current.setRenameDraft("New name"));
    act(() => result.current.confirmRename());

    await waitFor(() => expect(onRenameFailed).toHaveBeenCalledTimes(1));
    expect(onRenameFailed).toHaveBeenCalledWith(SESSION, "session is archived");
    expect(result.current.renameErrorMessage).toBe("session is archived");
  });

  it("reports SESSIONS_ACTION_UNSUPPORTED when the client doesn't implement renameSession", async () => {
    const onRenameFailed = vi.fn();
    const clock = new FakeClock();
    const { result } = renderHook(() =>
      useRenameSession({
        client: clientWith(),
        clock,
        onRenamed: vi.fn(),
        onRenameFailed,
      }),
    );

    act(() => result.current.requestRename(SESSION));
    act(() => result.current.setRenameDraft("New name"));
    act(() => result.current.confirmRename());

    await waitFor(() => expect(onRenameFailed).toHaveBeenCalledTimes(1));
    expect(onRenameFailed).toHaveBeenCalledWith(SESSION, SESSIONS_ACTION_UNSUPPORTED);
  });

  it("reconcileTitle is a no-op when this client has no outstanding rename attempt for that session", () => {
    const onRenameSuperseded = vi.fn();
    const clock = new FakeClock();
    const { result } = renderHook(() =>
      useRenameSession({
        client: clientWith(),
        clock,
        onRenamed: vi.fn(),
        onRenameFailed: vi.fn(),
        onRenameSuperseded,
      }),
    );

    act(() => result.current.reconcileTitle("s-1", "Some other title"));

    expect(onRenameSuperseded).not.toHaveBeenCalled();
  });

  describe("concurrent renames reconcile predictably (last-write-wins)", () => {
    /**
     * A fake daemon modelling the real `set_session_name` RPC command's
     * actual semantics (T38A0): no version or precondition, so it
     * unconditionally overwrites a single shared `currentTitle` and
     * every call's own response reflects exactly what it itself wrote
     * — never anything about a later write. Shared by two independent
     * `useRenameSession` instances below to model two real clients (two
     * browser tabs, or web+Android) racing to rename the same session.
     */
    function makeRacingDaemon(initialTitle: string) {
      let currentTitle = initialTitle;
      const renameSession = vi.fn(
        async (_sessionId: string, input: RenameSessionInput): Promise<RenameSessionResult> => {
          currentTitle = input.name;
          return { session: { ...SESSION, title: currentTitle } };
        },
      );
      return {
        client: { createSession: vi.fn(), renameSession } as SessionsClient,
        getCurrentTitle: () => currentTitle,
      };
    }

    it("the client whose write reaches the daemon last wins; the other observes it lost, carrying both names", async () => {
      const daemon = makeRacingDaemon("Refactor router");

      // Each client owns its own `Clock` instance, kept stable across
      // renders (a fresh `FakeClock()` created inline in the render
      // callback would defeat `useRenameSession`'s `useMemo(() => new
      // RequestArbitrator(...), [clock])` — a new object every render
      // would silently reset the arbitrator, which is exactly why a
      // real caller (`SessionsScreen`) memoizes its resolved clock too).
      const clockA = new FakeClock();
      const clockB = new FakeClock();

      const onRenamedA = vi.fn();
      const onRenameSupersededA = vi.fn();
      const clientA = renderHook(() =>
        useRenameSession({
          client: daemon.client,
          clock: clockA,
          onRenamed: onRenamedA,
          onRenameFailed: vi.fn(),
          onRenameSuperseded: onRenameSupersededA,
        }),
      );

      const onRenamedB = vi.fn();
      const onRenameSupersededB = vi.fn();
      const clientB = renderHook(() =>
        useRenameSession({
          client: daemon.client,
          clock: clockB,
          onRenamed: onRenamedB,
          onRenameFailed: vi.fn(),
          onRenameSuperseded: onRenameSupersededB,
        }),
      );

      // Client A submits "Alpha" first...
      act(() => clientA.result.current.requestRename(SESSION));
      act(() => clientA.result.current.setRenameDraft("Alpha"));
      act(() => clientA.result.current.confirmRename());
      await waitFor(() => expect(clientA.result.current.renamePhase).toBe("idle"));

      // ...then Client B submits "Beta" a moment later, and its write
      // reaches the daemon last — this is the real, final, persisted
      // name (last-write-wins).
      act(() => clientB.result.current.requestRename(SESSION));
      act(() => clientB.result.current.setRenameDraft("Beta"));
      act(() => clientB.result.current.confirmRename());
      await waitFor(() => expect(clientB.result.current.renamePhase).toBe("idle"));

      expect(daemon.getCurrentTitle()).toBe("Beta");

      // Both clients' own round trips already resolved successfully
      // with exactly the name each of them sent — neither call, by
      // itself, revealed the race:
      expect(onRenamedA).toHaveBeenCalledWith("s-1", "Alpha");
      expect(onRenamedB).toHaveBeenCalledWith("s-1", "Beta");
      expect(onRenameSupersededA).not.toHaveBeenCalled();
      expect(onRenameSupersededB).not.toHaveBeenCalled();

      // The next authoritative reconcile (a real `fetchSessions()` on
      // both clients would return this) delivers the true current
      // title to both.
      act(() => clientA.result.current.reconcileTitle("s-1", daemon.getCurrentTitle()));
      act(() => clientB.result.current.reconcileTitle("s-1", daemon.getCurrentTitle()));

      // The loser (A) observes it lost — never silently, never as an
      // error — carrying both what it attempted and what actually took
      // effect.
      expect(onRenameSupersededA).toHaveBeenCalledTimes(1);
      expect(onRenameSupersededA).toHaveBeenCalledWith("s-1", "Alpha", "Beta");
      // The winner (B) observes nothing extra: its own submitted name
      // matches the authoritative one.
      expect(onRenameSupersededB).not.toHaveBeenCalled();
    });

    it("a client that reconciles the very same title it submitted is never told it was superseded", async () => {
      const daemon = makeRacingDaemon("Refactor router");
      const onRenameSuperseded = vi.fn();
      const clock = new FakeClock();
      const { result } = renderHook(() =>
        useRenameSession({
          client: daemon.client,
          clock,
          onRenamed: vi.fn(),
          onRenameFailed: vi.fn(),
          onRenameSuperseded,
        }),
      );

      act(() => result.current.requestRename(SESSION));
      act(() => result.current.setRenameDraft("Solo rename"));
      act(() => result.current.confirmRename());
      await waitFor(() => expect(result.current.renamePhase).toBe("idle"));

      act(() => result.current.reconcileTitle("s-1", daemon.getCurrentTitle()));

      expect(onRenameSuperseded).not.toHaveBeenCalled();
    });

    it("reconciling a second time after the first reconcile already settled is a no-op (never double-fires)", async () => {
      const daemon = makeRacingDaemon("Refactor router");
      const onRenameSuperseded = vi.fn();
      const clock = new FakeClock();
      const { result } = renderHook(() =>
        useRenameSession({
          client: daemon.client,
          clock,
          onRenamed: vi.fn(),
          onRenameFailed: vi.fn(),
          onRenameSuperseded,
        }),
      );

      act(() => result.current.requestRename(SESSION));
      act(() => result.current.setRenameDraft("Mine"));
      act(() => result.current.confirmRename());
      await waitFor(() => expect(result.current.renamePhase).toBe("idle"));

      act(() => result.current.reconcileTitle("s-1", "Someone else's title"));
      expect(onRenameSuperseded).toHaveBeenCalledTimes(1);

      // A later, unrelated sync reporting the same (or any) title must
      // not re-fire the callback: this attempt is already resolved.
      act(() => result.current.reconcileTitle("s-1", "Yet another title"));
      expect(onRenameSuperseded).toHaveBeenCalledTimes(1);
    });
  });
});
