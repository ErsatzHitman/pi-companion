import { describe, expect, it, vi } from "vitest";
import {
  TERMINAL_OUTPUT_HARD_BUFFER_BYTES,
  TERMINAL_OUTPUT_SOFT_BUFFER_BYTES,
  TerminalOutputBuffer,
  type TerminalOutputBufferEvent,
} from "./terminal-output-buffer.js";

function bytes(length: number, fill = 1): Uint8Array {
  return new Uint8Array(length).fill(fill);
}

/** A sink whose `write`/`reset` calls stay pending until the test resolves them. */
function createStallingSink() {
  const writes: Uint8Array[] = [];
  const resets: Uint8Array[] = [];
  const pending: Array<() => void> = [];
  return {
    writes,
    resets,
    write: vi.fn((data: Uint8Array) => {
      writes.push(data);
      return new Promise<void>((resolve) => {
        pending.push(resolve);
      });
    }),
    reset: vi.fn((data: Uint8Array) => {
      resets.push(data);
      return new Promise<void>((resolve) => {
        pending.push(resolve);
      });
    }),
    resolveNext(): void {
      const resolve = pending.shift();
      resolve?.();
    },
    pendingCount(): number {
      return pending.length;
    },
  };
}

describe("TerminalOutputBuffer", () => {
  it("defaults to the daemon's documented soft/hard byte caps", () => {
    expect(TERMINAL_OUTPUT_SOFT_BUFFER_BYTES).toBe(4 * 1024 * 1024);
    expect(TERMINAL_OUTPUT_HARD_BUFFER_BYTES).toBe(8 * 1024 * 1024);
  });

  it("round-trips output chunks to the sink in order when the sink keeps up", async () => {
    const written: Uint8Array[] = [];
    let resolveDone: (() => void) | undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const buffer = new TerminalOutputBuffer({
      sink: {
        write(data) {
          written.push(data);
          if (written.length === 3) {
            resolveDone?.();
          }
        },
        reset() {},
      },
    });

    buffer.enqueueOutput(bytes(3, 1));
    buffer.enqueueOutput(bytes(3, 2));
    buffer.enqueueOutput(bytes(3, 3));

    await done;
    expect(written.map((chunk) => chunk[0])).toEqual([1, 2, 3]);
  });

  it("routes restore chunks through sink.reset, not sink.write", async () => {
    const sink = createStallingSink();
    const buffer = new TerminalOutputBuffer({ sink });
    buffer.enqueueReset(bytes(4));
    expect(sink.reset).toHaveBeenCalledTimes(1);
    expect(sink.write).not.toHaveBeenCalled();
    sink.resolveNext();
    await Promise.resolve();
  });

  it("flood fixture: buffered bytes never exceed the hard cap while the sink stalls", () => {
    const sink = createStallingSink();
    const softBufferBytes = 1_000;
    const hardBufferBytes = 2_000;
    const buffer = new TerminalOutputBuffer({ sink, softBufferBytes, hardBufferBytes });

    // The first chunk is handed straight to the (stalled) sink and is no
    // longer "buffered" — everything after this queues up behind it.
    buffer.enqueueOutput(bytes(10));
    expect(buffer.bufferedBytes).toBe(0);

    // Flood: far more than the hard cap, in small chunks, while the sink
    // never drains. bufferedBytes must be bounded at every step.
    for (let i = 0; i < 500; i += 1) {
      buffer.enqueueOutput(bytes(50));
      expect(buffer.bufferedBytes).toBeLessThanOrEqual(hardBufferBytes);
    }

    expect(buffer.overflowCount).toBeGreaterThan(0);
  });

  it("signals congestion at the soft cap and overflow (with recovery) at the hard cap", () => {
    const sink = createStallingSink();
    const events: TerminalOutputBufferEvent[] = [];
    const buffer = new TerminalOutputBuffer({ sink, softBufferBytes: 100, hardBufferBytes: 200 });
    buffer.onEvent((event) => events.push(event));

    buffer.enqueueOutput(bytes(10)); // in-flight, not buffered
    buffer.enqueueOutput(bytes(80)); // 80 buffered, under soft cap
    expect(buffer.isCongested).toBe(false);

    buffer.enqueueOutput(bytes(30)); // 110 buffered, over soft cap
    expect(buffer.isCongested).toBe(true);
    expect(events).toContainEqual({ type: "congestion", congested: true, bufferedBytes: 110 });

    buffer.enqueueOutput(bytes(150)); // 260 buffered, over hard cap -> overflow, cleared
    expect(buffer.bufferedBytes).toBe(0);
    expect(buffer.isCongested).toBe(false);
    expect(buffer.overflowCount).toBe(1);
    expect(events).toContainEqual({ type: "overflow", droppedBytes: 260 });
    // congestion is explicitly cleared as part of the same overflow.
    expect(events).toContainEqual({ type: "congestion", congested: false, bufferedBytes: 0 });
  });

  it("drains back toward zero once the sink resolves each in-flight write", async () => {
    const sink = createStallingSink();
    const buffer = new TerminalOutputBuffer({ sink, softBufferBytes: 100, hardBufferBytes: 1_000 });

    buffer.enqueueOutput(bytes(20)); // in flight
    buffer.enqueueOutput(bytes(20)); // queued
    buffer.enqueueOutput(bytes(20)); // queued
    expect(buffer.bufferedBytes).toBe(40);
    expect(sink.pendingCount()).toBe(1);

    sink.resolveNext();
    await Promise.resolve();
    await Promise.resolve();
    expect(buffer.bufferedBytes).toBe(20);
    expect(sink.pendingCount()).toBe(1);

    sink.resolveNext();
    await Promise.resolve();
    await Promise.resolve();
    expect(buffer.bufferedBytes).toBe(0);
    expect(sink.pendingCount()).toBe(1);

    sink.resolveNext();
    await Promise.resolve();
    await Promise.resolve();
    expect(buffer.bufferedBytes).toBe(0);
    expect(sink.pendingCount()).toBe(0);
  });

  it("ignores zero-length chunks and stops accepting work once disposed", () => {
    const sink = createStallingSink();
    const buffer = new TerminalOutputBuffer({ sink });
    buffer.enqueueOutput(new Uint8Array(0));
    expect(sink.write).not.toHaveBeenCalled();

    buffer.dispose();
    buffer.enqueueOutput(bytes(10));
    expect(buffer.bufferedBytes).toBe(0);
    expect(sink.write).not.toHaveBeenCalled();
  });

  it("rejects a hard cap smaller than the soft cap", () => {
    expect(
      () =>
        new TerminalOutputBuffer({
          sink: { write: () => {}, reset: () => {} },
          softBufferBytes: 200,
          hardBufferBytes: 100,
        }),
    ).toThrow(/hardBufferBytes/);
  });
});
