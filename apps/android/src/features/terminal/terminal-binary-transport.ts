import {
  decodeTerminalResizePayload,
  decodeTerminalStreamFrame,
  encodeTerminalSnapshotPayload,
  encodeTerminalStreamFrame,
  TerminalStreamOpcode,
} from "@picompanion/protocol/binary-frames/terminal";
import type { TerminalState } from "@picompanion/protocol/messages";

/**
 * Terminal binary transport port (T35B1).
 *
 * The seam between `terminal-session-controller.ts` and however this
 * screen's terminal binary frames actually reach the daemon. Deliberately
 * the narrowest possible shape — raw bytes in, raw bytes out, plus an
 * open/closed signal — so the controller never assumes a WebSocket, a
 * relay hop, or any particular reconnect policy; `packages/client`'s
 * `DaemonClient` (its `sendBinaryFrame`/binary-message handling) is the
 * real implementation a future task wires in, once terminal state lives
 * on `AppCore` (see this file's and `index.ts`'s module docs for what
 * that wiring needs).
 *
 * Every frame crossing this port is the exact byte layout
 * `@picompanion/protocol/binary-frames/terminal`'s
 * `encodeTerminalStreamFrame`/`decodeTerminalStreamFrame` produce and
 * consume: `[opcode: u8][slot: u8][payload: bytes]`. This port carries
 * bytes, never JSON — `terminal-session-controller.ts` is the only place
 * that knows the opcode layout.
 *
 * ## `dispose` (T65, P5-W19)
 *
 * T32S12 mounted `app-shell/terminal-transport-adapter.ts` against T62's
 * `DaemonClient.openTerminalSession` and disclosed exactly this gap in
 * its own module doc: nothing ever told a `TerminalBinaryTransport` its
 * screen was gone, so the daemon-side subscription for a terminal a user
 * navigated away from stayed open — and the daemon kept sending frames
 * nobody read — for the process's lifetime.
 *
 * `dispose` is the answer: **optional**, so a transport with nothing to
 * release (`createNotConnectedTerminalBinaryTransport` below — no
 * session was ever opened) need not implement a meaningful body, and so
 * that adding this member to an already-widely-implemented interface
 * never breaks a sibling task's existing `TerminalBinaryTransport`
 * literal (`app-shell/terminal-transport-adapter.ts`,
 * `terminal-session-controller.test.ts`'s `FakeTransport`) mid-wave —
 * but every real implementation should provide one. Contract, enforced
 * by `createTerminalSessionBinaryTransport` below and proven in
 * `terminal-binary-transport.test.ts`:
 *
 * - Never throws.
 * - Idempotent: a second call is a no-op, reported as
 *   `"already-disposed"` rather than a second close/teardown.
 * - A transport that never held a live session reports
 *   `"never-connected"` — see `createNotConnectedTerminalBinaryTransport`.
 * - Once disposed, `isOpen` reads `false`, `send` is a silent no-op, and
 *   any inbound event — even one already in flight when `dispose` ran —
 *   is discarded rather than reaching an `onFrame` subscriber. That
 *   discard is a *named* outcome (`TerminalTransportFrameDropReason`,
 *   currently just `"disposed"`), the same "a value, not a silent drop"
 *   convention `packages/client`'s `TerminalStreamDropReason` and
 *   `TerminalWriteOutcome` already use — surfaced only through the
 *   `onFrameDropped` test/observability hook, never logged (see below).
 * - Disposing a session-backed transport calls the underlying session's
 *   `close()` exactly once, so `session.state` — not just a recorded
 *   call — actually becomes `"closed"` and a subsequent `writeInput`
 *   provably returns `"dropped-closed"`.
 *
 * ## No terminal content ever reaches a log
 *
 * Nothing in this file calls `console.*` (or any logger) with a frame,
 * payload, or terminal id joined to content — dispose diagnostics flow
 * only through the named `onFrameDropped` reason string above, never the
 * dropped bytes themselves.
 */
export interface TerminalBinaryTransport {
  /** Whether a frame sent right now would actually reach the daemon. */
  readonly isOpen: boolean;
  /** Sends one already-encoded terminal binary frame. Callers must check `isOpen` first. */
  send(frame: Uint8Array): void;
  /** Fires with each terminal binary frame the daemon delivers on this connection. */
  onFrame(handler: (frame: Uint8Array) => void): () => void;
  /** Fires whenever `isOpen` changes (connect, disconnect, reconnect). */
  onOpenChange(handler: (isOpen: boolean) => void): () => void;
  /**
   * Tells this transport its screen is gone. Optional — see this file's
   * module doc for why — but every implementation that holds a live
   * daemon-side subscription must provide one. Never throws; idempotent;
   * never logs frame content. Returns the named outcome that occurred.
   */
  dispose?(): TerminalTransportDisposeOutcome;
}

/** Named outcome of one `dispose()` call — see module doc. Never a thrown error. */
export type TerminalTransportDisposeOutcome = "disposed" | "already-disposed" | "never-connected";

/** Named reason an inbound session event was discarded instead of reaching an `onFrame` subscriber — see module doc. Never carries the dropped frame's bytes. */
export type TerminalTransportFrameDropReason = "disposed";

/**
 * A `TerminalBinaryTransport` with no daemon connection behind it at all
 * — this feature's placeholder until a real one is wired (see module
 * doc). `send` is a silent no-op rather than a throw: a screen built
 * before wiring exists should degrade to "nothing happens", the same
 * honest-inert shape `createUnavailableTerminalWebViewPort` gives the
 * WebView side. `dispose()` always reports `"never-connected"`: no
 * session was ever opened here for it to close.
 */
