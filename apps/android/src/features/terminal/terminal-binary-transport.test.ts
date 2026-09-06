import {
  decodeTerminalSnapshotPayload,
  decodeTerminalStreamFrame,
  encodeTerminalResizePayload,
  encodeTerminalStreamFrame,
  TerminalStreamOpcode,
} from "@picompanion/protocol/binary-frames/terminal";
import type { TerminalState } from "@picompanion/protocol/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createNotConnectedTerminalBinaryTransport,
  createTerminalSessionBinaryTransport,
  type TerminalSessionHandleLike,
} from "./terminal-binary-transport";

const STATE: TerminalState = {
  rows: 24,
  cols: 80,
  grid: [[{ char: "$" }]],
  scrollback: [],
  cursor: { row: 0, col: 0 },
};

/**
 * A `TerminalSessionHandleLike` test double with the *same state
 * semantics* T62's real `TerminalSessionImpl` has — `close()` actually
 * flips `state` to `"closed"` and a post-close `writeInput` actually
 * returns `"dropped-closed"` — so assertions against this fake prove the
 * session was really closed, not merely that `close()` was called. See
 * `daemon-client.test.ts`'s `openTerminalSession` tests and
 * `app-shell/terminal-transport-adapter.test.ts`'s `FakeTerminalSession`
 * for the identical convention this mirrors.
 */
class FakeSession implements TerminalSessionHandleLike {
  state: "open" | "closed" = "open";
  closeCalls = 0;
  writeInputCalls: Array<Uint8Array | string> = [];
  resizeCalls: Array<{ rows: number; cols: number; intent?: "claim" | "update" }> = [];
  private readonly outputHandlers = new Set<(data: Uint8Array) => void>();
  private readonly snapshotHandlers = new Set<(state: TerminalState) => void>();
  private readonly restoreHandlers = new Set<(data: Uint8Array) => void>();
  private readonly closedHandlers = new Set<() => void>();
  /** Kept separately from `outputHandlers` so a test can fire a handler even after this session's own unsubscribe ran — simulating a genuinely in-flight event racing a dispose, not just an already-cleaned-up one. */
  lastOutputHandler: ((data: Uint8Array) => void) | null = null;

  writeInput(data: Uint8Array | string): "sent" | "dropped-not-connected" | "dropped-closed" {
    if (this.state === "closed") {
      return "dropped-closed";
    }
    this.writeInputCalls.push(data);
    return "sent";
  }

  resize(
    rows: number,
    cols: number,
    intent?: "claim" | "update",
  ): "sent" | "dropped-not-connected" | "dropped-closed" {
    if (this.state === "closed") {
      return "dropped-closed";
    }
    this.resizeCalls.push({ rows, cols, intent });
    return "sent";
  }

  onOutput(handler: (data: Uint8Array) => void): () => void {
    this.outputHandlers.add(handler);
    this.lastOutputHandler = handler;
    return () => this.outputHandlers.delete(handler);
  }

  onSnapshot(handler: (state: TerminalState) => void): () => void {
    this.snapshotHandlers.add(handler);
    return () => this.snapshotHandlers.delete(handler);
  }

  onRestore(handler: (data: Uint8Array) => void): () => void {
    this.restoreHandlers.add(handler);
    return () => this.restoreHandlers.delete(handler);
  }

  onClosed(handler: () => void): () => void {
    this.closedHandlers.add(handler);
    return () => this.closedHandlers.delete(handler);
  }

  close(): void {
    this.closeCalls += 1;
    if (this.state === "closed") {
      return;
    }
    this.state = "closed";
    for (const handler of this.closedHandlers) handler();
  }

  fireOutput(data: Uint8Array): void {
    for (const handler of this.outputHandlers) handler(data);
  }

  fireSnapshot(state: TerminalState): void {
    for (const handler of this.snapshotHandlers) handler(state);
  }

  /** Fires the *captured* output handler directly, bypassing this session's own unsubscribe bookkeeping — simulates an event already in flight when `dispose()` ran. */
  fireOutputDirect(data: Uint8Array): void {
    this.lastOutputHandler?.(data);
  }
}

describe("createNotConnectedTerminalBinaryTransport — dispose", () => {
  it("dispose is a named no-op: never-connected, since no session was ever opened", () => {
    const transport = createNotConnectedTerminalBinaryTransport();
    expect(transport.dispose?.()).toBe("never-connected");
    // Idempotent by construction: calling again reports the same named state.
    expect(transport.dispose?.()).toBe("never-connected");
  });
});

