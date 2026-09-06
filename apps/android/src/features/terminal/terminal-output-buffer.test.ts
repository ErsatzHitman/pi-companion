import type { TerminalState } from "@picompanion/protocol/messages";
import { describe, expect, it, vi } from "vitest";

import {
  TERMINAL_OUTPUT_BUFFER_HARD_BYTES,
  TERMINAL_OUTPUT_BUFFER_SOFT_BYTES,
  TerminalOutputBuffer,
} from "./terminal-output-buffer";

const STATE: TerminalState = {
  rows: 24,
  cols: 80,
  grid: [[{ char: "$" }]],
  scrollback: [],
  cursor: { row: 0, col: 1 },
};

describe("TerminalOutputBuffer — ordering and draining", () => {
  it("drains queued frames in the exact order they were queued", () => {
    const buffer = new TerminalOutputBuffer();
    buffer.enqueueOutput(new Uint8Array([1]));
    buffer.enqueueOutput(new Uint8Array([2]));
    buffer.enqueueOutput(new Uint8Array([3]));

    const frames = buffer.drain();
    expect(frames.map((f) => (f.kind === "output" ? [...f.bytes] : null))).toEqual([[1], [2], [3]]);
    expect(buffer.length).toBe(0);
    expect(buffer.bufferedBytes).toBe(0);
  });

  it("ignores a zero-length Output payload rather than queuing an empty chunk", () => {
    const buffer = new TerminalOutputBuffer();
    buffer.enqueueOutput(new Uint8Array(0));
    expect(buffer.length).toBe(0);
  });

  it("a Snapshot supersedes everything queued before it", () => {
    const buffer = new TerminalOutputBuffer();
    buffer.enqueueOutput(new Uint8Array(1024));
    buffer.enqueueOutput(new Uint8Array(1024));
    buffer.enqueueSnapshot(STATE);

    const frames = buffer.drain();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ kind: "snapshot", state: STATE });
  });

  it("a Restore catch-up frame supersedes everything queued before it", () => {
    const buffer = new TerminalOutputBuffer();
    buffer.enqueueOutput(new Uint8Array([9, 9]));
    buffer.enqueueRestore(new Uint8Array([1, 2, 3]));

    const frames = buffer.drain();
    expect(frames).toEqual([{ kind: "restore", bytes: new Uint8Array([1, 2, 3]) }]);
  });

  it("reports past the soft limit once queued bytes cross it, before anything is dropped", () => {
    const buffer = new TerminalOutputBuffer();
    expect(buffer.isPastSoftLimit).toBe(false);
    buffer.enqueueOutput(new Uint8Array(TERMINAL_OUTPUT_BUFFER_SOFT_BYTES + 1));
    expect(buffer.isPastSoftLimit).toBe(true);
    expect(buffer.droppedByteCount).toBe(0);
  });
});

