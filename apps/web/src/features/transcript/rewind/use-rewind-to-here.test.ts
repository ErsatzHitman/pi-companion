import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { rewind, timeline } from "@picompanion/frontend-core";
import {
  REWIND_CONFLICT_ERROR_MARKER,
  REWIND_UNSUPPORTED_ERROR_MARKER,
} from "@picompanion/protocol/rewind-errors";

import { useRewindToHere } from "./use-rewind-to-here.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const SETTLE_WAIT = { timeout: 5_000 } as const;

function row(overrides: {
  id: string;
  text: string;
  messageId?: string;
  clientMessageId?: string;
  pending?: boolean;
}): timeline.TranscriptEntry {
  return {
    kind: "user-message",
    id: overrides.id,
    key: overrides.id,
    text: overrides.text,
    ...(overrides.messageId !== undefined ? { messageId: overrides.messageId } : {}),
    ...(overrides.clientMessageId !== undefined
      ? { clientMessageId: overrides.clientMessageId }
      : {}),
    epoch: "epoch-1",
    seqStart: 1,
    seqEnd: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: overrides.pending ?? false,
    stale: false,
  } as timeline.TranscriptEntry;
}

const ENTRIES: timeline.TranscriptEntry[] = [
  row({ id: "row-u1", messageId: "msg-1", text: "add a login form" }),
  row({ id: "row-u2", messageId: "msg-2", text: "actually, use TypeScript instead" }),
];

type RewindAgentMock = ReturnType<typeof vi.fn<rewind.RewindClientPort["rewindAgent"]>>;

function clientWith(impl: rewind.RewindClientPort["rewindAgent"]): {
  client: rewind.RewindClientPort;
  rewindAgent: RewindAgentMock;
} {
  const rewindAgent = vi.fn<rewind.RewindClientPort["rewindAgent"]>(impl);
  return { client: { rewindAgent }, rewindAgent };
}