export function createNotConnectedTerminalBinaryTransport(): TerminalBinaryTransport {
  return {
    isOpen: false,
    send() {
      // No connection exists to send on.
    },
    onFrame() {
      return () => undefined;
    },
    onOpenChange() {
      return () => undefined;
    },
    dispose(): TerminalTransportDisposeOutcome {
      return "never-connected";
    },
  };
}

/**
 * Structural mirror of `packages/client/src/terminal-session.ts`'s
 * `TerminalSessionHandle` (T62) and `app-shell/terminal-transport-
 * adapter.ts`'s own local `TerminalSessionHandleLike` — declared here
 * rather than imported as a value for the same reason both of those
 * files give: `apps/android/package.json` does not declare
 * `@picompanion/client` as a dependency, and this task may not edit
 * `package.json` or run an install. A real `TerminalSessionHandle`
 * structurally satisfies this today.
 */
export interface TerminalSessionHandleLike {
  readonly state: "open" | "closed";
  writeInput(data: Uint8Array | string): "sent" | "dropped-not-connected" | "dropped-closed";
  resize(
    rows: number,
    cols: number,
    intent?: "claim" | "update",
  ): "sent" | "dropped-not-connected" | "dropped-closed";
  onOutput(handler: (data: Uint8Array) => void): () => void;
  onSnapshot(handler: (state: TerminalState) => void): () => void;
  onRestore(handler: (data: Uint8Array) => void): () => void;
  onClosed(handler: () => void): () => void;
  close(): void;
}

export interface CreateTerminalSessionBinaryTransportOptions {
  /** An already-open T62 session for exactly one terminal id. */
  readonly session: TerminalSessionHandleLike;
  /** Fixed multiplexing slot stamped onto every encoded frame this transport produces. */
  readonly slot: number;
  /**
   * Fires with a *named reason only* (never the dropped bytes) whenever
   * an inbound session event is discarded after dispose — a test/
   * observability seam, never a logger. See module doc.
   */
  readonly onFrameDropped?: (reason: TerminalTransportFrameDropReason) => void;
}

/**
 * Wraps one already-open `TerminalSessionHandleLike` into a
 * `TerminalBinaryTransport` — the single-session half of the bridge
 * `app-shell/terminal-transport-adapter.ts`'s `createDaemonTerminalBinaryTransport`
 * needs (that file owns *which* session is current across reconnects;
 * this owns *how one session* maps onto the encoded-frame port and,
 * critically, what `dispose()` does to it). See this file's module doc
 * for the full dispose contract, and see `terminal-binary-transport.test.ts`
 * for the state-based proof that `dispose()` actually reaches
 * `session.close()` — not just that it was called.
 */
export function createTerminalSessionBinaryTransport(
  options: CreateTerminalSessionBinaryTransportOptions,
): TerminalBinaryTransport {
  const { session, slot, onFrameDropped } = options;

  let disposed = false;
  let isOpen = session.state === "open";
  const frameListeners = new Set<(frame: Uint8Array) => void>();
  const openChangeListeners = new Set<(isOpen: boolean) => void>();

  const setOpen = (next: boolean): void => {
    if (isOpen === next) return;
    isOpen = next;
    for (const listener of openChangeListeners) listener(next);
  };

  /** Every inbound path funnels through here so a post-dispose (even racing) event is provably discarded — see module doc's frame-drop contract. */
  const forward = (frame: Uint8Array): void => {
    if (disposed) {
      onFrameDropped?.("disposed");
      return;
    }
    for (const listener of frameListeners) listener(frame);
  };

  const unsubscribers = [
    session.onOutput((data) => {
      forward(
        encodeTerminalStreamFrame({ opcode: TerminalStreamOpcode.Output, slot, payload: data }),
      );
    }),
    session.onSnapshot((state) => {
      forward(
        encodeTerminalStreamFrame({
          opcode: TerminalStreamOpcode.Snapshot,
          slot,
          payload: encodeTerminalSnapshotPayload(state),
        }),
      );
    }),
    session.onRestore((data) => {
      forward(
        encodeTerminalStreamFrame({ opcode: TerminalStreamOpcode.Restore, slot, payload: data }),
      );
    }),
    session.onClosed(() => setOpen(false)),
  ];

  return {
    get isOpen(): boolean {
      return isOpen && !disposed;
    },
    send(frame: Uint8Array): void {
      if (disposed) return;
      const decoded = decodeTerminalStreamFrame(frame);
      if (!decoded) return;
      if (decoded.opcode === TerminalStreamOpcode.Input) {
        session.writeInput(decoded.payload);
        return;
      }
      if (decoded.opcode === TerminalStreamOpcode.Resize) {
        const resize = decodeTerminalResizePayload(decoded.payload);
        if (!resize) return;
        session.resize(resize.rows, resize.cols, resize.intent);
        return;
      }
      // Output/Snapshot/Restore are inbound-only opcodes — a caller
      // sending one is not this transport's to interpret; silently
      // ignored, matching `app-shell`'s adapter's identical convention.
    },
    onFrame(handler: (frame: Uint8Array) => void): () => void {
      frameListeners.add(handler);
      return () => frameListeners.delete(handler);
    },
    onOpenChange(handler: (isOpen: boolean) => void): () => void {
      openChangeListeners.add(handler);
      return () => openChangeListeners.delete(handler);
    },
    dispose(): TerminalTransportDisposeOutcome {
      if (disposed) {
        return "already-disposed";
      }
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
      session.close();
      setOpen(false);
      frameListeners.clear();
      openChangeListeners.clear();
      return "disposed";
    },
  };
}