describe("TerminalOutputBuffer — flood: bounded growth, stated drop policy, no blocking", () => {
  it("never lets buffered bytes exceed the stated hard cap, no matter how much is flooded in", () => {
    const buffer = new TerminalOutputBuffer();
    const CHUNK_BYTES = 64 * 1024; // one coalesced daemon flush's worth, per MAX_TERMINAL_OUTPUT_FRAME_BYTES's order of magnitude
    const FLOOD_CHUNKS = 400; // 400 * 64 KiB = 25 MiB — over 3x the 8 MiB hard cap
    const chunk = new Uint8Array(CHUNK_BYTES).fill(7);

    for (let i = 0; i < FLOOD_CHUNKS; i += 1) {
      buffer.enqueueOutput(chunk);
      // Assert the invariant on every single push, not just at the end —
      // proves the cap is never transiently exceeded either.
      expect(buffer.bufferedBytes).toBeLessThanOrEqual(TERMINAL_OUTPUT_BUFFER_HARD_BYTES);
    }

    expect(buffer.bufferedBytes).toBeLessThanOrEqual(TERMINAL_OUTPUT_BUFFER_HARD_BYTES);
    const totalPushed = CHUNK_BYTES * FLOOD_CHUNKS;
    expect(buffer.droppedByteCount).toBe(totalPushed - buffer.bufferedBytes);
    expect(buffer.droppedByteCount).toBeGreaterThan(0);
  });

  it("drops the OLDEST bytes first, keeping the most recently produced output — the stated FIFO policy", () => {
    const buffer = new TerminalOutputBuffer();
    const CHUNK_BYTES = 1024 * 1024; // 1 MiB per chunk
    // Push chunks tagged 0..9 (10 MiB total) — well past the 8 MiB cap.
    for (let tag = 0; tag < 10; tag += 1) {
      const chunk = new Uint8Array(CHUNK_BYTES).fill(tag);
      buffer.enqueueOutput(chunk);
    }

    const frames = buffer.drain();
    const tagsKept = frames.map((f) => (f.kind === "output" ? f.bytes[0] : -1));
    // The oldest (lowest-numbered) chunks must be the ones gone; the tail is retained, in order.
    expect(tagsKept).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("never drops a queued catch-up frame to make room, even under a flood that arrives after it", () => {
    const buffer = new TerminalOutputBuffer();
    buffer.enqueueSnapshot(STATE);
    const chunk = new Uint8Array(1024 * 1024).fill(1); // 1 MiB
    for (let i = 0; i < 20; i += 1) {
      // 20 MiB of Output queued AFTER the snapshot — none of it may evict the snapshot.
      buffer.enqueueOutput(chunk);
    }

    const frames = buffer.drain();
    expect(frames[0]).toEqual({ kind: "snapshot", state: STATE });
    expect(buffer.droppedByteCount).toBeGreaterThan(0);
  });

  it("enqueue is a plain synchronous call — no Promise, no timer — so a flood can never block the reader", () => {
    const buffer = new TerminalOutputBuffer();
    // 64 KiB x 200 = 12.8 MiB: still a flood in BYTES (it crosses both the
    // 4 MiB soft cap and the 8 MiB hard cap, so the eviction path is
    // exercised), but 200 synchronous calls instead of 50,000. The old
    // 50,000 x 1 KiB loop is what made this test fail vitest's 5s default
    // timeout under whole-suite parallel load — the third shape of the same
    // flake (wall-clock assertion, then a bare timeout). Iteration COUNT was
    // never what this test is about.
    const chunk = new Uint8Array(64 * 1024);

    // Structural proof, not a wall-clock one: spy on every scheduling
    // primitive enqueueOutput could reach for to defer its real work.
    // An implementation that deferred the push (e.g. behind a `setTimeout`
    // or a `queueMicrotask`) could still return `undefined` synchronously
    // below, so the return-value check alone cannot catch it — these spies
    // close that gap.
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const queueMicrotaskSpy = vi.spyOn(globalThis, "queueMicrotask");

    try {
      // Collect, then assert once. Calling `expect` once per iteration inside
      // the loop is what made this test fail the 5s default timeout under
      // whole-suite parallel load — twice, in two different shapes: first
      // as a wall-clock assertion (P5-W19/W20), then as a bare timeout
      // after T71 replaced that assertion but kept the loop (P5-W22). The
      // claim under test is about `enqueueOutput`, not about how fast
      // vitest's matcher runs, so the matcher belongs outside the loop.
      // enqueueOutput's declared return type is void. A Promise or any
      // other thenable here would mean the call scheduled work for later
      // instead of doing it now.
      let nonUndefinedResults = 0;
      for (let i = 0; i < 200; i += 1) {
        const result = buffer.enqueueOutput(chunk);
        if (result !== undefined) nonUndefinedResults += 1;
      }
      expect(nonUndefinedResults).toBe(0);

      // No timer and no microtask was ever reached for across every call.
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(queueMicrotaskSpy).not.toHaveBeenCalled();

      // The effect itself is visible before this synchronous test function
      // ever returns control to anything — no await, no fake-timer advance,
      // and no flushed microtask queue was needed for these frames to
      // already be queued and drainable right now.
      const frames = buffer.drain();
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.every((frame) => frame.kind === "output")).toBe(true);
    } finally {
      setTimeoutSpy.mockRestore();
      setIntervalSpy.mockRestore();
      queueMicrotaskSpy.mockRestore();
    }
  });
});

describe("TerminalOutputBuffer — clear", () => {
  it("clear discards everything queued without returning it", () => {
    const buffer = new TerminalOutputBuffer();
    buffer.enqueueOutput(new Uint8Array([1, 2, 3]));
    buffer.clear();
    expect(buffer.length).toBe(0);
    expect(buffer.bufferedBytes).toBe(0);
    expect(buffer.drain()).toEqual([]);
  });
});
