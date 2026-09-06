import { describe, expect, test, vi } from "vitest";

import { TerminalSessionRegistry, type TerminalSessionRegistryHost } from "./terminal-session.js";
import type { TerminalStreamEvent } from "./terminal-stream-router.js";

/** A fully in-memory, controllable stand-in for `DaemonClient`'s terminal primitives. */
function createFakeHost(): TerminalSessionRegistryHost & {
  connected: boolean;
  streamListeners: Array<(event: TerminalStreamEvent) => void>;
  subscribeCalls: string[];
  unsubscribeCalls: string[];
  inputCalls: Array<{ terminalId: string; data: Uint8Array | string }>;
  resizeCalls: Array<{ terminalId: string; rows: number; cols: number; intent?: string }>;
  subscribeError: string | null;
  emit(event: TerminalStreamEvent): void;
  emitRemoteExit(terminalId: string): void;
} {
  const streamListeners: Array<(event: TerminalStreamEvent) => void> = [];
  const remoteExitListeners: Array<(terminalId: string) => void> = [];
  const state = {
    connected: true,
    streamListeners,
    subscribeCalls: [] as string[],
    unsubscribeCalls: [] as string[],
    inputCalls: [] as Array<{ terminalId: string; data: Uint8Array | string }>,
    resizeCalls: [] as Array<{ terminalId: string; rows: number; cols: number; intent?: string }>,
    subscribeError: null as string | null,
    isConnected: () => state.connected,
    subscribe: async (terminalId: string) => {
      state.subscribeCalls.push(terminalId);
      return { error: state.subscribeError };
    },
    unsubscribe: (terminalId: string) => {
      state.unsubscribeCalls.push(terminalId);
    },
    sendInput: (terminalId: string, data: Uint8Array | string) => {
      state.inputCalls.push({ terminalId, data });
    },
    sendResize: (terminalId: string, rows: number, cols: number, intent?: "claim" | "update") => {
      state.resizeCalls.push({ terminalId, rows, cols, intent });
    },
    onStreamEvent: (handler: (event: TerminalStreamEvent) => void) => {
      streamListeners.push(handler);
      return () => {
        const index = streamListeners.indexOf(handler);
        if (index >= 0) streamListeners.splice(index, 1);
      };
    },
    onRemoteExit: (handler: (terminalId: string) => void) => {
      remoteExitListeners.push(handler);
      return () => {
        const index = remoteExitListeners.indexOf(handler);
        if (index >= 0) remoteExitListeners.splice(index, 1);
      };
    },
    emit: (event: TerminalStreamEvent) => {
      for (const listener of streamListeners.slice()) listener(event);
    },
    emitRemoteExit: (terminalId: string) => {
      for (const listener of remoteExitListeners.slice()) listener(terminalId);
    },
  };
  return state;
}

