/**
 * `TerminalController` — plan.md §8.4/§12.4/§14.5, T30A1.
 *
 * DOM-agnostic wrapper around one terminal's binary stream
 * (`packages/protocol/src/binary-frames/terminal.ts`,
 * `packages/client/src/terminal-stream-router.ts`). Owns:
 *
 * - the subscribe/unsubscribe lifecycle for one `terminalId`;
 * - decoding the three wire event kinds the daemon can send once
 *   subscribed (`output`, `restore`, `snapshot`);
 * - client-side backpressure accounting for the two byte-stream kinds
 *   (`output`, `restore`) via `TerminalOutputBuffer` — this package's
 *   mirror of the daemon's existing 4 MiB soft / 8 MiB hard buffered-
 *   bytes invariant (plan.md §14.5), so a renderer (xterm.js on web, a
 *   WebView on Android) that falls behind never grows this
 *   controller's queue without bound. A hard-cap breach drops the
 *   stale backlog and automatically requests a fresh full-snapshot
 *   resync instead of risking corrupted output;
 * - forwarding keystrokes/pasted text and resize requests to the
 *   daemon over the same binary channel.
 *
 * Resize *ownership* (the claim/update rule that decides which of
 * several viewers of the same terminal actually sizes the PTY) is
 * deliberately NOT here — see T30A3 ("Honour terminal resize ownership
 * and latency"). `resize()` below is a plain pass-through so T30A3 can
 * layer that policy on top without this controller getting in the way.
 *
 * `apps/web`'s `features/terminal` (T30A2) mounts this on an in-page
 * xterm.js instance; nothing here imports React, DOM, or xterm, so the
 * same controller is reusable from `apps/android`'s terminal WebView
 * wrapper (T35B) unchanged.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */
import type { TerminalStreamEvent } from "@picompanion/client/internal/daemon-client";
import type {
  SubscribeTerminalRequest,
  TerminalInput,
  TerminalState,
} from "@picompanion/protocol/messages";
import {
  TERMINAL_OUTPUT_HARD_BUFFER_BYTES,
  TERMINAL_OUTPUT_SOFT_BUFFER_BYTES,
  TerminalOutputBuffer,
  type TerminalOutputBufferEvent,
  type TerminalOutputSink,
} from "./terminal-output-buffer.js";

export { TERMINAL_OUTPUT_HARD_BUFFER_BYTES, TERMINAL_OUTPUT_SOFT_BUFFER_BYTES };
export type { TerminalOutputSink };

/** The restore mode/size requested on `subscribe()` (plan.md §12.4). */
export type TerminalRestoreOptions = NonNullable<SubscribeTerminalRequest["restore"]>;

/** The subset of `SubscribeTerminalResponse["payload"]` this controller reads. */
export interface TerminalSubscribeOutcome {
  readonly terminalId: string;
  readonly slot?: number;
  readonly error: string | null;
}

/**
 * The narrow slice of `@picompanion/client`'s `DaemonClient` this
 * controller depends on. A real `DaemonClient` instance satisfies this
 * as-is (structural typing, matching the `DaemonClientLike` pattern in
 * `connection/daemon-client-lifecycle.ts`); tests inject a fake.
 */
export interface TerminalRpcClient {
  subscribeTerminal(
    terminalId: string,
    options?: { restore?: TerminalRestoreOptions; requestId?: string },
  ): Promise<TerminalSubscribeOutcome>;
  unsubscribeTerminal(terminalId: string): void;
  sendTerminalInput(terminalId: string, message: TerminalInput["message"]): void;
  onTerminalStreamEvent(handler: (event: TerminalStreamEvent) => void): () => void;
}

export type TerminalControllerStatus =
  | "idle"
  | "subscribing"
  | "subscribed"
  | "error"
  | "unsubscribed"
  | "disposed";