describe("createTerminalSessionBinaryTransport — dispose reaches session.close()", () => {
  it("dispose provably closes the underlying session — asserted by the session's own state, not by the call existing", () => {
    const session = new FakeSession();
    const transport = createTerminalSessionBinaryTransport({ session, slot: 0 });

    expect(session.state).toBe("open");
    const outcome = transport.dispose?.();
    expect(outcome).toBe("disposed");

    // The proof: the session itself is now closed, and behaves like a
    // closed session for a subsequent write — not just a recorded call.
    expect(session.state).toBe("closed");
    expect(session.writeInput(new Uint8Array([1]))).toBe("dropped-closed");
  });

  it("disposing twice is a named no-op: the second call reports already-disposed and never calls session.close() again", () => {
    const session = new FakeSession();
    const transport = createTerminalSessionBinaryTransport({ session, slot: 0 });

    expect(transport.dispose?.()).toBe("disposed");
    expect(transport.dispose?.()).toBe("already-disposed");
    expect(session.closeCalls).toBe(1);
  });

  it("dispose makes isOpen read false and send a silent no-op", () => {
    const session = new FakeSession();
    const transport = createTerminalSessionBinaryTransport({ session, slot: 0 });
    expect(transport.isOpen).toBe(true);

    transport.dispose?.();
    expect(transport.isOpen).toBe(false);

    transport.send(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Input,
        slot: 0,
        payload: new Uint8Array([1]),
      }),
    );
    expect(session.writeInputCalls).toHaveLength(0);
  });

  it("a frame arriving after dispose lands in the named drop state and never reaches an onFrame subscriber", () => {
    const session = new FakeSession();
    const drops: string[] = [];
    const transport = createTerminalSessionBinaryTransport({
      session,
      slot: 0,
      onFrameDropped: (reason) => drops.push(reason),
    });
    const received: Uint8Array[] = [];
    transport.onFrame((frame) => received.push(frame));

    transport.dispose?.();

    // Simulates an output event already in flight when dispose ran,
    // bypassing this session's own unsubscribe bookkeeping — proves the
    // transport's own `disposed` guard, not just the session's cleanup.
    session.fireOutputDirect(new Uint8Array([9, 9, 9]));

    expect(received).toHaveLength(0);
    expect(drops).toEqual(["disposed"]);
  });

  it("a frame that arrives while still open reaches the subscriber untouched by the drop path", () => {
    const session = new FakeSession();
    const drops: string[] = [];
    const transport = createTerminalSessionBinaryTransport({
      session,
      slot: 0,
      onFrameDropped: (reason) => drops.push(reason),
    });
    const received: Uint8Array[] = [];
    transport.onFrame((frame) => received.push(frame));

    session.fireOutput(new Uint8Array([7]));

    expect(received).toHaveLength(1);
    const decoded = decodeTerminalStreamFrame(received[0]!);
    expect(decoded?.opcode).toBe(TerminalStreamOpcode.Output);
    expect(decoded?.payload).toEqual(new Uint8Array([7]));
    expect(drops).toHaveLength(0);
  });

  it("send decodes Input and Resize frames onto the session, encoding/decoding round-trip correctly", () => {
    const session = new FakeSession();
    const transport = createTerminalSessionBinaryTransport({ session, slot: 3 });

    transport.send(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Input,
        slot: 3,
        payload: new TextEncoder().encode("ls\n"),
      }),
    );
    expect(session.writeInputCalls).toEqual([new TextEncoder().encode("ls\n")]);

    transport.send(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Resize,
        slot: 3,
        payload: encodeTerminalResizePayload({ rows: 40, cols: 120, intent: "claim" }),
      }),
    );
    expect(session.resizeCalls).toEqual([{ rows: 40, cols: 120, intent: "claim" }]);
  });

  it("forwards a Snapshot event through as an encoded frame carrying the same terminal state", () => {
    const session = new FakeSession();
    const transport = createTerminalSessionBinaryTransport({ session, slot: 0 });
    const received: Uint8Array[] = [];
    transport.onFrame((frame) => received.push(frame));

    session.fireSnapshot(STATE);

    expect(received).toHaveLength(1);
    const decoded = decodeTerminalStreamFrame(received[0]!);
    expect(decoded?.opcode).toBe(TerminalStreamOpcode.Snapshot);
    expect(decodeTerminalSnapshotPayload(decoded!.payload)).toEqual(STATE);
  });

  it("onClosed (a daemon-reported remote exit) flips isOpen false without requiring a local dispose", () => {
    const session = new FakeSession();
    const transport = createTerminalSessionBinaryTransport({ session, slot: 0 });
    expect(transport.isOpen).toBe(true);

    session.close();
    expect(transport.isOpen).toBe(false);
  });
});

describe("createTerminalSessionBinaryTransport — no terminal content ever reaches a log", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    infoSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it("writing, receiving, dropping-after-dispose, and disposing a session-bound transport never calls a console method", () => {
    const session = new FakeSession();
    const transport = createTerminalSessionBinaryTransport({
      session,
      slot: 0,
      onFrameDropped: () => {},
    });
    transport.onFrame(() => {});
    transport.send(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Input,
        slot: 0,
        payload: new TextEncoder().encode("secret-terminal-bytes"),
      }),
    );
    session.fireOutput(new TextEncoder().encode("more-secret-output"));
    transport.dispose?.();
    session.fireOutputDirect(new TextEncoder().encode("post-dispose-bytes"));
    transport.dispose?.();

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
  });
});
