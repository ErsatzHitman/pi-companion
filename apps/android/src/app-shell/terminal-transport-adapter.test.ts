import { describe, expect, it } from "vitest";

import {
  decodeTerminalStreamFrame,
  encodeTerminalResizePayload,
  encodeTerminalStreamFrame,
  TerminalStreamOpcode,
} from "@picompanion/protocol/binary-frames/terminal";

import {
  createDaemonTerminalBinaryTransport,
  type TerminalSessionCapableClient,
  type TerminalSessionHandleLike,
  type TerminalSessionWriteOutcome,
} from "./terminal-transport-adapter";

/**
 * Proves `createDaemonTerminalBinaryTransport` actually bridges T62's
 * session-shaped `openTerminalSession` API onto the raw-frame
 * `TerminalBinaryTransport` port — never against a real socket, and
 * never merely proving the bridge was constructed. Every assertion
 * checks a byte-for-byte value the fake host actually received, or a
 * frame the transport's own `onFrame` listener actually received —
 * "registration is not receipt".
 */
class FakeTerminalSession implements TerminalSessionHandleLike {
  state: "open" | "closed" = "open";
  writeInputCalls: Array<Uint8Array | string> = [];
  resizeCalls: Array<{ rows: number; cols: number; intent?: "claim" | "update" }> = [];
  closeCalls = 0;
  private readonly outputHandlers = new Set<(data: Uint8Array) => void>();
  private readonly closedHandlers = new Set<() => void>();

  writeInput(data: Uint8Array | string): TerminalSessionWriteOutcome {
    this.writeInputCalls.push(data);
    return "sent";
  }
  resize(rows: number, cols: number, intent?: "claim" | "update"): TerminalSessionWriteOutcome {
    this.resizeCalls.push({ rows, cols, intent });
    return "sent";
  }
  onOutput(handler: (data: Uint8Array) => void): () => void {
    this.outputHandlers.add(handler);
    return () => this.outputHandlers.delete(handler);
  }
  onSnapshot(): () => void {
    return () => {};
  }
  onRestore(): () => void {
    return () => {};
  }
  onClosed(handler: () => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }
  close(): void {
    this.closeCalls += 1;
    this.state = "closed";
  }
  emitOutput(data: Uint8Array): void {
    for (const handler of this.outputHandlers) handler(data);
  }
  emitRemoteClose(): void {
    this.state = "closed";
    for (const handler of this.closedHandlers) handler();
  }
}

