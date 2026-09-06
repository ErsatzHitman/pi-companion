import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  FakeAgentTurnClient,
  FakeClock,
  FakeFilePicker,
  InMemoryStructuredStorage,
  makeFakePickedFile,
} from "./test-doubles.js";
import { useComposer } from "./use-composer.js";

/** Guards a `waitFor` that depends on `useAttachments`' own upload promise chains settling. */
const UPLOAD_SETTLE_WAIT = { timeout: 5_000 } as const;

describe("useComposer", () => {
  it("starts with an empty, unsendable draft and no visible rows", () => {
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-1",
        clock: new FakeClock(1_000),
        structuredStorage: new InMemoryStructuredStorage(),
        filePicker: new FakeFilePicker(),
      }),
    );

    expect(result.current.draftText).toBe("");
    expect(result.current.canSend).toBe(false);
    expect(result.current.visibleRows).toEqual([]);
  });

  it("becomes sendable only once the draft has non-whitespace content", () => {
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-1",
        clock: new FakeClock(1_000),
        structuredStorage: new InMemoryStructuredStorage(),
        filePicker: new FakeFilePicker(),
      }),
    );

    act(() => result.current.setDraftText("   "));
    expect(result.current.canSend).toBe(false);

    act(() => result.current.setDraftText("   hello"));
    expect(result.current.canSend).toBe(true);
  });

  it("adds an optimistic pending row for the submitted text and clears the draft", async () => {
    let idCounter = 0;
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-1",
        clock: new FakeClock(5_000),
        structuredStorage: new InMemoryStructuredStorage(),
        filePicker: new FakeFilePicker(),
        generateClientMessageId: () => `fixed-${(idCounter += 1)}`,
      }),
    );

    act(() => result.current.setDraftText("Hello Pi"));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.draftText).toBe("");
    expect(result.current.visibleRows).toHaveLength(1);
    const [row] = result.current.visibleRows;
    expect(row.pending).toBe(true);
    expect(row.item).toMatchObject({
      type: "user_message",
      text: "Hello Pi",
      clientMessageId: "fixed-1",
    });
  });

  it('records an uploaded attachment on the same outbox entry as the text (T28B6, "through the core outbox")', async () => {
    const storage = new InMemoryStructuredStorage();
    const client = new FakeAgentTurnClient();
    const filePicker = new FakeFilePicker();
    filePicker.enqueue([makeFakePickedFile({ name: "report.pdf", mimeType: "application/pdf" })]);
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-42",
        clock: new FakeClock(9_000),
        structuredStorage: storage,
        filePicker,
        client,
        generateClientMessageId: () => "client-1",
      }),
    );

    await act(async () => {
      await result.current.attachments.pickAndAddFiles();
    });
    await waitFor(
      () => expect(result.current.attachments.hasPendingUploads).toBe(false),
      UPLOAD_SETTLE_WAIT,
    );

    act(() => result.current.setDraftText("See attached"));
    await act(async () => {
      await result.current.submit();
    });

    await waitFor(() =>
      expect(client.sentMessages).toEqual([
        expect.objectContaining({
          agentId: "session-42",
          text: "See attached",
          options: expect.objectContaining({
            attachments: [expect.objectContaining({ fileName: "report.pdf" })],
          }),
        }),
      ]),
    );
    // The attachment tray is reset once its refs have travelled with this submission.
    expect(result.current.attachments.attachments).toEqual([]);
  });

  it("records the submission in the outbox before any daemon acknowledgment", async () => {
    const storage = new InMemoryStructuredStorage();
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-42",
        clock: new FakeClock(9_000),
        structuredStorage: storage,
        filePicker: new FakeFilePicker(),
        generateClientMessageId: () => "client-1",
      }),
    );

    act(() => result.current.setDraftText("Ship it"));
    await act(async () => {
      await result.current.submit();
    });

    const entries = await storage.list<{
      sessionId: string;
      kind: string;
      payload: unknown;
      status: string;
    }>("composer/outbox");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      sessionId: "session-42",
      kind: "prompt",
      status: "pending",
      payload: { text: "Ship it", clientMessageId: "client-1" },
    });
  });

  it("does nothing when submitting a blank or whitespace-only draft", async () => {
    const storage = new InMemoryStructuredStorage();
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-1",
        clock: new FakeClock(1_000),
        structuredStorage: storage,
        filePicker: new FakeFilePicker(),
      }),
    );

    act(() => result.current.setDraftText("   "));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.visibleRows).toEqual([]);
    await waitFor(async () => {
      expect(await storage.list("composer/outbox")).toEqual([]);
    });
  });

  it("with a client wired, sends the submission over the wire and clears the outbox once acknowledged (steer/follow-up round trip)", async () => {
    const storage = new InMemoryStructuredStorage();
    const client = new FakeAgentTurnClient();
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-mid-turn",
        clock: new FakeClock(1_000),
        structuredStorage: storage,
        filePicker: new FakeFilePicker(),
        generateClientMessageId: () => "client-mid-turn",
        client,
      }),
    );

    // Whether the daemon treats this as a fresh prompt, a steer, or a
    // follow-up is its own decision (plan.md §12.2) — the composer makes
    // the identical call either way and only cares that it round-trips.
    act(() => result.current.setDraftText("Also check the other file"));
    await act(async () => {
      await result.current.submit();
    });

    expect(client.sentMessages).toEqual([
      {
        agentId: "session-mid-turn",
        text: "Also check the other file",
        options: { messageId: "client-mid-turn" },
      },
    ]);
    // "correct queue state": the outbox entry is removed once the daemon
    // acknowledges it (OutboxController.markSent), not left pending.
    expect(await storage.list("composer/outbox")).toEqual([]);
    expect(result.current.sendError).toBeNull();
  });

  it("defaults promptRouting to null (Auto) and omits streamingBehavior from the send when it is never set (T38B1b)", async () => {
    const client = new FakeAgentTurnClient();
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-1",
        clock: new FakeClock(1_000),
        structuredStorage: new InMemoryStructuredStorage(),
        filePicker: new FakeFilePicker(),
        generateClientMessageId: () => "client-1",
        client,
      }),
    );

    expect(result.current.promptRouting).toBeNull();

    act(() => result.current.setDraftText("plain send"));
    await act(async () => {
      await result.current.submit();
    });

    expect(client.sentMessages).toEqual([
      { agentId: "session-1", text: "plain send", options: { messageId: "client-1" } },
    ]);
    expect(client.sentMessages[0]?.options).not.toHaveProperty("streamingBehavior");
  });

  it("routes an explicit steer choice all the way to the real send call, at the AgentTurnClient boundary (T38B1b)", async () => {
    const client = new FakeAgentTurnClient();
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-1",
        clock: new FakeClock(1_000),
        structuredStorage: new InMemoryStructuredStorage(),
        filePicker: new FakeFilePicker(),
        generateClientMessageId: () => "client-1",
        client,
      }),
    );

    act(() => result.current.setPromptRouting("steer"));
    expect(result.current.promptRouting).toBe("steer");

    act(() => result.current.setDraftText("also check the tests"));
    await act(async () => {
      await result.current.submit();
    });

    // The recording fake, not local hook state, is what proves the value
    // actually reached the send call — deleting the forwarding in
    // `submit()` fails this exact assertion (see this task's report for
    // the mutation and counts).
    expect(client.sentMessages).toEqual([
      {
        agentId: "session-1",
        text: "also check the tests",
        options: { messageId: "client-1", streamingBehavior: "steer" },
      },
    ]);
  });

  it("routes an explicit follow-up choice to the real send call, and resets promptRouting to null once consumed (T38B1b)", async () => {
    let idCounter = 0;
    const client = new FakeAgentTurnClient();
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-1",
        clock: new FakeClock(1_000),
        structuredStorage: new InMemoryStructuredStorage(),
        filePicker: new FakeFilePicker(),
        generateClientMessageId: () => `client-${(idCounter += 1)}`,
        client,
      }),
    );

    act(() => result.current.setPromptRouting("followUp"));
    act(() => result.current.setDraftText("first, queued"));
    await act(async () => {
      await result.current.submit();
    });

    expect(client.sentMessages[0]?.options).toMatchObject({ streamingBehavior: "followUp" });
    // Consumed by that one submission: a routing choice is a per-message
    // modifier, not a sticky session setting, so it does not silently
    // keep queuing (or steering) later, unrelated sends.
    expect(result.current.promptRouting).toBeNull();

    act(() => result.current.setDraftText("second, unrelated"));
    await act(async () => {
      await result.current.submit();
    });

    expect(client.sentMessages[1]?.options).not.toHaveProperty("streamingBehavior");
  });

  it("parks a failed send as awaiting-confirmation and surfaces the error, without auto-resending", async () => {
    const storage = new InMemoryStructuredStorage();
    const client = new FakeAgentTurnClient();
    client.sendAgentMessageImpl = async () => {
      throw new Error("daemon unreachable");
    };
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-1",
        clock: new FakeClock(1_000),
        structuredStorage: storage,
        filePicker: new FakeFilePicker(),
        generateClientMessageId: () => "client-1",
        client,
      }),
    );

    act(() => result.current.setDraftText("Steer now"));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.sendError).toBe("daemon unreachable");
    const entries = await storage.list<{ status: string }>("composer/outbox");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe("awaiting-confirmation");
  });

  it("without a client wired, abort is a no-op and cannot be started", async () => {
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-1",
        clock: new FakeClock(1_000),
        structuredStorage: new InMemoryStructuredStorage(),
        filePicker: new FakeFilePicker(),
      }),
    );

    expect(result.current.canAbort).toBe(false);
    await act(async () => {
      await result.current.abort();
    });
    expect(result.current.isAborting).toBe(false);
    expect(result.current.abortError).toBeNull();
  });

  it("abort calls cancelAgent and reflects isAborting promptly, then clears it", async () => {
    const client = new FakeAgentTurnClient();
    let resolveCancel: () => void = () => {};
    client.cancelAgentImpl = () =>
      new Promise((resolve) => {
        resolveCancel = resolve;
      });
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-abort",
        clock: new FakeClock(1_000),
        structuredStorage: new InMemoryStructuredStorage(),
        filePicker: new FakeFilePicker(),
        client,
      }),
    );

    expect(result.current.canAbort).toBe(true);

    let abortPromise!: Promise<void>;
    act(() => {
      abortPromise = result.current.abort();
    });
    // Reflects promptly: `isAborting` flips before the daemon acknowledges.
    expect(result.current.isAborting).toBe(true);
    expect(result.current.canAbort).toBe(false);

    resolveCancel();
    await act(async () => {
      await abortPromise;
    });

    expect(result.current.isAborting).toBe(false);
    expect(result.current.canAbort).toBe(true);
    expect(client.canceledAgentIds).toEqual(["session-abort"]);
    expect(result.current.abortError).toBeNull();
  });

  it("surfaces an abort failure without leaving isAborting stuck", async () => {
    const client = new FakeAgentTurnClient();
    client.cancelAgentImpl = async () => {
      throw new Error("no active turn");
    };
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-1",
        clock: new FakeClock(1_000),
        structuredStorage: new InMemoryStructuredStorage(),
        filePicker: new FakeFilePicker(),
        client,
      }),
    );

    await act(async () => {
      await result.current.abort();
    });

    expect(result.current.isAborting).toBe(false);
    expect(result.current.abortError).toBe("no active turn");
    expect(result.current.canAbort).toBe(true);
  });

  it("starts with an empty queue", () => {
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-1",
        clock: new FakeClock(1_000),
        structuredStorage: new InMemoryStructuredStorage(),
        filePicker: new FakeFilePicker(),
      }),
    );

    expect(result.current.queueUpdate).toEqual({ steering: [], followUp: [] });
    expect(result.current.queueDepth).toBe(0);
  });

  it("reflects the daemon's live pi_queue_update pushes and their combined depth", () => {
    const client = new FakeAgentTurnClient();
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-queue",
        clock: new FakeClock(1_000),
        structuredStorage: new InMemoryStructuredStorage(),
        filePicker: new FakeFilePicker(),
        client,
      }),
    );

    expect(result.current.queueDepth).toBe(0);

    act(() => {
      client.emitQueueUpdate("session-queue", {
        steering: ["also check the tests"],
        followUp: ["and update the docs", "then ship it"],
      });
    });

    expect(result.current.queueUpdate).toEqual({
      steering: ["also check the tests"],
      followUp: ["and update the docs", "then ship it"],
    });
    expect(result.current.queueDepth).toBe(3);
  });

  it("ignores queue updates for a different agent", () => {
    const client = new FakeAgentTurnClient();
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-a",
        clock: new FakeClock(1_000),
        structuredStorage: new InMemoryStructuredStorage(),
        filePicker: new FakeFilePicker(),
        client,
      }),
    );

    act(() => {
      client.emitQueueUpdate("session-b", { steering: ["not for us"], followUp: [] });
    });

    expect(result.current.queueDepth).toBe(0);
  });

  it("keeps distinct optimistic rows in submission order across two sends", async () => {
    let idCounter = 0;
    const { result } = renderHook(() =>
      useComposer({
        sessionId: "session-1",
        clock: new FakeClock(1_000),
        structuredStorage: new InMemoryStructuredStorage(),
        filePicker: new FakeFilePicker(),
        generateClientMessageId: () => `msg-${(idCounter += 1)}`,
      }),
    );

    act(() => result.current.setDraftText("first"));
    await act(async () => {
      await result.current.submit();
    });
    act(() => result.current.setDraftText("second"));
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.visibleRows.map((row) => (row.item as { text: string }).text)).toEqual([
      "first",
      "second",
    ]);
  });
});
