import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Clock, TimerHandle, timeline } from "@picompanion/frontend-core";

import type { EditFromHereForkClient, EditFromHereOutcome } from "./use-edit-from-here.js";
import { useEditFromHere } from "./use-edit-from-here.js";

/** Deterministic, manually advanced `Clock` test double (mirrors `features/composer/test-doubles.ts`'s `FakeClock`, kept local so this file stays self-contained within its own directory). */
class FakeClock implements Clock {
  constructor(private currentMs = 1_000) {}
  now(): number {
    return this.currentMs;
  }
  setTimeout(): TimerHandle {
    throw new Error("not implemented");
  }
  clearTimeout(): void {}
  setInterval(): TimerHandle {
    throw new Error("not implemented");
  }
  clearInterval(): void {}
}

function row(
  overrides: Record<string, unknown> & { kind: string; id: string },
): timeline.TranscriptEntry {
  return {
    epoch: "epoch-1",
    seqStart: 1,
    seqEnd: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "pi",
    pending: false,
    stale: false,
    ...overrides,
  } as timeline.TranscriptEntry;
}

const ENTRIES: timeline.TranscriptEntry[] = [
  row({ kind: "user-message", id: "u1", text: "please add a login form" }),
  row({ kind: "assistant-message", id: "a1", text: "here's a login form", corrected: false }),
  row({ kind: "user-message", id: "u2", text: "actually, use TypeScript instead" }),
];

describe("useEditFromHere (T105)", () => {
  it("resolves the fork point from the target's predecessor and calls the client with it", async () => {
    const forkAgent = vi.fn<EditFromHereForkClient["forkAgent"]>(async () => ({
      agentId: "edit-branch-1",
    }));
    const client: EditFromHereForkClient = { forkAgent };
    const onForked = vi.fn();

    const { result } = renderHook(() =>
      useEditFromHere({
        sessionId: "source-session",
        entries: ENTRIES,
        clock: new FakeClock(5_000),
        client,
        onForked,
      }),
    );

    await act(async () => {
      result.current.editFromHere("u2");
    });

    expect(forkAgent).toHaveBeenCalledWith("source-session", { entryId: "a1", entryIndex: 1 });
  });

  it("hands the caller a REAL frontend-core fork node, not a hand-built stand-in — the value arriving", async () => {
    const client: EditFromHereForkClient = {
      forkAgent: vi.fn(async () => ({ agentId: "edit-branch-1" })),
    };
    let outcome: EditFromHereOutcome | undefined;

    const { result } = renderHook(() =>
      useEditFromHere({
        sessionId: "source-session",
        entries: ENTRIES,
        clock: new FakeClock(5_000),
        client,
        onForked: (o) => {
          outcome = o;
        },
      }),
    );

    await act(async () => {
      result.current.editFromHere("u2");
    });

    expect(outcome).toBeDefined();
    expect(outcome?.sourceSessionId).toBe("source-session");
    expect(outcome?.newSessionId).toBe("edit-branch-1");
    expect(outcome?.draftText).toBe("actually, use TypeScript instead");
    expect(outcome?.forkPoint).toEqual({ messageId: "a1", index: 1 });
    // A real `SessionTreeNode` produced by `forkSession` through
    // frontend-core's own `editFromHere` — `kind: "fork"`, the correct
    // daemon-assigned `agentId`, and a frozen node (only `forkSession`
    // ever produces one).
    expect(outcome?.node.kind).toBe("fork");
    expect(outcome?.node.agentId).toBe("edit-branch-1");
    expect(outcome?.node.forkPoint).toEqual({ messageId: "a1", index: 1 });
    expect(Object.isFrozen(outcome?.node)).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.isForking).toBe(false);
  });

  it("reports a readable error and never calls the client when the target has no predecessor", async () => {
    const forkAgent = vi.fn();
    const client: EditFromHereForkClient = { forkAgent };
    const onForked = vi.fn();

    const { result } = renderHook(() =>
      useEditFromHere({
        sessionId: "source-session",
        entries: ENTRIES,
        clock: new FakeClock(),
        client,
        onForked,
      }),
    );

    act(() => {
      result.current.editFromHere("u1"); // first message: no predecessor
    });

    expect(forkAgent).not.toHaveBeenCalled();
    expect(onForked).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/no predecessor/);
  });

  it("reports 'not connected' and never throws when no client is wired yet", () => {
    const onForked = vi.fn();
    const { result } = renderHook(() =>
      useEditFromHere({
        sessionId: "source-session",
        entries: ENTRIES,
        clock: new FakeClock(),
        client: undefined,
        onForked,
      }),
    );

    act(() => {
      result.current.editFromHere("u2");
    });

    expect(onForked).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/not connected/i);
  });

  it("surfaces a rejected fork as a readable error instead of throwing", async () => {
    const client: EditFromHereForkClient = {
      forkAgent: vi.fn(async () => {
        throw new Error("daemon unreachable");
      }),
    };
    const onForked = vi.fn();

    const { result } = renderHook(() =>
      useEditFromHere({
        sessionId: "source-session",
        entries: ENTRIES,
        clock: new FakeClock(),
        client,
        onForked,
      }),
    );

    await act(async () => {
      result.current.editFromHere("u2");
    });

    expect(onForked).not.toHaveBeenCalled();
    expect(result.current.error).toBe("daemon unreachable");
    expect(result.current.isForking).toBe(false);
  });
});
