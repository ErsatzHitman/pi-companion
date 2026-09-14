import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { composer as coreComposer } from "@picompanion/frontend-core";

import { FakeAgentTurnClient, FakeClock, InMemoryStructuredStorage } from "./test-doubles.js";
import { resumePendingOutboxEntries, usePendingOutboxResume } from "./use-pending-outbox-resume.js";

/**
 * Tests for FIX-W8: the resend path that actually pushes a `pending`
 * outbox entry over the wire — see `use-pending-outbox-resume.ts`'s own
 * module doc for the gap this closes (`OutboxController.confirmResend`
 * only flips status; nothing sent the entry until this file).
 */

async function makeOutboxWithPendingPrompt(options?: {
  clientMessageId?: string;
  attachments?: unknown[];
}): Promise<{
  outbox: coreComposer.OutboxController;
  entryId: string;
}> {
  const storage = new InMemoryStructuredStorage();
  const clock = new FakeClock(1_000);
  const outbox = new coreComposer.OutboxController(storage, clock, {
    generateId: (() => {
      let n = 0;
      return () => `outbox-${(n += 1)}`;
    })(),
  });
  const entry = await outbox.enqueue({
    sessionId: "session-1",
    kind: "prompt",
    payload: {
      text: "hello",
      clientMessageId: options?.clientMessageId ?? "original-client-message-id",
      attachments: options?.attachments ?? [],
    },
  });
  return { outbox, entryId: entry.id };
}

describe("resumePendingOutboxEntries (FIX-W8)", () => {
  it("sends every pending entry exactly once, reusing the ORIGINAL clientMessageId", async () => {
    const { outbox } = await makeOutboxWithPendingPrompt({ clientMessageId: "cmid-original-1" });
    const client = new FakeAgentTurnClient();

    await resumePendingOutboxEntries(client, "session-1", outbox);

    expect(client.sentMessages).toHaveLength(1);
    expect(client.sentMessages[0]).toEqual(
      expect.objectContaining({
        agentId: "session-1",
        text: "hello",
        options: expect.objectContaining({ messageId: "cmid-original-1" }),
      }),
    );
  });

  it("marks the entry sent (removed from the outbox) once the send resolves", async () => {
    const { outbox, entryId } = await makeOutboxWithPendingPrompt();
    const client = new FakeAgentTurnClient();

    await resumePendingOutboxEntries(client, "session-1", outbox);

    expect(await outbox.load(entryId)).toBeNull();
  });

  it("a failed send marks the entry awaiting-confirmation — recoverable, not silently dropped", async () => {
    const { outbox, entryId } = await makeOutboxWithPendingPrompt();
    const client = new FakeAgentTurnClient();
    client.sendAgentMessageImpl = async () => {
      throw new Error("daemon refused");
    };

    await resumePendingOutboxEntries(client, "session-1", outbox);

    const entry = await outbox.load(entryId);
    expect(entry?.status).toBe("awaiting-confirmation");
    expect(entry?.lastError).toBe("daemon refused");
  });

  it("never resends a non-prompt entry", async () => {
    const storage = new InMemoryStructuredStorage();
    const clock = new FakeClock(1_000);
    const outbox = new coreComposer.OutboxController(storage, clock);
    await outbox.enqueue({ sessionId: "session-1", kind: "abort", payload: {} });
    const client = new FakeAgentTurnClient();

    await resumePendingOutboxEntries(client, "session-1", outbox);

    expect(client.sentMessages).toEqual([]);
  });

  it("never touches an awaiting-confirmation entry (only confirmResend can move it back to pending)", async () => {
    const storage = new InMemoryStructuredStorage();
    const clock = new FakeClock(1_000);
    const outbox = new coreComposer.OutboxController(storage, clock);
    const entry = await outbox.enqueue({
      sessionId: "session-1",
      kind: "prompt",
      payload: { text: "hi", clientMessageId: "cmid-parked" },
    });
    await outbox.markFailed(entry.id, "boom"); // -> awaiting-confirmation, idempotencyVerified defaults false
    const client = new FakeAgentTurnClient();

    await resumePendingOutboxEntries(client, "session-1", outbox);

    expect(client.sentMessages).toEqual([]);
    expect((await outbox.load(entry.id))?.status).toBe("awaiting-confirmation");
  });
});

