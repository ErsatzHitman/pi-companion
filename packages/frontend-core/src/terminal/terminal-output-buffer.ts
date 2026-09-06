/**
 * Client-side terminal output backpressure buffer — plan.md §14.5, T30A1.
 *
 * The daemon already enforces a 4 MiB soft / 8 MiB hard buffered-bytes
 * invariant for terminal output queued *for* a client that is not
 * draining fast enough
 * (`packages/server/src/terminal/terminal-restore.ts`'s
 * `MAX_CLIENT_BUFFERED_BYTES`). This module is this package's mirror of
 * that invariant on the receiving side: once bytes have arrived over
 * the binary channel (`packages/protocol/src/binary-frames/terminal.ts`,
 * `packages/client/src/terminal-stream-router.ts`), a slow renderer (a
 * backgrounded tab, a throttled xterm.js write queue, a paused native
 * WebView) must never let this package's own queue grow without bound
 * while it waits for the sink to drain.
 *
 * `TerminalOutputBuffer` enqueues arrived chunks and drains them to an
 * injected `TerminalOutputSink` one at a time, waiting for the sink to
 * finish each chunk before handing it the next chunk (mirrors
 * xterm.js's own `write(data, callback)` backpressure contract, without
 * depending on xterm). While a chunk is in flight, further arrivals
 * accumulate in the queue:
 *
 * - past `softBufferBytes` the buffer reports itself congested (a
 *   status signal only, queueing continues);
 * - past `hardBufferBytes` it drops every chunk still queued (not the
 *   one already handed to the sink) and reports an overflow, because
 *   replaying a byte stream with an arbitrary gap in the middle would
 *   corrupt terminal rendering. The caller (`TerminalController`)
 *   reacts to an overflow by requesting a fresh resync rather than by
 *   growing this queue further.
 */

/** Mirrors the daemon's `MAX_CLIENT_BUFFERED_BYTES` (plan.md §14.5). */
export const TERMINAL_OUTPUT_SOFT_BUFFER_BYTES = 4 * 1024 * 1024;

/** Mirrors the daemon's hard backpressure ceiling (plan.md §14.5). */
export const TERMINAL_OUTPUT_HARD_BUFFER_BYTES = 8 * 1024 * 1024;

export interface TerminalOutputSink {
  /** Incremental output: append `data` at the current cursor. */
  write(data: Uint8Array): void | Promise<void>;
  /** Full replace: the caller should clear/reset the screen, then render `data`. */
  reset(data: Uint8Array): void | Promise<void>;
}

export interface TerminalOutputChunk {
  readonly kind: "output" | "reset";
  readonly data: Uint8Array;
}

export type TerminalOutputBufferEvent =
  | { readonly type: "congestion"; readonly congested: boolean; readonly bufferedBytes: number }
  | { readonly type: "overflow"; readonly droppedBytes: number };

export type TerminalOutputBufferEventListener = (event: TerminalOutputBufferEvent) => void;

export interface TerminalOutputBufferOptions {
  readonly sink: TerminalOutputSink;
  /** Defaults to `TERMINAL_OUTPUT_SOFT_BUFFER_BYTES`. */
  readonly softBufferBytes?: number;
  /** Defaults to `TERMINAL_OUTPUT_HARD_BUFFER_BYTES`. */
  readonly hardBufferBytes?: number;
}

/**
 * Bounded FIFO byte queue between the binary terminal channel and a
 * rendering sink. See module docs above.
 */
export class TerminalOutputBuffer {
  private readonly sink: TerminalOutputSink;
  private readonly softBufferBytes: number;
  private readonly hardBufferBytes: number;

  private readonly queue: TerminalOutputChunk[] = [];
  private queuedBytes = 0;
  private draining = false;
  private congested = false;
  private overflows = 0;
  private disposed = false;

  private readonly listeners = new Set<TerminalOutputBufferEventListener>();

  constructor(options: TerminalOutputBufferOptions) {
    this.sink = options.sink;
    this.softBufferBytes = options.softBufferBytes ?? TERMINAL_OUTPUT_SOFT_BUFFER_BYTES;
    this.hardBufferBytes = options.hardBufferBytes ?? TERMINAL_OUTPUT_HARD_BUFFER_BYTES;
    if (this.hardBufferBytes < this.softBufferBytes) {
      throw new Error("TerminalOutputBuffer: hardBufferBytes must be >= softBufferBytes");
    }
  }

  /** Bytes queued but not yet handed to the sink. Never exceeds `hardBufferBytes`. */
  get bufferedBytes(): number {
    return this.queuedBytes;
  }

  get isCongested(): boolean {
    return this.congested;
  }

  /** Number of times the hard cap has been breached and the backlog dropped. */
  get overflowCount(): number {
    return this.overflows;
  }

  onEvent(listener: TerminalOutputBufferEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  enqueueOutput(data: Uint8Array): void {
    this.enqueue({ kind: "output", data });
  }

  enqueueReset(data: Uint8Array): void {
    this.enqueue({ kind: "reset", data });
  }

  /** Clears the queue and every listener. A chunk already handed to the sink still completes. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.listeners.clear();
  }

  private enqueue(chunk: TerminalOutputChunk): void {
    if (this.disposed || chunk.data.byteLength === 0) {
      return;
    }
    this.queue.push(chunk);
    this.queuedBytes += chunk.data.byteLength;
    if (this.queuedBytes > this.hardBufferBytes) {
      this.overflow();
      return;
    }
    this.updateCongestion();
    this.drain();
  }

  private overflow(): void {
    const droppedBytes = this.queuedBytes;
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.overflows += 1;
    if (this.congested) {
      this.congested = false;
      this.emit({ type: "congestion", congested: false, bufferedBytes: 0 });
    }
    this.emit({ type: "overflow", droppedBytes });
  }

  private updateCongestion(): void {
    const congested = this.queuedBytes > this.softBufferBytes;
    if (congested !== this.congested) {
      this.congested = congested;
      this.emit({ type: "congestion", congested, bufferedBytes: this.queuedBytes });
    }
  }

  private drain(): void {
    if (this.draining || this.disposed) {
      return;
    }
    const chunk = this.queue.shift();
    if (!chunk) {
      return;
    }
    this.queuedBytes -= chunk.data.byteLength;
    this.updateCongestion();
    this.draining = true;

    let result: void | Promise<void>;
    try {
      result = chunk.kind === "output" ? this.sink.write(chunk.data) : this.sink.reset(chunk.data);
    } catch {
      result = undefined;
    }

    Promise.resolve(result)
      .catch(() => undefined)
      .finally(() => {
        this.draining = false;
        if (!this.disposed) {
          this.drain();
        }
      });
  }

  private emit(event: TerminalOutputBufferEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A listener must never break the drain loop.
      }
    }
  }
}