describe("useRewindToHere (T395)", () => {
  it("sends the selected scope through the controller and records the undone turn", async () => {
    const { client, rewindAgent } = clientWith(async () => ({}));
    const onRewound = vi.fn();
    const { result } = renderHook(() =>
      useRewindToHere({
        sessionId: "session-1",
        entries: ENTRIES,
        client,
        onRewound,
      }),
    );

    expect(result.current.dialog.open).toBe(false);

    act(() => {
      result.current.requestRewind("row-u2");
    });

    expect(result.current.dialog.open).toBe(true);
    expect(result.current.dialog.target?.messageId).toBe("msg-2");
    expect(result.current.dialog.target?.snippet).toBe("actually, use TypeScript instead");

    act(() => {
      result.current.selectMode("files");
    });
    act(() => {
      result.current.submit();
    });

    await waitFor(
      () => expect(rewindAgent).toHaveBeenCalledWith("session-1", "msg-2", "files", undefined),
      SETTLE_WAIT,
    );
    await waitFor(() => expect(result.current.dialog.status).toBe("success"), SETTLE_WAIT);

    expect(onRewound).toHaveBeenCalledTimes(1);
    expect(result.current.dialog.undoneTurns).toHaveLength(1);
    expect(result.current.dialog.undoneTurns[0]).toMatchObject({
      messageId: "msg-2",
      snippet: "actually, use TypeScript instead",
      mode: "files",
    });
  });

  it("parks a conflict and only re-issues with force: true when restoreAnyway is called", async () => {
    let calls = 0;
    const { client, rewindAgent } = clientWith(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error(`${REWIND_CONFLICT_ERROR_MARKER} work tree changed since the snapshot`);
      }
      return {};
    });
    const { result } = renderHook(() =>
      useRewindToHere({ sessionId: "session-1", entries: ENTRIES, client }),
    );

    act(() => {
      result.current.requestRewind("row-u2");
    });
    act(() => {
      result.current.submit();
    });

    await waitFor(() => expect(result.current.dialog.status).toBe("conflict"), SETTLE_WAIT);
    expect(result.current.dialog.message).toBe("work tree changed since the snapshot");
    // The first request carried no `force`; nothing re-issued on its own.
    expect(rewindAgent).toHaveBeenCalledTimes(1);
    expect(rewindAgent).toHaveBeenNthCalledWith(1, "session-1", "msg-2", "conversation", undefined);

    act(() => {
      result.current.restoreAnyway();
    });

    await waitFor(() => expect(result.current.dialog.status).toBe("success"), SETTLE_WAIT);
    expect(rewindAgent).toHaveBeenCalledTimes(2);
    expect(rewindAgent).toHaveBeenNthCalledWith(2, "session-1", "msg-2", "conversation", {
      force: true,
    });
  });

  it("renders an unsupported scope with the daemon's stripped sentence and no force retry", async () => {
    const { client, rewindAgent } = clientWith(async () => {
      throw new Error(`${REWIND_UNSUPPORTED_ERROR_MARKER} the provider cannot rewind files`);
    });
    const { result } = renderHook(() =>
      useRewindToHere({ sessionId: "session-1", entries: ENTRIES, client }),
    );

    act(() => {
      result.current.requestRewind("row-u2");
    });
    act(() => {
      result.current.selectMode("both");
    });
    act(() => {
      result.current.submit();
    });

    await waitFor(() => expect(result.current.dialog.status).toBe("unsupported"), SETTLE_WAIT);
    expect(result.current.dialog.message).toBe("the provider cannot rewind files");
    expect(rewindAgent).toHaveBeenCalledTimes(1);
  });

  it("surfaces a generic daemon failure as failed, with its own message", async () => {
    const { client } = clientWith(async () => {
      throw new Error("the daemon is busy");
    });
    const { result } = renderHook(() =>
      useRewindToHere({ sessionId: "session-1", entries: ENTRIES, client }),
    );

    act(() => {
      result.current.requestRewind("row-u2");
    });
    act(() => {
      result.current.submit();
    });

    await waitFor(() => expect(result.current.dialog.status).toBe("failed"), SETTLE_WAIT);
    expect(result.current.dialog.message).toBe("the daemon is busy");
  });

  it("does not submit while a turn is running, and says so through canSubmit", () => {
    const { client, rewindAgent } = clientWith(async () => ({}));
    const { result } = renderHook(() =>
      useRewindToHere({ sessionId: "session-1", entries: ENTRIES, client, turnRunning: true }),
    );

    act(() => {
      result.current.requestRewind("row-u2");
    });

    expect(result.current.dialog.turnRunning).toBe(true);
    expect(result.current.dialog.canSubmit).toBe(false);

    act(() => {
      result.current.submit();
    });

    expect(rewindAgent).not.toHaveBeenCalled();
  });

  it("dedupes the local record and re-issues a conversation rewind for a recorded turn", async () => {
    const { client, rewindAgent } = clientWith(async () => ({}));
    const { result } = renderHook(() =>
      useRewindToHere({ sessionId: "session-1", entries: ENTRIES, client }),
    );

    act(() => {
      result.current.requestRewind("row-u2");
    });
    act(() => {
      result.current.selectMode("conversation");
    });
    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(result.current.dialog.status).toBe("success"), SETTLE_WAIT);

    const [turn] = result.current.dialog.undoneTurns;
    if (!turn) throw new Error("expected a recorded undone turn");

    act(() => {
      result.current.returnToTurn(turn);
    });

    await waitFor(() => expect(rewindAgent).toHaveBeenCalledTimes(2), SETTLE_WAIT);
    expect(rewindAgent).toHaveBeenNthCalledWith(2, "session-1", "msg-2", "conversation", undefined);
    // Returning to an already-recorded turn replaces its row, never duplicates it.
    expect(result.current.dialog.undoneTurns).toHaveLength(1);
  });

  it("resets the dialog and the local record when the session changes", async () => {
    const { client } = clientWith(async () => ({}));
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        useRewindToHere({ sessionId, entries: ENTRIES, client }),
      { initialProps: { sessionId: "session-1" } },
    );

    act(() => {
      result.current.requestRewind("row-u2");
    });
    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(result.current.dialog.undoneTurns).toHaveLength(1), SETTLE_WAIT);

    rerender({ sessionId: "session-2" });

    await waitFor(() => expect(result.current.dialog.open).toBe(false), SETTLE_WAIT);
    expect(result.current.dialog.undoneTurns).toHaveLength(0);
  });

  it("reports connected/enabled from the presence of a client", () => {
    const { result } = renderHook(() =>
      useRewindToHere({ sessionId: "session-1", entries: ENTRIES, client: null }),
    );

    expect(result.current.enabled).toBe(false);
    expect(result.current.dialog.connected).toBe(false);
    expect(result.current.dialog.canSubmit).toBe(false);
  });
});
