import {
  decodeTerminalStreamFrame,
  decodeTerminalResizePayload,
  encodeTerminalSnapshotPayload,
  encodeTerminalStreamFrame,
  TerminalStreamOpcode,
} from "@picompanion/protocol/binary-frames/terminal";
import type { TerminalState } from "@picompanion/protocol/messages";

import type {
  TerminalBinaryTransport,
  TerminalTransportDisposeOutcome,
} from "../features/terminal/index.js";

/**
 * `AppCore.createTerminalTransport` (T32S12, P5-W18) — the seam
 * `terminal-binary-transport.ts`'s own module doc named as "a future
 * task wires in": bridges `terminal-session-controller.ts`'s raw-byte
 * `TerminalBinaryTransport` port onto T62's session-shaped
 * `DaemonClient.openTerminalSession(terminalId)` API
 * (`packages/client/src/terminal-session.ts`).
 *
 * ---------------------------------------------------------------------
 * Why this is a type-only bridge, never a value import of `@picompanion/
 * client`
 * ---------------------------------------------------------------------
 * `apps/android/package.json` does not declare `@picompanion/client` as
 * a dependency (confirmed: no `dependencies`/`devDependencies` entry —
 * every existing reference under `apps/android/src` is already
 * `import type`, e.g. `app-shell/core.test.ts`'s `ConnectionState`).
 * This task may not edit `package.json` or run an install (T60C still
 * holds that grant). So this module never imports a value from
 * `@picompanion/client` — `TerminalSessionCapableClient` and
 * `TerminalSessionHandleLike` below are locally-declared structural
 * types this file casts `connection.getActiveLifecycle()?.
 * getDaemonClient()`'s result onto, the exact "the real production
 * `DaemonClient` has this method, this file's cast documents the gap"
 * pattern `core.ts`'s `AgentStreamCapableClient` already uses for
 * `on("agent_stream", ...)`. A real `DaemonClient` instance
 * structurally satisfies both interfaces today (see
 * `packages/client/src/terminal-session.ts`'s `TerminalSessionHandle`
 * and `daemon-client.ts`'s `openTerminalSession`), so this is provably
 * real, not a stand-in — `terminal-transport-adapter.test.ts` proves it
 * against a hand-rolled fake shaped exactly like that real API, never a
 * socket.
 *
 * ---------------------------------------------------------------------
 * The reconnect/resubscribe policy T62 left undecided
 * ---------------------------------------------------------------------
 * T62's own module doc flags this: a `TerminalSessionHandle` is bound to
 * the `DaemonClient` instance that opened it, so once that client is
 * torn down by a reconnect (a new instance replaces it —
 * `AppCore.connection` already does this on every `adoptLifecycle`),
 * every further `writeInput`/`resize` on the *old* handle reports
 * `"dropped-not-connected"` forever; nothing re-opens a fresh session
 * automatically. Left alone, a terminal screen open across a reconnect
 * goes silently, permanently dead.
 *
 * **Decision: resubscribe automatically**, mirroring `core.ts`'s own
 * `ensureAgentStreamSubscription` precedent exactly (same file, same
 * "re-checked on every `connection.subscribe()` snapshot publish, torn
 * down and replaced, never left dangling" shape): whenever the daemon
 * client `getClient()` resolves to changes identity (a fresh connect, a
 * reconnect after a drop, or a disconnect), this adapter closes any
 * session it holds against the *old* client, reports `isOpen: false`
 * to `onOpenChange` listeners, and — if a new client is present — opens
 * a fresh `openTerminalSession(terminalId)` against it, reporting
 * `isOpen: true` once that resolves. A caller mid-typing across a
 * reconnect loses at most the input in flight at the moment of the
 * drop (already true of every other write during a disconnect, by
 * `TerminalWriteOutcome`'s own "dropped-not-connected", not queued"
 * design — see `terminal-session.ts`'s module doc) and regains a live
 * terminal the instant the new session opens, rather than staying dead
 * for the rest of the screen's lifetime.
 *
 * ---------------------------------------------------------------------
 * Dispose (T65 seam, applied at the P5-W19 merge gate)
 * ---------------------------------------------------------------------
 * This module used to disclose "no dispose hook": `TerminalBinaryTransport`
 * declared no `close`/dispose method, so nothing called the underlying
 * `TerminalSessionHandle.close()` when a screen unmounted, and the
 * daemon-side subscription for a terminal the user navigated away from
 * stayed open for the life of the process.
 *
 * T65 (P5-W19) added the optional `dispose?()` member to
 * `TerminalBinaryTransport` and made `TerminalSessionController.dispose()`
 * cascade into it. That cascade was a no-op here until this
 * implementation landed — `dispose?.()` optional-chained past a
 * transport that had no `dispose` — so `TerminalScreen`'s unmount
 * effect reached T65's contract but never T62's session. `dispose()`
 * below closes that chain end-to-end: it invalidates any in-flight
 * `openTerminalSession` (via the same `attempt` guard the reconnect
 * path already uses), unsubscribes from connection changes, closes the
 * live session, and reports `false` to `onOpenChange` listeners.
 * Idempotent, per T65's contract: a second call returns
 * `"already-disposed"` and closes nothing twice.
 */