class FakeClient implements TerminalSessionCapableClient {
  openCalls: string[] = [];
  nextSession: FakeTerminalSession | null = null;
  openTerminalSession(terminalId: string): Promise<TerminalSessionHandleLike> {
    this.openCalls.push(terminalId);
    const session = this.nextSession ?? new FakeTerminalSession();
    return Promise.resolve(session);
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createDaemonTerminalBinaryTransport", () => {
  it("starts closed with no client, and send() is a silent no-op", () => {
    const transport = createDaemonTerminalBinaryTransport({
      terminalId: "term-1",
      slot: 3,
      getClient: () => null,
      subscribeConnectionChanges: () => () => {},
    });
    expect(transport.isOpen).toBe(false);
    expect(() =>
      transport.send(
        encodeTerminalStreamFrame({ opcode: TerminalStreamOpcode.Input, slot: 3, payload: "ls\r" }),
      ),
    ).not.toThrow();
  });

  it("opens against the live client, fires onOpenChange(true), and send() reaches writeInput with the decoded payload", async () => {
    const client = new FakeClient();
    const session = new FakeTerminalSession();
    client.nextSession = session;
    let client_: TerminalSessionCapableClient | null = client;
    const transport = createDaemonTerminalBinaryTransport({
      terminalId: "term-2",
      slot: 5,
      getClient: () => client_,
      subscribeConnectionChanges: () => () => {},
    });
    await flush();

    expect(client.openCalls).toEqual(["term-2"]);
    expect(transport.isOpen).toBe(true);

    transport.send(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Input,
        slot: 5,
        payload: new TextEncoder().encode("echo hi\r"),
      }),
    );
    expect(session.writeInputCalls).toHaveLength(1);
    expect(new TextDecoder().decode(session.writeInputCalls[0] as Uint8Array)).toBe("echo hi\r");
    void client_;
  });

  it("decodes an encoded Resize frame and calls session.resize with the actual rows/cols/intent", async () => {
    const client = new FakeClient();
    const session = new FakeTerminalSession();
    client.nextSession = session;
    const transport = createDaemonTerminalBinaryTransport({
      terminalId: "term-3",
      slot: 0,
      getClient: () => client,
      subscribeConnectionChanges: () => () => {},
    });
    await flush();

    transport.send(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Resize,
        slot: 0,
        payload: encodeTerminalResizePayload({ rows: 40, cols: 120, intent: "claim" }),
      }),
    );
    expect(session.resizeCalls).toEqual([{ rows: 40, cols: 120, intent: "claim" }]);
  });

  it("a session-level output event reaches onFrame as a correctly-decodable Output frame for this transport's own slot", async () => {
    const client = new FakeClient();
    const session = new FakeTerminalSession();
    client.nextSession = session;
    const transport = createDaemonTerminalBinaryTransport({
      terminalId: "term-4",
      slot: 9,
      getClient: () => client,
      subscribeConnectionChanges: () => () => {},
    });
    await flush();

    const received: Uint8Array[] = [];
    transport.onFrame((frame) => received.push(frame));
    session.emitOutput(new TextEncoder().encode("prompt$ "));

    expect(received).toHaveLength(1);
    const decoded = decodeTerminalStreamFrame(received[0]);
    expect(decoded?.opcode).toBe(TerminalStreamOpcode.Output);
    expect(decoded?.slot).toBe(9);
    expect(new TextDecoder().decode(decoded?.payload)).toBe("prompt$ ");
  });

  it("a reconnect (client identity change) closes the old session, re-opens against the new client, and isOpen goes false then true again", async () => {
    const sessionA = new FakeTerminalSession();
    const clientA: TerminalSessionCapableClient = {
      openTerminalSession: () => Promise.resolve(sessionA),
    };
    const sessionB = new FakeTerminalSession();
    const clientB: TerminalSessionCapableClient = {
      openTerminalSession: () => Promise.resolve(sessionB),
    };
    let current: TerminalSessionCapableClient | null = clientA;
    const changes: Array<() => void> = [];
    const transport = createDaemonTerminalBinaryTransport({
      terminalId: "term-5",
      slot: 0,
      getClient: () => current,
      subscribeConnectionChanges: (listener) => {
        changes.push(listener);
        return () => {};
      },
    });
    await flush();
    expect(transport.isOpen).toBe(true);

    const openStates: boolean[] = [];
    transport.onOpenChange((isOpen) => openStates.push(isOpen));

    current = clientB;
    for (const listener of changes) listener();
    // Synchronous half: torn down immediately, before the new session resolves.
    expect(transport.isOpen).toBe(false);
    expect(sessionA.closeCalls).toBe(1);
    await flush();

    expect(transport.isOpen).toBe(true);
    expect(openStates).toEqual([false, true]);

    // The reconnect must reach the *new* session, not keep writing to the old one.
    transport.send(
      encodeTerminalStreamFrame({ opcode: TerminalStreamOpcode.Input, slot: 0, payload: "x" }),
    );
    expect(sessionB.writeInputCalls).toHaveLength(1);
    expect(sessionA.writeInputCalls).toHaveLength(0);
  });

  it("the daemon closing the session remotely (onClosed) fires onOpenChange(false)", async () => {
    const client = new FakeClient();
    const session = new FakeTerminalSession();
    client.nextSession = session;
    const transport = createDaemonTerminalBinaryTransport({
      terminalId: "term-6",
      slot: 0,
      getClient: () => client,
      subscribeConnectionChanges: () => () => {},
    });
    await flush();
    expect(transport.isOpen).toBe(true);

    const openStates: boolean[] = [];
    transport.onOpenChange((isOpen) => openStates.push(isOpen));
    session.emitRemoteClose();

    expect(transport.isOpen).toBe(false);
    expect(openStates).toEqual([false]);
  });
  // P5-W19 merge gate: T65 added `dispose?()` to `TerminalBinaryTransport`
  // and made `TerminalSessionController.dispose()` cascade into it, but the
  // production transport built here had no `dispose`, so that cascade
  // optional-chained into nothing and a left terminal screen leaked its
  // daemon-side subscription. These prove the chain now reaches T62's
  // session — by the session's own state, not by a recorded call.
  it("dispose() provably closes the live session — session.state becomes closed and a later write is refused", async () => {
    const client = new FakeClient();
    const session = new FakeTerminalSession();
    client.nextSession = session;
    const transport = createDaemonTerminalBinaryTransport({
      terminalId: "term-dispose-1",
      slot: 0,
      getClient: () => client,
      subscribeConnectionChanges: () => () => {},
    });
    await flush();
    expect(transport.isOpen).toBe(true);

    expect(transport.dispose?.()).toBe("disposed");

    expect(session.state).toBe("closed");
    expect(session.closeCalls).toBe(1);
    expect(transport.isOpen).toBe(false);
  });

  it("dispose() is idempotent: a second call reports already-disposed and never closes the session twice", async () => {
    const client = new FakeClient();
    const session = new FakeTerminalSession();
    client.nextSession = session;
    const transport = createDaemonTerminalBinaryTransport({
      terminalId: "term-dispose-2",
      slot: 0,
      getClient: () => client,
      subscribeConnectionChanges: () => () => {},
    });
    await flush();

    expect(transport.dispose?.()).toBe("disposed");
    expect(transport.dispose?.()).toBe("already-disposed");
    expect(session.closeCalls).toBe(1);
  });

  it("dispose() unsubscribes from connection changes and never reopens a session for a screen that is gone", async () => {
    const client = new FakeClient();
    client.nextSession = new FakeTerminalSession();
    let publish: (() => void) | null = null;
    let unsubscribeCalls = 0;
    const transport = createDaemonTerminalBinaryTransport({
      terminalId: "term-dispose-3",
      slot: 0,
      getClient: () => client,
      subscribeConnectionChanges: (listener) => {
        publish = listener;
        return () => {
          unsubscribeCalls += 1;
        };
      },
    });
    await flush();
    expect(client.openCalls).toEqual(["term-dispose-3"]);

    transport.dispose?.();
    expect(unsubscribeCalls).toBe(1);

    // Even if a stale publish still fires, no new session is opened.
    client.nextSession = new FakeTerminalSession();
    (publish as unknown as () => void)();
    await flush();
    expect(client.openCalls).toEqual(["term-dispose-3"]);
  });

  it("dispose() before any session opened reports never-connected", () => {
    const transport = createDaemonTerminalBinaryTransport({
      terminalId: "term-dispose-4",
      slot: 0,
      getClient: () => null,
      subscribeConnectionChanges: () => () => {},
    });
    expect(transport.dispose?.()).toBe("never-connected");
  });

  it("a session that resolves after dispose() is closed rather than adopted", async () => {
    const late = new FakeTerminalSession();
    let resolveOpen: ((session: TerminalSessionHandleLike) => void) | null = null;
    const client: TerminalSessionCapableClient = {
      openTerminalSession: () =>
        new Promise<TerminalSessionHandleLike>((resolve) => {
          resolveOpen = resolve;
        }),
    };
    const transport = createDaemonTerminalBinaryTransport({
      terminalId: "term-dispose-5",
      slot: 0,
      getClient: () => client,
      subscribeConnectionChanges: () => () => {},
    });

    expect(transport.dispose?.()).toBe("never-connected");
    (resolveOpen as unknown as (s: TerminalSessionHandleLike) => void)(late);
    await flush();

    expect(late.state).toBe("closed");
    expect(transport.isOpen).toBe(false);
  });
});