export type TerminalControllerEvent =
  /** A full structured grid/cursor snapshot (wire `snapshot` opcode). */
  | { readonly type: "state"; readonly state: TerminalState }
  /** Client-side output backpressure status changed (plan.md §14.5). */
  | { readonly type: "congestion"; readonly congested: boolean; readonly bufferedBytes: number }
  /** The hard buffer cap was breached; a full-snapshot resync was requested automatically. */
  | { readonly type: "overflow"; readonly droppedBytes: number }
  /** The automatic post-overflow resync itself failed. */
  | { readonly type: "resync-failed"; readonly error: string };

export type TerminalControllerEventListener = (event: TerminalControllerEvent) => void;
export type TerminalControllerStatusListener = (status: TerminalControllerStatus) => void;

export interface TerminalControllerOptions {
  readonly client: TerminalRpcClient;
  readonly terminalId: string;
  /** Where decoded output/restore bytes are written; see `TerminalOutputBuffer`. */
  readonly sink: TerminalOutputSink;
  /**
   * Restore mode requested on `subscribe()` (plan.md §12.4). Defaults
   * to a bounded `visible-snapshot` restore so a first subscribe never
   * asks the daemon for unbounded scrollback.
   */
  readonly restore?: TerminalRestoreOptions;
  /** Forwarded to `TerminalOutputBuffer`. Defaults to `TERMINAL_OUTPUT_SOFT_BUFFER_BYTES`. */
  readonly softBufferBytes?: number;
  /** Forwarded to `TerminalOutputBuffer`. Defaults to `TERMINAL_OUTPUT_HARD_BUFFER_BYTES`. */
  readonly hardBufferBytes?: number;
}

const DEFAULT_RESTORE: TerminalRestoreOptions = { mode: "visible-snapshot" };

/**
 * Owns one terminal's subscribe/unsubscribe lifecycle, stream
 * decoding, and output backpressure. Construct one per mounted
 * terminal view; `dispose()` when it unmounts or the route navigates
 * away.
 */
export class TerminalController {
  private readonly client: TerminalRpcClient;
  private readonly terminalId: string;
  private readonly restoreOptions: TerminalRestoreOptions;
  private readonly buffer: TerminalOutputBuffer;

  private status: TerminalControllerStatus = "idle";
  private error: string | null = null;
  private disposed = false;
  private unsubscribeStream: (() => void) | null = null;
  private readonly unsubscribeBuffer: () => void;

  private readonly eventListeners = new Set<TerminalControllerEventListener>();
  private readonly statusListeners = new Set<TerminalControllerStatusListener>();

  constructor(options: TerminalControllerOptions) {
    this.client = options.client;
    this.terminalId = options.terminalId;
    this.restoreOptions = options.restore ?? DEFAULT_RESTORE;
    this.buffer = new TerminalOutputBuffer({
      sink: options.sink,
      softBufferBytes: options.softBufferBytes,
      hardBufferBytes: options.hardBufferBytes,
    });
    this.unsubscribeBuffer = this.buffer.onEvent((event) => this.handleBufferEvent(event));
  }

  getStatus(): TerminalControllerStatus {
    return this.status;
  }

  getError(): string | null {
    return this.error;
  }

  /** Bytes queued client-side awaiting the sink; see `TerminalOutputBuffer`. */
  get bufferedBytes(): number {
    return this.buffer.bufferedBytes;
  }

  get isCongested(): boolean {
    return this.buffer.isCongested;
  }

  /** Number of automatic hard-cap overflow recoveries triggered so far. */
  get overflowCount(): number {
    return this.buffer.overflowCount;
  }