export type TerminalSessionWriteOutcome = "sent" | "dropped-not-connected" | "dropped-closed";

export interface TerminalSessionHandleLike {
  readonly state: "open" | "closed";
  writeInput(data: Uint8Array | string): TerminalSessionWriteOutcome;
  resize(rows: number, cols: number, intent?: "claim" | "update"): TerminalSessionWriteOutcome;
  onOutput(handler: (data: Uint8Array) => void): () => void;
  onSnapshot(handler: (state: TerminalState) => void): () => void;
  onRestore(handler: (data: Uint8Array) => void): () => void;
  onClosed(handler: () => void): () => void;
  close(): void;
}

export interface TerminalSessionCapableClient {
  openTerminalSession(terminalId: string): Promise<TerminalSessionHandleLike>;
}

export interface CreateTerminalTransportOptions {
  terminalId: string;
  /** Fixed multiplexing slot for this screen's terminal (`TerminalScreen`'s own `slot` prop, default `0`) — stamped onto every encoded frame this adapter produces. */
  slot: number;
  /** Reads the currently active daemon client fresh, every time — never captured once, so a reconnect that swaps in a new client is observed. `null` when nothing is connected. */
  getClient: () => TerminalSessionCapableClient | null;
  /** Subscribes to every connection snapshot publish (`AppCore.connection.subscribe`). Returns an unsubscribe function. */
  subscribeConnectionChanges: (listener: () => void) => () => void;
}

/**
 * Builds one terminal's `TerminalBinaryTransport`, bridging T62's
 * decoded session API onto the encoded-frame port
 * `terminal-session-controller.ts` consumes — see this module's doc
 * comment for the encode/decode boundary and the reconnect policy.
 */
