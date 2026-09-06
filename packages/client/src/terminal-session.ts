import type { TerminalState } from "@picompanion/protocol/messages";

import type { TerminalStreamEvent } from "./terminal-stream-router.js";

/**
 * Session-shaped terminal binary API (T62, plan.md's terminal transport
 * gap recorded at the P5-W16 merge gate).
 *
 * `DaemonClient` already carries the wire plumbing this builds on:
 * `subscribeTerminal`/`unsubscribeTerminal` (RPC + slot bookkeeping),
 * `sendTerminalInput` (encodes input/resize into the daemon's binary
 * frame layout and sends it), and `TerminalStreamRouter` (decodes
 * inbound frames into per-terminal `output`/`snapshot`/`restore`
 * events). What did not exist is a *session*: one object that owns a
 * single terminal's open/write/resize/close lifecycle and decides —
 * rather than defaults — what happens when a caller writes to a session
 * that isn't connected, writes to one that is already closed, opens the
 * same terminal id twice, or closes it twice.
 *
 * Deliberately NOT exposed here: `DaemonClient`'s private
 * `sendBinaryFrame`/`tryHandleBinaryFrame`, or any method that accepts a
 * raw, already-encoded frame. Those two are wire plumbing that happens
 * to carry terminal bytes among other binary traffic (file transfers);
 * a public method shaped like `send(frame: Uint8Array)` would let any
 * caller inject an arbitrary opcode onto the socket, including opcodes
 * that belong to `packages/protocol`'s file-transfer binary frames, not
 * the terminal stream at all. This module's surface is scoped to one
 * named terminal id and only ever encodes `Input`/`Resize` frames for
 * it — see `writeInput`/`resize` below.
 *
 * ## Backpressure and close semantics (decided, not defaulted)
 *
 * `DaemonTransport.send` (`daemon-client-transport-types.ts`) is a
 * synchronous, fire-and-forget call with no `bufferedAmount` or drain
 * event in its contract — there is no true socket-level backpressure
 * signal anywhere under `packages/client` to observe. So "a write while
 * draining" is defined at this layer, not the socket's: any write
 * issued while `DaemonClient.isConnected` is false (disconnected,
 * reconnecting, or never connected) is treated as backpressure and
 * dropped rather than queued — see `TerminalWriteOutcome`'s
 * `"dropped-not-connected"`. This is a deliberate choice, not an
 * oversight: buffering keystrokes across a reconnect risks replaying
 * them into a different PTY than the one that will eventually read
 * them once the daemon resumes the stream (a fresh `subscribeTerminal`
 * on the far side may attach to a different process or a resized
 * screen). `apps/android/src/features/terminal/
 * terminal-session-controller.ts`'s own `sendInputPayload` already
 * reaches the identical conclusion for the exact same reason — dropping
 * disconnected input, never queuing it — so this mirrors an
 * already-proven decision rather than inventing a new one.
 *
 * `write`/`resize` never throw. Every outcome — sent, dropped because
 * the session is closed, dropped because the connection is down — is a
 * returned value (`TerminalWriteOutcome`), not an exception, so a
 * caller never needs a try/catch around a keystroke.
 *
 * `close()` is idempotent: a second call is a silent no-op (same
 * `state`, no duplicate unsubscribe RPC, `onClosed` fires at most once).
 * `openTerminalSession` for an id that is already open (or has an open
 * in flight) returns the *same* handle rather than starting a second
 * subscribe — see `TerminalSessionRegistry.open`.
 *
 * A frame that arrives for a terminal this registry does not know about
 * — never opened here, or already closed locally — never reaches any
 * session's listeners. It is stopped at two independent layers: the
 * daemon-side slot mapping is removed the instant `close()`/
 * `unsubscribeTerminal` runs (so `TerminalStreamRouter` itself routes
 * nothing further for it and reports the drop through its own `onDrop`
 * — see that file's `TerminalStreamDropReason`), and this registry also
 * only ever dispatches an event to a session it still holds open. Never
 * an exception either way.
 */

export type TerminalSessionState = "open" | "closed";

/**
 * Outcome of one `writeInput`/`resize` call — see this file's module
 * doc for why these are decided values, never thrown errors, and why
 * `"dropped-not-connected"` means "not queued", not "queued for later".
 */
export type TerminalWriteOutcome = "sent" | "dropped-not-connected" | "dropped-closed";

