import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Clock, TimerHandle } from "@picompanion/frontend-core";

import { composer as coreComposer } from "@picompanion/frontend-core";

import type { RecoveredTurnSource } from "./use-recovered-turns.js";
import { useRecoveredTurns } from "./use-recovered-turns.js";

/**
 * Tests for FIX-W10: `useRecoveredTurns` had no test of its own — grep
 * confirmed it appeared only in its own definition, the barrel export, and
 * a source-text pin in `host-session-screen.test.tsx`. Modelled on
 * `../composer/use-pending-outbox-resume.test.ts`'s fakeable
 * outbox/clock shape, kept local to this directory the way
 * `use-edit-from-here.test.ts`'s own `FakeClock` already is (that file's
 * comment: "kept local so this file stays self-contained within its own
 * directory").
 */

/** Minimal `RecoveredTurnSource` double with full control over `loadAll`'s resolution. */
class FakeOutboxSource implements RecoveredTurnSource {
  entries: coreComposer.OutboxEntry[] = [];
  readonly loadAllCalls: Array<string | undefined> = [];
  /** When set, overrides the default entries-array behaviour (e.g. to reject). */
  loadAllImpl: ((sessionId?: string) => Promise<coreComposer.OutboxEntry[]>) | null = null;

  async loadAll(sessionId?: string): Promise<coreComposer.OutboxEntry[]> {
    this.loadAllCalls.push(sessionId);
    if (this.loadAllImpl) {
      return this.loadAllImpl(sessionId);
    }
    return this.entries.filter((entry) => sessionId === undefined || entry.sessionId === sessionId);
  }
}

function makeEntry(
  overrides: Partial<coreComposer.OutboxEntry> & {
    id: string;
    sessionId: string;
    status: coreComposer.OutboxEntryStatus;
  },
): coreComposer.OutboxEntry {
  return {
    kind: "prompt",
    payload: { text: "hi", clientMessageId: overrides.id },
    createdAt: 0,
    attempts: 0,
    ...overrides,
  };
}

/**
 * Deterministic `Clock` test double that actually implements
 * `setInterval`/`clearInterval` (unlike `../composer/test-doubles.ts`'s
 * `FakeClock`, which throws on both — this hook is the one caller that
 * needs the interval half of `Clock` exercised for real). `tick()` fires
 * every still-registered interval callback once; every `setInterval`/
 * `clearInterval` call is recorded so a test can assert on the clock
 * itself rather than by reading the hook's source.
 */
class FakeClock implements Clock {
  private currentMs: number;
  private nextId = 0;
  private readonly intervals = new Map<number, { callback: () => void }>();
  readonly issuedHandles: TimerHandle[] = [];
  readonly clearIntervalCalls: TimerHandle[] = [];
  readonly setIntervalDelays: number[] = [];

  constructor(startMs = 1_000) {
    this.currentMs = startMs;
  }

  now(): number {
    return this.currentMs;
  }

  setTimeout(): TimerHandle {
    throw new Error("FakeClock.setTimeout is not implemented; this test double is interval-only.");
  }

  clearTimeout(): void {
    throw new Error(
      "FakeClock.clearTimeout is not implemented; this test double is interval-only.",
    );
  }

  setInterval(callback: () => void, intervalMs: number): TimerHandle {
    this.nextId += 1;
    const handle = { __timerHandleBrand: this.nextId } as unknown as TimerHandle;
    this.intervals.set(this.nextId, { callback });
    this.issuedHandles.push(handle);
    this.setIntervalDelays.push(intervalMs);
    return handle;
  }

  clearInterval(handle: TimerHandle): void {
    this.clearIntervalCalls.push(handle);
    const id = (handle as unknown as { __timerHandleBrand: number }).__timerHandleBrand;
    this.intervals.delete(id);
  }

  /** Fires every still-registered interval callback once, simulating one scheduled tick. */
  tick(): void {
    for (const record of this.intervals.values()) {
      record.callback();
    }
  }

  /** Intervals registered and not yet cleared. */
  get activeIntervalCount(): number {
    return this.intervals.size;
  }
}