describe("usePendingOutboxResume (FIX-W8)", () => {
  it("resumePending() sends a pending entry exactly once", async () => {
    const { outbox } = await makeOutboxWithPendingPrompt({ clientMessageId: "cmid-hook-1" });
    const client = new FakeAgentTurnClient();

    const { result } = renderHook(() =>
      usePendingOutboxResume({ client, sessionId: "session-1", outbox }),
    );

    await act(async () => {
      await result.current.resumePending();
    });

    expect(client.sentMessages).toHaveLength(1);
    expect(client.sentMessages[0].options?.messageId).toBe("cmid-hook-1");
  });

  it("two rapid resumePending() calls send once, not twice (synchronous re-entrancy guard, mirrors submitLockRef)", async () => {
    const { outbox } = await makeOutboxWithPendingPrompt();
    const client = new FakeAgentTurnClient();
    let resolveSend: (() => void) | null = null;
    client.sendAgentMessageImpl = () =>
      new Promise<void>((resolve) => {
        resolveSend = resolve;
      });

    const { result } = renderHook(() =>
      usePendingOutboxResume({ client, sessionId: "session-1", outbox }),
    );

    let firstCallSettled = false;
    let secondCallSettled = false;
    await act(async () => {
      void result.current.resumePending().then(() => {
        firstCallSettled = true;
      });
      // Synchronous second call, in the same tick as the first — the
      // exact shape "two rapid Resend clicks" produces.
      void result.current.resumePending().then(() => {
        secondCallSettled = true;
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // The second call is a no-op while the first is still in flight: only
    // one send has been attempted so far.
    expect(client.sentMessages).toHaveLength(1);
    expect(secondCallSettled).toBe(true);
    expect(firstCallSettled).toBe(false);

    await act(async () => {
      resolveSend?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(client.sentMessages).toHaveLength(1);
  });

  it("does nothing with no client (no connection yet)", async () => {
    const { outbox } = await makeOutboxWithPendingPrompt();

    const { result } = renderHook(() =>
      usePendingOutboxResume({ client: undefined, sessionId: "session-1", outbox }),
    );

    await act(async () => {
      await result.current.resumePending();
    });

    expect(await outbox.getAutoResendCandidates("session-1")).toHaveLength(1);
  });

  it("a transition to connectionStatus 'connected' triggers a resend automatically", async () => {
    const { outbox } = await makeOutboxWithPendingPrompt({ clientMessageId: "cmid-reconnect-1" });
    const client = new FakeAgentTurnClient();

    const { rerender } = renderHook(
      ({ connectionStatus }: { connectionStatus: string }) =>
        usePendingOutboxResume({ client, sessionId: "session-1", outbox, connectionStatus }),
      { initialProps: { connectionStatus: "connecting" } },
    );

    expect(client.sentMessages).toEqual([]);

    rerender({ connectionStatus: "connected" });

    await waitFor(() => expect(client.sentMessages).toHaveLength(1));
    expect(client.sentMessages[0].options?.messageId).toBe("cmid-reconnect-1");
  });

  it("a remount cannot double-send: a fresh hook instance sees the entry already resolved by the first", async () => {
    const { outbox } = await makeOutboxWithPendingPrompt();
    const client = new FakeAgentTurnClient();

    const first = renderHook(() =>
      usePendingOutboxResume({
        client,
        sessionId: "session-1",
        outbox,
        connectionStatus: "connected",
      }),
    );
    await waitFor(() => expect(client.sentMessages).toHaveLength(1));
    first.unmount();

    // Simulated remount: a brand-new hook instance, brand-new ref — the
    // "safety" here must come from the entry no longer being `pending`
    // (asserted directly below), not from any state carried across
    // instances.
    renderHook(() =>
      usePendingOutboxResume({
        client,
        sessionId: "session-1",
        outbox,
        connectionStatus: "connected",
      }),
    );
    await vi.waitFor(() =>
      expect(outbox.getAutoResendCandidates("session-1")).resolves.toEqual([]),
    );

    expect(client.sentMessages).toHaveLength(1);
  });
});