export interface TerminalSessionHandle {
  readonly terminalId: string;
  readonly state: TerminalSessionState;
  /** Sends one terminal input chunk. Never throws — see `TerminalWriteOutcome`. */
  writeInput(data: Uint8Array | string): TerminalWriteOutcome;
  /** Sends one resize claim/update. Never throws — see `TerminalWriteOutcome`. */
  resize(rows: number, cols: number, intent?: "claim" | "update"): TerminalWriteOutcome;
  /** Fires for each decoded output chunk for this terminal. */
  onOutput(handler: (data: Uint8Array) => void): () => void;
  /** Fires for each decoded catch-up snapshot for this terminal. */
  onSnapshot(handler: (state: TerminalState) => void): () => void;
  /** Fires for each decoded catch-up restore chunk for this terminal. */
  onRestore(handler: (data: Uint8Array) => void): () => void;
  /** Fires once, the first time this session transitions to `"closed"` — whether by a local `close()` or the daemon reporting the terminal already exited (see `TerminalSessionRegistryHost.onRemoteExit`). */
  onClosed(handler: () => void): () => void;
  /** Idempotent: unsubscribes from the daemon at most once, and fires `onClosed` at most once, no matter how many times this is called. */
  close(): void;
}

export interface TerminalSessionRegistryHost {
  isConnected(): boolean;
  subscribe(terminalId: string): Promise<{ error: string | null }>;
  unsubscribe(terminalId: string): void;
  sendInput(terminalId: string, data: Uint8Array | string): void;
  sendResize(terminalId: string, rows: number, cols: number, intent?: "claim" | "update"): void;
  onStreamEvent(handler: (event: TerminalStreamEvent) => void): () => void;
  /** Fires when the daemon reports a terminal exited server-side (e.g. `terminal_stream_exit`) — the daemon-initiated half of close, see `TerminalSessionRegistry`'s constructor. */
  onRemoteExit(handler: (terminalId: string) => void): () => void;
}

class TerminalSessionImpl implements TerminalSessionHandle {
  readonly terminalId: string;
  private sessionState: TerminalSessionState = "open";
  private readonly host: TerminalSessionRegistryHost;
  private readonly onDispose: () => void;
  private readonly outputListeners = new Set<(data: Uint8Array) => void>();
  private readonly snapshotListeners = new Set<(state: TerminalState) => void>();
  private readonly restoreListeners = new Set<(data: Uint8Array) => void>();
  private readonly closedListeners = new Set<() => void>();

  constructor(terminalId: string, host: TerminalSessionRegistryHost, onDispose: () => void) {
    this.terminalId = terminalId;
    this.host = host;
    this.onDispose = onDispose;
  }

  get state(): TerminalSessionState {
    return this.sessionState;
  }

  writeInput(data: Uint8Array | string): TerminalWriteOutcome {
    const outcome = this.checkWritable();
    if (outcome !== "sent") {
      return outcome;
    }
    this.host.sendInput(this.terminalId, data);
    return "sent";
  }

  resize(rows: number, cols: number, intent?: "claim" | "update"): TerminalWriteOutcome {
    const outcome = this.checkWritable();
    if (outcome !== "sent") {
      return outcome;
    }
    this.host.sendResize(this.terminalId, rows, cols, intent);
    return "sent";
  }

  private checkWritable(): TerminalWriteOutcome {
    if (this.sessionState === "closed") {
      return "dropped-closed";
    }
    if (!this.host.isConnected()) {
      return "dropped-not-connected";
    }
    return "sent";
  }

  onOutput(handler: (data: Uint8Array) => void): () => void {
    this.outputListeners.add(handler);
    return () => {
      this.outputListeners.delete(handler);
    };
  }

  onSnapshot(handler: (state: TerminalState) => void): () => void {
    this.snapshotListeners.add(handler);
    return () => {
      this.snapshotListeners.delete(handler);
    };
  }

  onRestore(handler: (data: Uint8Array) => void): () => void {
    this.restoreListeners.add(handler);
    return () => {
      this.restoreListeners.delete(handler);
    };
  }

  onClosed(handler: () => void): () => void {
    this.closedListeners.add(handler);
    return () => {
      this.closedListeners.delete(handler);
    };
  }