describe("useRecoveredTurns (FIX-W10)", () => {
  it("refreshes on mount and exposes the awaiting-confirmation entries the outbox holds", async () => {
    const outbox = new FakeOutboxSource();
    outbox.entries = [
      makeEntry({ id: "a", sessionId: "session-1", status: "awaiting-confirmation" }),
    ];
    const clock = new FakeClock();

    const { result } = renderHook(() => useRecoveredTurns(outbox, "session-1", clock));

    await waitFor(() => expect(result.current.turns).toHaveLength(1));
    expect(result.current.turns[0]?.id).toBe("a");
    expect(outbox.loadAllCalls).toEqual(["session-1"]);
  });

  it("an interval tick driven by the injected fake clock picks up an entry that appeared after mount", async () => {
    const outbox = new FakeOutboxSource();
    const clock = new FakeClock();

    const { result } = renderHook(() => useRecoveredTurns(outbox, "session-1", clock));
    await waitFor(() => expect(outbox.loadAllCalls).toHaveLength(1));
    expect(result.current.turns).toEqual([]);

    // An entry parked *after* mount — nothing re-reads the outbox until the
    // clock fires the interval below.
    outbox.entries = [
      makeEntry({ id: "b", sessionId: "session-1", status: "awaiting-confirmation" }),
    ];

    await act(async () => {
      clock.tick();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.turns).toHaveLength(1));
    expect(result.current.turns[0]?.id).toBe("b");
    expect(outbox.loadAllCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("clears the interval via the injected clock on unmount", async () => {
    const outbox = new FakeOutboxSource();
    const clock = new FakeClock();

    const { unmount } = renderHook(() => useRecoveredTurns(outbox, "session-1", clock));
    await waitFor(() => expect(outbox.loadAllCalls).toHaveLength(1));

    expect(clock.issuedHandles).toHaveLength(1);
    expect(clock.clearIntervalCalls).toHaveLength(0);

    unmount();

    expect(clock.clearIntervalCalls).toEqual([clock.issuedHandles[0]]);
  });

  it("changing sessionId clears the old interval and starts a new one — none survives a session switch", async () => {
    const outbox = new FakeOutboxSource();
    const clock = new FakeClock();

    const { rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useRecoveredTurns(outbox, sessionId, clock),
      { initialProps: { sessionId: "session-1" } },
    );
    await waitFor(() => expect(outbox.loadAllCalls).toHaveLength(1));
    expect(clock.issuedHandles).toHaveLength(1);
    expect(clock.activeIntervalCount).toBe(1);
    const firstHandle = clock.issuedHandles[0];

    rerender({ sessionId: "session-2" });
    await waitFor(() => expect(outbox.loadAllCalls).toHaveLength(2));

    // Exactly the first handle was cleared — the old interval does not
    // survive the switch — and exactly one interval is active afterward
    // (the new one), never zero and never two.
    expect(clock.clearIntervalCalls).toEqual([firstHandle]);
    expect(clock.issuedHandles).toHaveLength(2);
    expect(clock.activeIntervalCount).toBe(1);
    expect(outbox.loadAllCalls).toEqual(["session-1", "session-2"]);
  });

  it("a rejected loadAll leaves the previously-shown state in place rather than blanking or throwing", async () => {
    const outbox = new FakeOutboxSource();
    outbox.entries = [
      makeEntry({ id: "c", sessionId: "session-1", status: "awaiting-confirmation" }),
    ];
    const clock = new FakeClock();

    const { result } = renderHook(() => useRecoveredTurns(outbox, "session-1", clock));
    await waitFor(() => expect(result.current.turns).toHaveLength(1));

    outbox.loadAllImpl = async () => {
      throw new Error("network gone");
    };

    await act(async () => {
      expect(() => clock.tick()).not.toThrow();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(outbox.loadAllCalls.length).toBeGreaterThanOrEqual(2);
    expect(result.current.turns).toHaveLength(1);
    expect(result.current.turns[0]?.id).toBe("c");
  });

  it("an entry that is NOT awaiting-confirmation never appears", async () => {
    const outbox = new FakeOutboxSource();
    outbox.entries = [
      makeEntry({ id: "pending-1", sessionId: "session-1", status: "pending" }),
      makeEntry({ id: "sending-1", sessionId: "session-1", status: "sending" }),
      makeEntry({ id: "sent-1", sessionId: "session-1", status: "sent" }),
      makeEntry({ id: "parked-1", sessionId: "session-1", status: "awaiting-confirmation" }),
    ];
    const clock = new FakeClock();

    const { result } = renderHook(() => useRecoveredTurns(outbox, "session-1", clock));

    await waitFor(() => expect(result.current.turns).toHaveLength(1));
    expect(result.current.turns.map((turn) => turn.id)).toEqual(["parked-1"]);
  });
});