describe("TerminalSessionRegistry", () => {
  test("open() resolves a handle whose output/snapshot/restore listeners actually receive routed events", async () => {
    const host = createFakeHost();
    const registry = new TerminalSessionRegistry(host);

    const handle = await registry.open("term-1");
    expect(handle.terminalId).toBe("term-1");
    expect(handle.state).toBe("open");

    const outputs: string[] = [];
    handle.onOutput((data) => outputs.push(new TextDecoder().decode(data)));
    host.emit({ terminalId: "term-1", type: "output", data: new TextEncoder().encode("hi") });
    expect(outputs).toEqual(["hi"]);

    const snapshots: unknown[] = [];
    handle.onSnapshot((state) => snapshots.push(state));
    const state = { rows: 1, cols: 1, grid: [], scrollback: [], cursor: { row: 0, col: 0 } };
    host.emit({ terminalId: "term-1", type: "snapshot", state: state as never });
    expect(snapshots).toEqual([state]);

    const restores: string[] = [];
    handle.onRestore((data) => restores.push(new TextDecoder().decode(data)));
    host.emit({ terminalId: "term-1", type: "restore", data: new TextEncoder().encode("r") });
    expect(restores).toEqual(["r"]);

    // A different terminal's events never reach this handle.
    host.emit({ terminalId: "term-2", type: "output", data: new TextEncoder().encode("nope") });
    expect(outputs).toEqual(["hi"]);
  });

  test("two opens for the same terminal id — sequential — return the same handle and subscribe exactly once", async () => {
    const host = createFakeHost();
    const registry = new TerminalSessionRegistry(host);

    const first = await registry.open("term-1");
    const second = await registry.open("term-1");

    expect(second).toBe(first);
    expect(host.subscribeCalls).toEqual(["term-1"]);
  });

  test("two opens for the same terminal id — concurrent, before the first resolves — collapse into one subscribe call", async () => {
    const host = createFakeHost();
    const registry = new TerminalSessionRegistry(host);

    const [first, second] = await Promise.all([registry.open("term-1"), registry.open("term-1")]);

    expect(second).toBe(first);
    expect(host.subscribeCalls).toEqual(["term-1"]);
  });

  test("a write while not connected is dropped, not queued: outcome is dropped-not-connected and nothing reaches the host", async () => {
    const host = createFakeHost();
    const registry = new TerminalSessionRegistry(host);
    const handle = await registry.open("term-1");

    host.connected = false;
    const outcome = handle.writeInput(new Uint8Array([1, 2, 3]));

    expect(outcome).toBe("dropped-not-connected");
    expect(host.inputCalls).toEqual([]);
  });

  test("a resize while not connected is dropped the same way", async () => {
    const host = createFakeHost();
    const registry = new TerminalSessionRegistry(host);
    const handle = await registry.open("term-1");

    host.connected = false;
    const outcome = handle.resize(24, 80, "update");

    expect(outcome).toBe("dropped-not-connected");
    expect(host.resizeCalls).toEqual([]);
  });

  test("a write after close is dropped-closed and never reaches the host", async () => {
    const host = createFakeHost();
    const registry = new TerminalSessionRegistry(host);
    const handle = await registry.open("term-1");

    handle.close();
    const outcome = handle.writeInput("echo hi\r");

    expect(outcome).toBe("dropped-closed");
    expect(host.inputCalls).toEqual([]);
    expect(handle.state).toBe("closed");
  });

  test("a connected, open write is sent and reaches the host with the exact bytes", async () => {
    const host = createFakeHost();
    const registry = new TerminalSessionRegistry(host);
    const handle = await registry.open("term-1");

    const bytes = new Uint8Array([0x1b, 0x5b, 0x41]);
    const outcome = handle.writeInput(bytes);

    expect(outcome).toBe("sent");
    expect(host.inputCalls).toEqual([{ terminalId: "term-1", data: bytes }]);
  });

  test("a close arriving twice is idempotent: one unsubscribe call, onClosed fires once", async () => {
    const host = createFakeHost();
    const registry = new TerminalSessionRegistry(host);
    const handle = await registry.open("term-1");

    const closedHandler = vi.fn();
    handle.onClosed(closedHandler);

    handle.close();
    handle.close();
    handle.close();

    expect(host.unsubscribeCalls).toEqual(["term-1"]);
    expect(closedHandler).toHaveBeenCalledTimes(1);
    expect(handle.state).toBe("closed");
  });

  test("a frame arriving after the terminal was closed locally never reaches the closed handle's listeners", async () => {
    const host = createFakeHost();
    const registry = new TerminalSessionRegistry(host);
    const handle = await registry.open("term-1");

    const outputs: Uint8Array[] = [];
    handle.onOutput((data) => outputs.push(data));
    handle.close();

    // The daemon hasn't caught up yet and the transport still delivers
    // one more frame for the now-locally-closed terminal.
    expect(() =>
      host.emit({ terminalId: "term-1", type: "output", data: new TextEncoder().encode("late") }),
    ).not.toThrow();
    expect(outputs).toEqual([]);
  });

  test("opening the same terminal id again after close issues a fresh subscribe and yields a new handle", async () => {
    const host = createFakeHost();
    const registry = new TerminalSessionRegistry(host);
    const first = await registry.open("term-1");
    first.close();

    const second = await registry.open("term-1");

    expect(second).not.toBe(first);
    expect(host.subscribeCalls).toEqual(["term-1", "term-1"]);
  });

  test("a daemon-reported exit closes the session locally without a redundant unsubscribe RPC", async () => {
    const host = createFakeHost();
    const registry = new TerminalSessionRegistry(host);
    const handle = await registry.open("term-1");
    const closedHandler = vi.fn();
    handle.onClosed(closedHandler);

    host.emitRemoteExit("term-1");

    expect(handle.state).toBe("closed");
    expect(closedHandler).toHaveBeenCalledTimes(1);
    expect(host.unsubscribeCalls).toEqual([]);
    expect(handle.writeInput("too late")).toBe("dropped-closed");
  });

  test("a daemon-reported exit for an unopened or already-closed terminal id is a silent no-op, not an exception", async () => {
    const host = createFakeHost();
    const registry = new TerminalSessionRegistry(host);
    const handle = await registry.open("term-1");
    handle.close();
    host.unsubscribeCalls.length = 0;

    expect(() => host.emitRemoteExit("term-1")).not.toThrow();
    expect(() => host.emitRemoteExit("term-never-opened")).not.toThrow();
    expect(host.unsubscribeCalls).toEqual([]);
  });

  test("a subscribe error rejects open() and registers no session", async () => {
    const host = createFakeHost();
    host.subscribeError = "terminal not found";
    const registry = new TerminalSessionRegistry(host);

    await expect(registry.open("term-missing")).rejects.toThrow(/terminal not found/);

    // A retry after the failure issues a fresh subscribe rather than reusing a dead entry.
    host.subscribeError = null;
    const handle = await registry.open("term-missing");
    expect(handle.state).toBe("open");
    expect(host.subscribeCalls).toEqual(["term-missing", "term-missing"]);
  });
});