  /** Dispatches one already-demuxed event for this terminal. No-op once closed — see class doc's two-layer drop protection. */
  handleEvent(event: TerminalStreamEvent): void {
    if (this.sessionState === "closed") {
      return;
    }
    if (event.type === "output") {
      for (const listener of this.outputListeners) {
        listener(event.data);
      }
      return;
    }
    if (event.type === "snapshot") {
      for (const listener of this.snapshotListeners) {
        listener(event.state);
      }
      return;
    }
    for (const listener of this.restoreListeners) {
      listener(event.data);
    }
  }

  close(): void {
    this.closeInternal(true);
  }

  /**
   * Shared by the local `close()` and `TerminalSessionRegistry`'s
   * daemon-initiated close (`onRemoteExit`). `sendUnsubscribe` is false
   * for the latter: the daemon told this client the terminal is already
   * gone, so an `unsubscribe_terminal_request` for it would be sending a
   * request about a session the far side has already torn down.
   */
  closeInternal(sendUnsubscribe: boolean): void {
    if (this.sessionState === "closed") {
      // Idempotent: a second close (local or remote) is a deliberate
      // no-op, not a second unsubscribe RPC and not a second onClosed
      // firing.
      return;
    }
    this.sessionState = "closed";
    if (sendUnsubscribe) {
      this.host.unsubscribe(this.terminalId);
    }
    this.onDispose();
    for (const listener of this.closedListeners) {
      listener();
    }
    this.outputListeners.clear();
    this.snapshotListeners.clear();
    this.restoreListeners.clear();
    this.closedListeners.clear();
  }
}

/**
 * Owns every open `TerminalSessionHandle` for one `DaemonClient` and
 * demultiplexes its single `onStreamEvent` subscription to them by
 * terminal id. See this file's module doc for the open/close/write
 * decisions this makes.
 */
export class TerminalSessionRegistry {
  private readonly host: TerminalSessionRegistryHost;
  private readonly sessions = new Map<string, TerminalSessionImpl>();
  private readonly pendingOpens = new Map<string, Promise<TerminalSessionHandle>>();

  constructor(host: TerminalSessionRegistryHost) {
    this.host = host;
    host.onStreamEvent((event) => {
      this.sessions.get(event.terminalId)?.handleEvent(event);
    });
    // The daemon-initiated half of close: a terminal that exited
    // server-side (process ended, was killed elsewhere) closes its
    // session here too, without a redundant unsubscribe RPC — see
    // `TerminalSessionImpl.closeInternal`. A terminal id with no open
    // session here (never opened, or already closed locally) is a
    // silent no-op, the same "unknown terminal, named state, not an
    // exception" treatment as everywhere else in this file.
    host.onRemoteExit((terminalId) => {
      this.sessions.get(terminalId)?.closeInternal(false);
    });
  }

  /**
   * Opens (or reuses) a session for `terminalId`. Two opens for the same
   * id — concurrent or sequential while the first is still open — return
   * the *same* handle and issue exactly one `subscribe` call: a second
   * independent session object for one terminal id would let two
   * unrelated callers each believe they own its close/write lifecycle.
   */
  open(terminalId: string): Promise<TerminalSessionHandle> {
    const existingSession = this.sessions.get(terminalId);
    if (existingSession && existingSession.state === "open") {
      return Promise.resolve(existingSession);
    }
    const pending = this.pendingOpens.get(terminalId);
    if (pending) {
      return pending;
    }
    const openPromise = this.doOpen(terminalId);
    this.pendingOpens.set(terminalId, openPromise);
    const clearPending = (): void => {
      this.pendingOpens.delete(terminalId);
    };
    // `.then(onFulfilled, onRejected)` rather than `.finally()`: a
    // `.finally()` callback re-throws the original rejection into a new,
    // unhandled promise chain since nothing reads its result. This
    // cleanup's own result is likewise never read, but routing both
    // outcomes through explicit handlers here keeps that rejection from
    // ever existing in the first place — `openPromise` itself (returned
    // below, and from every other `open()` call awaiting it) is still
    // the one place callers observe success or failure.
    openPromise.then(clearPending, clearPending);
    return openPromise;
  }

  private async doOpen(terminalId: string): Promise<TerminalSessionHandle> {
    const result = await this.host.subscribe(terminalId);
    if (result.error !== null) {
      throw new Error(`Failed to open terminal session for "${terminalId}": ${result.error}`);
    }
    const session = new TerminalSessionImpl(terminalId, this.host, () => {
      if (this.sessions.get(terminalId) === session) {
        this.sessions.delete(terminalId);
      }
    });
    this.sessions.set(terminalId, session);
    return session;
  }
}
