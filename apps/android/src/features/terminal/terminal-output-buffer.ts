import type { TerminalState } from "@picompanion/protocol/messages";

/**
 * Bounded pre-ready terminal frame queue (T35B2, plan.md §14.5 "terminal
 * keeps the existing 4 MiB soft and 8 MiB hard backpressure invariants").
 *
 * `terminal-session-controller.ts` must never call
 * `TerminalWebViewPort.write`/`restore` before `onReady` has fired (see
 * that port's own docstring) — but a daemon can start streaming the
 * instant its binary channel opens, well before an embedded WebView page
 * has finished loading `xterm.js`. This buffer is where those frames
 * live in the meantime: bounded, order-preserving, and drained the
 * moment `isTerminalReady` flips true.
 *
 * **Where the 4 MiB / 8 MiB figures come from, and why they are
 * re-stated here rather than imported:** the daemon's own client-facing
 * backpressure threshold is `MAX_CLIENT_BUFFERED_BYTES` (4 MiB) in
 * `packages/server/src/terminal/terminal-restore.ts` — the point past
 * which the daemon itself gives up on raw `Output` framing for a client
 * that is falling behind and instead sends a fresh catch-up frame
 * (`Snapshot`/`Restore`). `apps/android` cannot import `packages/server`
 * (this repo's cross-workspace policy exports only
 * `@picompanion/frontend-core`, `@picompanion/design-tokens`,
 * `@picompanion/protocol/*`, `@picompanion/highlight`), and no
 * corresponding constant is exported from `packages/protocol` — this
 * file therefore mirrors the *value* as a written requirement (this
 * module's `TERMINAL_OUTPUT_BUFFER_SOFT_BYTES`), not a shared constant.
 * The 8 MiB figure is plan.md §14.5's own stated hard ceiling; nothing
 * server-side enforces it under that name, so on the client it is this
 * buffer's own defensive backstop for a slow-to-ready WebView — belt
 * and suspenders alongside the daemon's backpressure handling, which
 * already keeps a client that *is* draining from ever approaching it.
 *
 * **Stated drop policy**, once queued bytes exceed the hard cap: drop
 * the oldest queued raw `Output`/`Restore` bytes first, one whole chunk
 * at a time, and never drop a queued `Snapshot`/`Restore` catch-up frame
 * — it alone is sufficient to fully re-render the terminal, so losing it
 * would leave nothing to recover from, while losing old raw bytes only
 * costs some scrollback the very next catch-up frame will replace
 * anyway. This mirrors this repo's own established precedent for a
 * hard-capped buffer: `packages/server/src/terminal/terminal.ts`'s
 * `recentOutputChunks` drops whole leading chunks the same way to keep
 * its own cap "hard" (see that file's PTY `onData` handler).
 *
 * A `Snapshot` or `Restore` catch-up frame received while queuing
 * supersedes everything queued ahead of it — those older raw bytes
 * predate the daemon's own authoritative state and would only corrupt
 * the render if replayed on top of it, so they are discarded rather
 * than kept.
 */
export const TERMINAL_OUTPUT_BUFFER_SOFT_BYTES = 4 * 1024 * 1024;
export const TERMINAL_OUTPUT_BUFFER_HARD_BYTES = 8 * 1024 * 1024;

export type TerminalPendingFrame =
  | { readonly kind: "output"; readonly bytes: Uint8Array }
  | { readonly kind: "restore"; readonly bytes: Uint8Array }
  | { readonly kind: "snapshot"; readonly state: TerminalState };

export class TerminalOutputBuffer {
  private queue: TerminalPendingFrame[] = [];
  private queuedBytes = 0;
  private droppedBytes = 0;

  /** Bytes currently queued (a queued catch-up frame itself counts as 0 — see module doc). */
  get bufferedBytes(): number {
    return this.queuedBytes;
  }

  /** Total bytes ever dropped by the hard-cap policy, across this buffer's whole life. Test/observability hook. */
  get droppedByteCount(): number {
    return this.droppedBytes;
  }

  /** Past the daemon's own 4 MiB soft threshold — advisory only; nothing is dropped here yet. */
  get isPastSoftLimit(): boolean {
    return this.queuedBytes > TERMINAL_OUTPUT_BUFFER_SOFT_BYTES;
  }

  get length(): number {
    return this.queue.length;
  }

  /** Queues raw `Output` bytes. Synchronous, non-blocking: an array push plus a bounded trim, never I/O or a timer. */
  enqueueOutput(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) {
      return;
    }
    this.queue.push({ kind: "output", bytes });
    this.queuedBytes += bytes.byteLength;
    this.enforceHardCap();
  }

  /** Queues a `Restore` catch-up frame's raw bytes, superseding anything queued before it. */
  enqueueRestore(bytes: Uint8Array): void {
    this.queue = [{ kind: "restore", bytes }];
    this.queuedBytes = 0;
  }

  /** Queues a decoded `Snapshot` catch-up frame, superseding anything queued before it. */
  enqueueSnapshot(state: TerminalState): void {
    this.queue = [{ kind: "snapshot", state }];
    this.queuedBytes = 0;
  }

  /** Removes and returns every queued frame, in the order it was queued, resetting the buffer to empty. */
  drain(): TerminalPendingFrame[] {
    const frames = this.queue;
    this.queue = [];
    this.queuedBytes = 0;
    return frames;
  }

  /** Discards everything queued without applying it — used when a fresh catch-up frame makes it moot. */
  clear(): void {
    this.queue = [];
    this.queuedBytes = 0;
  }

  private enforceHardCap(): void {
    while (this.queuedBytes > TERMINAL_OUTPUT_BUFFER_HARD_BYTES) {
      const dropIndex = this.queue.length > 0 && this.queue[0].kind !== "output" ? 1 : 0;
      const victim = this.queue[dropIndex];
      if (!victim || victim.kind !== "output") {
        // Nothing left that is safe to drop (only a catch-up frame remains,
        // or a single oversized chunk we apply atomically) — stop rather
        // than ever discard the catch-up frame itself.
        return;
      }
      this.queuedBytes -= victim.bytes.byteLength;
      this.droppedBytes += victim.bytes.byteLength;
      this.queue.splice(dropIndex, 1);
    }
  }
}