export function createDaemonTerminalBinaryTransport(
  options: CreateTerminalTransportOptions,
): TerminalBinaryTransport {
  const { terminalId, slot, getClient, subscribeConnectionChanges } = options;

  const frameListeners = new Set<(frame: Uint8Array) => void>();
  const openChangeListeners = new Set<(isOpen: boolean) => void>();

  let currentClient: TerminalSessionCapableClient | null = null;
  let currentSession: TerminalSessionHandleLike | null = null;
  let sessionUnsubscribers: Array<() => void> = [];
  let isOpen = false;
  // Bumped on every (re)subscribe attempt so a slow-resolving
  // `openTerminalSession` from a client this adapter has since moved on
  // from never overwrites a newer session — the same "compare against
  // the value captured at call time" guard `core.ts`'s
  // `ensureAgentStreamSubscription` uses for its own async reconnects.
  let attempt = 0;
  let disposed = false;

  const setOpen = (next: boolean): void => {
    if (isOpen === next) return;
    isOpen = next;
    for (const listener of openChangeListeners) listener(next);
  };

  const teardownSession = (): void => {
    for (const unsubscribe of sessionUnsubscribers) unsubscribe();
    sessionUnsubscribers = [];
    currentSession = null;
  };

  const attachSession = (session: TerminalSessionHandleLike): void => {
    currentSession = session;
    sessionUnsubscribers = [
      session.onOutput((data) => {
        for (const listener of frameListeners) {
          listener(
            encodeTerminalStreamFrame({ opcode: TerminalStreamOpcode.Output, slot, payload: data }),
          );
        }
      }),
      session.onSnapshot((state) => {
        for (const listener of frameListeners) {
          listener(
            encodeTerminalStreamFrame({
              opcode: TerminalStreamOpcode.Snapshot,
              slot,
              payload: encodeTerminalSnapshotPayload(state),
            }),
          );
        }
      }),
      session.onRestore((data) => {
        for (const listener of frameListeners) {
          listener(
            encodeTerminalStreamFrame({
              opcode: TerminalStreamOpcode.Restore,
              slot,
              payload: data,
            }),
          );
        }
      }),
      session.onClosed(() => {
        if (currentSession !== session) return;
        teardownSession();
        setOpen(false);
      }),
    ];
    setOpen(true);
  };

  const ensureSession = (): void => {
    // Once disposed, a late connection-change publish must never reopen
    // a session for a screen that is gone.
    if (disposed) return;
    const client = getClient();
    if (client === currentClient) return;
    currentClient = client;
    attempt += 1;
    const thisAttempt = attempt;

    if (currentSession) {
      currentSession.close();
    }
    teardownSession();
    setOpen(false);

    if (!client) return;

    void client
      .openTerminalSession(terminalId)
      .then((session) => {
        // A newer reconnect (or disconnect) already moved past this
        // attempt — never adopt a stale session onto the current state.
        if (thisAttempt !== attempt) {
          session.close();
          return;
        }
        attachSession(session);
      })
      .catch(() => {
        // The daemon refused the subscribe RPC (e.g. unknown terminal
        // id) — stay closed, same "refused is a defined outcome, not a
        // thrown error" convention every other adapter in this app
        // follows (`file-picker.ts`, `push-registration-port.ts`).
      });
  };

  const unsubscribeConnectionChanges = subscribeConnectionChanges(() => ensureSession());
  ensureSession();

  return {
    get isOpen(): boolean {
      return isOpen;
    },
    send(frame: Uint8Array): void {
      if (!currentSession) return;
      const decoded = decodeTerminalStreamFrame(frame);
      if (!decoded) return;
      if (decoded.opcode === TerminalStreamOpcode.Input) {
        currentSession.writeInput(decoded.payload);
        return;
      }
      if (decoded.opcode === TerminalStreamOpcode.Resize) {
        const resize = decodeTerminalResizePayload(decoded.payload);
        if (!resize) return;
        currentSession.resize(resize.rows, resize.cols, resize.intent);
        return;
      }
      // Output/Snapshot/Restore are inbound-only opcodes — a caller
      // sending one is not this transport's to interpret; silently
      // ignored, same "unrecognized is a no-op" convention `send`
      // already documents for the not-connected case.
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
      if (disposed) return "already-disposed";
      disposed = true;
      // Invalidate any `openTerminalSession` still in flight, so a
      // session that resolves after this point is closed by the
      // `thisAttempt !== attempt` guard rather than adopted.
      attempt += 1;
      unsubscribeConnectionChanges();
      const hadSession = currentSession !== null;
      if (currentSession) currentSession.close();
      teardownSession();
      currentClient = null;
      setOpen(false);
      return hadSession ? "disposed" : "never-connected";
    },
  };
}
