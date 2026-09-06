import { describe, expect, it, vi } from "vitest";
import type { TerminalStreamEvent } from "@picompanion/client/internal/daemon-client";
import type { TerminalInput, TerminalState } from "@picompanion/protocol/messages";
import {
  TerminalController,
  type TerminalControllerEvent,
  type TerminalControllerStatus,
  type TerminalRestoreOptions,
  type TerminalRpcClient,
  type TerminalSubscribeOutcome,
} from "./terminal-controller.js";

function bytes(length: number, fill = 1): Uint8Array {
  return new Uint8Array(length).fill(fill);
}

/**
 * An in-memory `TerminalRpcClient` double. `subscribeTerminal` resolves
 * with whatever `nextOutcome` (or `nextOutcomeQueue`) is armed, and
 * `emit()` lets a test drive the stream exactly like the daemon would.
 */
class FakeTerminalRpcClient implements TerminalRpcClient {
  subscribeCalls: Array<{
    terminalId: string;
    restore?: TerminalRestoreOptions;
    requestId?: string;
  }> = [];
  unsubscribeCalls: string[] = [];
  sentInput: Array<{ terminalId: string; message: TerminalInput["message"] }> = [];

  private readonly streamListeners = new Set<(event: TerminalStreamEvent) => void>();
  private outcomeQueue: Array<
    TerminalSubscribeOutcome | (() => Promise<TerminalSubscribeOutcome>)
  > = [];
  private defaultOutcome: TerminalSubscribeOutcome = { terminalId: "term-1", slot: 0, error: null };

  setDefaultOutcome(outcome: TerminalSubscribeOutcome): void {
    this.defaultOutcome = outcome;
  }

  queueOutcome(
    outcome: TerminalSubscribeOutcome | (() => Promise<TerminalSubscribeOutcome>),
  ): void {
    this.outcomeQueue.push(outcome);
  }

  async subscribeTerminal(
    terminalId: string,
    options?: { restore?: TerminalRestoreOptions; requestId?: string },
  ): Promise<TerminalSubscribeOutcome> {
    this.subscribeCalls.push({ terminalId, ...options });
    const queued = this.outcomeQueue.shift();
    if (queued) {
      return typeof queued === "function" ? queued() : queued;
    }
    return this.defaultOutcome;
  }

  unsubscribeTerminal(terminalId: string): void {
    this.unsubscribeCalls.push(terminalId);
  }

  sendTerminalInput(terminalId: string, message: TerminalInput["message"]): void {
    this.sentInput.push({ terminalId, message });
  }

  onTerminalStreamEvent(handler: (event: TerminalStreamEvent) => void): () => void {
    this.streamListeners.add(handler);
    return () => {
      this.streamListeners.delete(handler);
    };
  }

  emit(event: TerminalStreamEvent): void {
    for (const listener of this.streamListeners) {
      listener(event);
    }
  }

  get streamListenerCount(): number {
    return this.streamListeners.size;
  }
}

function collectingSink() {
  const writes: Uint8Array[] = [];
  const resets: Uint8Array[] = [];
  return {
    writes,
    resets,
    write(data: Uint8Array): void {
      writes.push(data);
    },
    reset(data: Uint8Array): void {
      resets.push(data);
    },
  };
}