  onEvent(listener: TerminalControllerEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  onStatus(listener: TerminalControllerStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Subscribes to the daemon's terminal stream. Safe to call more than
   * once (e.g. to retry after `"error"`); each call sends a fresh
   * `subscribe_terminal_request`.
   */
  async subscribe(
    options: { requestId?: string; restore?: TerminalRestoreOptions } = {},
  ): Promise<TerminalSubscribeOutcome> {
    if (this.disposed) {
      throw new Error("TerminalController is disposed");
    }
    if (!this.unsubscribeStream) {
      this.unsubscribeStream = this.client.onTerminalStreamEvent((event) =>
        this.handleStreamEvent(event),
      );
    }
    this.setStatus("subscribing");
    const outcome = await this.client.subscribeTerminal(this.terminalId, {
      restore: options.restore ?? this.restoreOptions,
      requestId: options.requestId,
    });
    if (this.disposed) {
      return outcome;
    }
    if (outcome.error) {
      this.error = outcome.error;
      this.setStatus("error");
    } else {
      this.error = null;
      this.setStatus("subscribed");
    }
    return outcome;
  }

  /** Sends keystrokes/pasted text. A no-op once disposed. */
  write(data: string): void {
    if (this.disposed) {
      return;
    }
    this.client.sendTerminalInput(this.terminalId, { type: "input", data });
  }

  /**
   * Plain pass-through resize request: no ownership/claim tracking or
   * debouncing here — see the module doc and T30A3.
   */
  resize(rows: number, cols: number, intent?: "claim" | "update"): void {
    if (this.disposed) {
      return;
    }
    this.client.sendTerminalInput(this.terminalId, {
      type: "resize",
      rows,
      cols,
      ...(intent ? { intent } : {}),
    });
  }

  /** Unsubscribes from the daemon stream. The controller can `subscribe()` again afterwards. */
  unsubscribe(): void {
    if (this.disposed || this.status === "unsubscribed" || this.status === "idle") {
      return;
    }
    this.client.unsubscribeTerminal(this.terminalId);
    this.unsubscribeStream?.();
    this.unsubscribeStream = null;
    this.setStatus("unsubscribed");
  }

  /** Unsubscribes (if needed) and releases every listener. Terminal — do not reuse after this. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    if (this.status === "subscribed" || this.status === "subscribing") {
      this.client.unsubscribeTerminal(this.terminalId);
    }
    this.unsubscribeStream?.();
    this.unsubscribeStream = null;
    this.unsubscribeBuffer();
    this.buffer.dispose();
    this.disposed = true;
    this.status = "disposed";
    this.eventListeners.clear();
    this.statusListeners.clear();
  }

  private handleStreamEvent(event: TerminalStreamEvent): void {
    if (this.disposed || event.terminalId !== this.terminalId) {
      return;
    }
    if (event.type === "output") {
      this.buffer.enqueueOutput(event.data);
      return;
    }
    if (event.type === "restore") {
      this.buffer.enqueueReset(event.data);
      return;
    }
    this.emit({ type: "state", state: event.state });
  }

  private handleBufferEvent(event: TerminalOutputBufferEvent): void {
    if (event.type === "congestion") {
      this.emit({
        type: "congestion",
        congested: event.congested,
        bufferedBytes: event.bufferedBytes,
      });
      return;
    }
    this.emit({ type: "overflow", droppedBytes: event.droppedBytes });
    this.requestResync();
  }

  /** Called automatically after a hard-cap overflow; asks the daemon for a fresh full-grid snapshot. */
  private requestResync(): void {
    if (this.disposed || this.status !== "subscribed") {
      return;
    }
    this.client
      .subscribeTerminal(this.terminalId, { restore: { mode: "full-snapshot" } })
      .then((outcome) => {
        if (this.disposed || !outcome.error) {
          return;
        }
        this.error = outcome.error;
        this.emit({ type: "resync-failed", error: outcome.error });
      })
      .catch((cause: unknown) => {
        if (this.disposed) {
          return;
        }
        const message = cause instanceof Error ? cause.message : String(cause);
        this.emit({ type: "resync-failed", error: message });
      });
  }

  private emit(event: TerminalControllerEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // A listener must never break the controller.
      }
    }
  }

  private setStatus(status: TerminalControllerStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // A listener must never break the controller.
      }
    }
  }
}