describe("TerminalController", () => {
  it("round-trips subscribe -> output/restore/state events through to the sink and listeners", async () => {
    const client = new FakeTerminalRpcClient();
    const sink = collectingSink();
    const statuses: TerminalControllerStatus[] = [];
    const events: TerminalControllerEvent[] = [];
    const controller = new TerminalController({ client, terminalId: "term-1", sink });
    controller.onStatus((status) => statuses.push(status));
    controller.onEvent((event) => events.push(event));

    const outcome = await controller.subscribe();

    expect(outcome).toEqual({ terminalId: "term-1", slot: 0, error: null });
    expect(controller.getStatus()).toBe("subscribed");
    expect(statuses).toEqual(["subscribing", "subscribed"]);
    expect(client.subscribeCalls).toEqual([
      { terminalId: "term-1", restore: { mode: "visible-snapshot" } },
    ]);

    client.emit({ type: "output", terminalId: "term-1", data: bytes(3, 7) });
    client.emit({ type: "restore", terminalId: "term-1", data: bytes(2, 9) });
    const state: TerminalState = {
      rows: 24,
      cols: 80,
      cursorRow: 0,
      cursorCol: 0,
      cursorVisible: true,
      lines: [],
    } as unknown as TerminalState;
    client.emit({ type: "snapshot", terminalId: "term-1", state });

    // Output/restore are drained through the buffer asynchronously.
    await Promise.resolve();
    await Promise.resolve();

    expect(sink.writes.map((chunk) => chunk[0])).toEqual([7]);
    expect(sink.resets.map((chunk) => chunk[0])).toEqual([9]);
    expect(events).toContainEqual({ type: "state", state });
  });

  it("ignores stream events for a different terminalId", async () => {
    const client = new FakeTerminalRpcClient();
    const sink = collectingSink();
    const controller = new TerminalController({ client, terminalId: "term-1", sink });
    await controller.subscribe();

    client.emit({ type: "output", terminalId: "term-other", data: bytes(3) });
    await Promise.resolve();

    expect(sink.writes).toHaveLength(0);
  });

  it("forwards write() as terminal input and resize() as a resize request, and is a no-op once disposed", () => {
    const client = new FakeTerminalRpcClient();
    const sink = collectingSink();
    const controller = new TerminalController({ client, terminalId: "term-1", sink });

    controller.write("ls -la\n");
    controller.resize(24, 80, "claim");

    expect(client.sentInput).toEqual([
      { terminalId: "term-1", message: { type: "input", data: "ls -la\n" } },
      { terminalId: "term-1", message: { type: "resize", rows: 24, cols: 80, intent: "claim" } },
    ]);

    controller.dispose();
    client.sentInput.length = 0;
    controller.write("should not send");
    controller.resize(10, 10);
    expect(client.sentInput).toEqual([]);
  });

  it("sets status to error and records the message when subscribeTerminal reports an error", async () => {
    const client = new FakeTerminalRpcClient();
    client.setDefaultOutcome({ terminalId: "term-1", error: "terminal not found" });
    const sink = collectingSink();
    const controller = new TerminalController({ client, terminalId: "term-1", sink });

    const outcome = await controller.subscribe();

    expect(outcome.error).toBe("terminal not found");
    expect(controller.getStatus()).toBe("error");
    expect(controller.getError()).toBe("terminal not found");
  });

  it("unsubscribe() tears down the stream listener and can be resubscribed afterwards", async () => {
    const client = new FakeTerminalRpcClient();
    const sink = collectingSink();
    const controller = new TerminalController({ client, terminalId: "term-1", sink });

    await controller.subscribe();
    expect(client.streamListenerCount).toBe(1);

    controller.unsubscribe();
    expect(controller.getStatus()).toBe("unsubscribed");
    expect(client.unsubscribeCalls).toEqual(["term-1"]);
    expect(client.streamListenerCount).toBe(0);

    await controller.subscribe();
    expect(controller.getStatus()).toBe("subscribed");
    expect(client.streamListenerCount).toBe(1);
  });

  it("dispose() unsubscribes once, releases listeners, and rejects further subscribe() calls", async () => {
    const client = new FakeTerminalRpcClient();
    const sink = collectingSink();
    const controller = new TerminalController({ client, terminalId: "term-1", sink });
    const events: TerminalControllerEvent[] = [];
    controller.onEvent((event) => events.push(event));

    await controller.subscribe();
    controller.dispose();

    expect(controller.getStatus()).toBe("disposed");
    expect(client.unsubscribeCalls).toEqual(["term-1"]);
    expect(client.streamListenerCount).toBe(0);

    // Further stream events must not resurrect a disposed controller.
    client.emit({ type: "output", terminalId: "term-1", data: bytes(2) });
    expect(events).toEqual([]);

    await expect(controller.subscribe()).rejects.toThrow(/disposed/);
  });

  it("propagates buffer congestion events and automatically resyncs after a hard-cap overflow", async () => {
    const client = new FakeTerminalRpcClient();
    const sink = collectingSink();
    const events: TerminalControllerEvent[] = [];
    const controller = new TerminalController({
      client,
      terminalId: "term-1",
      sink,
      softBufferBytes: 10,
      hardBufferBytes: 20,
    });
    controller.onEvent((event) => events.push(event));

    await controller.subscribe();
    client.subscribeCalls.length = 0;

    // First chunk is handed straight to the (synchronous) sink, so it
    // never counts as "buffered"; flood past soft, then hard, cap.
    client.emit({ type: "output", terminalId: "term-1", data: bytes(5) });
    client.emit({ type: "output", terminalId: "term-1", data: bytes(15) }); // over soft cap
    client.emit({ type: "output", terminalId: "term-1", data: bytes(20) }); // over hard cap -> overflow

    expect(events).toContainEqual({ type: "congestion", congested: true, bufferedBytes: 15 });
    expect(events.some((event) => event.type === "overflow")).toBe(true);

    // The overflow must trigger an automatic full-snapshot resubscribe.
    await Promise.resolve();
    await Promise.resolve();
    expect(client.subscribeCalls).toEqual([
      { terminalId: "term-1", restore: { mode: "full-snapshot" } },
    ]);
  });

  it("emits resync-failed when the automatic post-overflow resubscribe itself errors", async () => {
    const client = new FakeTerminalRpcClient();
    const sink = collectingSink();
    const events: TerminalControllerEvent[] = [];
    const controller = new TerminalController({
      client,
      terminalId: "term-1",
      sink,
      softBufferBytes: 10,
      hardBufferBytes: 20,
    });
    controller.onEvent((event) => events.push(event));

    await controller.subscribe();
    client.queueOutcome({ terminalId: "term-1", error: "resync failed" });

    client.emit({ type: "output", terminalId: "term-1", data: bytes(5) });
    client.emit({ type: "output", terminalId: "term-1", data: bytes(30) }); // over hard cap -> overflow

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toContainEqual({ type: "resync-failed", error: "resync failed" });
    expect(controller.getError()).toBe("resync failed");
  });

  it("does not update state or notify listeners once disposed mid-subscribe", async () => {
    const client = new FakeTerminalRpcClient();
    let resolveOutcome: ((outcome: TerminalSubscribeOutcome) => void) | undefined;
    client.queueOutcome(
      () =>
        new Promise<TerminalSubscribeOutcome>((resolve) => {
          resolveOutcome = resolve;
        }),
    );
    const sink = collectingSink();
    const statuses: TerminalControllerStatus[] = [];
    const controller = new TerminalController({ client, terminalId: "term-1", sink });
    controller.onStatus((status) => statuses.push(status));

    const pending = controller.subscribe();
    controller.dispose();
    resolveOutcome?.({ terminalId: "term-1", slot: 0, error: null });
    await pending;

    // dispose() sets status directly without notifying listeners, so the
    // only observed transition is "subscribing" — never "subscribed".
    expect(statuses).toEqual(["subscribing"]);
    expect(controller.getStatus()).toBe("disposed");
  });

  const noopClient: TerminalRpcClient = {
    subscribeTerminal: vi.fn(),
    unsubscribeTerminal: vi.fn(),
    sendTerminalInput: vi.fn(),
    onTerminalStreamEvent: vi.fn(() => () => {}),
  };

  it("unsubscribe()/dispose() are no-ops when never subscribed", () => {
    const sink = collectingSink();
    const controller = new TerminalController({ client: noopClient, terminalId: "term-1", sink });
    controller.unsubscribe();
    expect(controller.getStatus()).toBe("idle");
    controller.dispose();
    expect(controller.getStatus()).toBe("disposed");
  });
});
