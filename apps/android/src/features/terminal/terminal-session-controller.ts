import type { Clock } from "@picompanion/frontend-core";
import {
  decodeTerminalSnapshotPayload,
  decodeTerminalStreamFrame,
  encodeTerminalResizePayload,
  encodeTerminalStreamFrame,
  TerminalStreamOpcode,
} from "@picompanion/protocol/binary-frames/index";
import {
  encodeTerminalKeyInput,
  type TerminalKeyInput,
} from "@picompanion/protocol/terminal-key-input";

import type { TerminalBinaryTransport } from "./terminal-binary-transport";
import { TerminalResizeController } from "./terminal-resize-controller";
import type { TerminalTheme } from "./terminal-theme";
import { TerminalOutputBuffer, type TerminalPendingFrame } from "./terminal-output-buffer";
import type { TerminalSize, TerminalWebViewPort } from "./terminal-webview-port";

/**
 * Terminal session wiring (T35B1, plan.md §12.4).
 *
 * The RN-free core of the Android terminal: decodes/encodes the real
 * binary frame shape from `@picompanion/protocol/binary-frames/terminal`
 * (`[opcode: u8][slot: u8][payload]` — `TerminalStreamOpcode.{Output,
 * Input,Resize,Snapshot,Restore}`), moves bytes between a
 * `TerminalBinaryTransport` (the daemon side) and a `TerminalWebViewPort`
 * (the `xterm.js` side), and applies `TerminalResizeController`'s resize
 * ownership rule. No JSON envelope is invented anywhere on the output/
 * input/restore path — those three opcodes carry raw bytes end to end;
 * only `Resize` and `Snapshot` payloads are JSON, exactly as
 * `binary-frames/terminal.ts` already defines them.
 *
 * Kept in its own class rather than folded into `terminal-screen.tsx` for
 * the reason every other feature in this wave keeps its wiring in a
 * `*-model.ts`/`*-controller.ts`: vitest cannot import anything that
 * reaches `react-native` (see this repo's `CLAUDE.md`), so this is the
 * only place the terminal's actual behavior can be proven at all —
 * `terminal-screen.tsx` is a thin view over it.
 *
 * T35B2 adds two invariants on top of T35B1's frame plumbing, both
 * enforced here rather than left to accident:
 *
 * 1. **Never write to the webview before it is ready.** A daemon can
 *    start streaming the instant its binary channel opens, well before
 *    the embedded page has finished loading `xterm.js` — `Output`,
 *    `Restore`, and `Snapshot` frames that arrive while
 *    `!isTerminalReady` are queued in a `TerminalOutputBuffer` (see that
 *    file's module doc for the bounded/coalescing policy) and flushed,
 *    in order, the instant `onReady` fires.
 * 2. **Never claim a resize before this connection's catch-up frame has
 *    landed.** `Snapshot` and `Restore` are always catch-up-only opcodes
 *    on the wire (`packages/server/src/terminal/
 *    terminal-session-controller.ts`'s `emitLegacySnapshot`/
 *    `emitRestoreSnapshot`, both reachable only from `trySendSnapshot`,
 *    which always runs before a fresh stream's `Output` frames do) — so
 *    this controller reports the resize controller `isConnected: false`
 *    until one has been applied for the *current* connection, even if
 *    the transport itself is already open. Without this, a reconnect
 *    could send a resize claim built from a pre-disconnect measurement
 *    before the client has even rendered the daemon's current state,
 *    racing (and potentially clobbering) the restore.
 *
 * T35B3 adds a second inbound path onto the same `Input` opcode, for
 * hardware-keyboard and accessory-bar keys the embedded page's own
 * `xterm.js` never sees a DOM key event for. A soft keyboard's printable
 * keystrokes reach `handleWebViewInput` as already-encoded bytes — the
 * page's own `xterm.js` `onData` callback does that encoding, uniformly,
 * for anything the WebView's DOM actually receives a key event for.
 * Bluetooth/USB hardware keyboards and this screen's control-key
 * accessory bar (Ctrl, Esc, arrows, function keys — symbols soft
 * keyboards often omit) instead reach `sendHardwareKeyInput` as a typed
 * `TerminalKeyInput` (key + modifiers), encoded here through
 * `@picompanion/protocol/terminal-key-input`'s `encodeTerminalKeyInput`
 * — the same encoder this repo's terminal already uses elsewhere in the
 * ported backend — into the exact control-sequence bytes a real terminal
 * expects, then sent over the identical `Input` opcode as the WebView
 * path. Neither path is "the" hardware or soft path in general; a real
 * BT keyboard's printable characters still flow through the WebView's
 * own key events like a soft keyboard's, and this method exists for the
 * modifier combinations and control keys neither xterm.js's DOM capture
 * nor a soft keyboard can express as plain text.
 */

export interface TerminalSessionControllerOptions {
  readonly transport: TerminalBinaryTransport;
  readonly webview: TerminalWebViewPort;
  /** Fixed for this screen's single terminal — one `TerminalScreen` owns exactly one slot. */
  readonly slot: number;
  readonly resizeDebounceMs?: number;
  readonly clock: Clock;
}

const DEFAULT_RESIZE_DEBOUNCE_MS = 150;

export class TerminalSessionController {
  private readonly transport: TerminalBinaryTransport;
  private readonly webview: TerminalWebViewPort;
  private readonly slot: number;
  private readonly resize: TerminalResizeController;
  private readonly outputBuffer = new TerminalOutputBuffer();
  private readonly unsubscribers: Array<() => void> = [];
  private isTerminalReady = false;
  private isVisible = false;
  /** Whether the *current* connection has applied a Snapshot/Restore catch-up frame — see class doc. */
  private hasAppliedConnectionCatchUp = false;

  constructor(options: TerminalSessionControllerOptions) {
    this.transport = options.transport;
    this.webview = options.webview;
    this.slot = options.slot;
    this.resize = new TerminalResizeController({
      debounceMs: options.resizeDebounceMs ?? DEFAULT_RESIZE_DEBOUNCE_MS,
      clock: options.clock,
      onClaim: (claim) => this.sendResizeClaim(claim),
    });

    this.unsubscribers.push(
      this.transport.onFrame((frame) => this.handleTransportFrame(frame)),
      this.transport.onOpenChange((isOpen) => this.handleOpenChange(isOpen)),
      this.webview.onReady(() => this.handleWebViewReady()),
      this.webview.onInput((bytes) => this.handleWebViewInput(bytes)),
      this.webview.onMeasuredSize((size) => this.handleMeasuredSize(size)),
    );

    this.pushReadiness();
  }

  /** Reports whether this screen is the foregrounded, actively visible route. */
  setVisible(isVisible: boolean): void {
    this.isVisible = isVisible;
    this.pushReadiness();
  }

  setTheme(theme: TerminalTheme): void {
    this.webview.setTheme(theme);
  }

  /**
   * Encodes one hardware-keyboard or accessory-bar key event into the
   * exact terminal control-sequence bytes `encodeTerminalKeyInput`
   * produces (see class doc) and sends it over the same `Input` opcode
   * as a WebView keystroke. A key this encoder cannot represent (an
   * empty/unrecognized `key`) encodes to `""` and is silently not sent —
   * matching `encodeTerminalKeyInput`'s own "nothing to send" contract,
   * not a new error path invented here.
   */
  sendHardwareKeyInput(input: TerminalKeyInput): void {
    const encoded = encodeTerminalKeyInput(input);
    if (encoded.length === 0) {
      return;
    }
    this.sendInputPayload(encoded);
  }

  private pushReadiness(): void {
    this.resize.setReadiness({
      isVisible: this.isVisible,
      // Gated on more than the raw socket: see class doc point 2 — a
      // resize must never race ahead of this connection's own catch-up
      // frame.
      isConnected: this.transport.isOpen && this.hasAppliedConnectionCatchUp,
      isTerminalReady: this.isTerminalReady,
    });
  }

  private handleOpenChange(isOpen: boolean): void {
    if (isOpen) {
      // A fresh connection (first connect or a reconnect) has not yet
      // replayed its own catch-up frame, regardless of whether a prior
      // connection did.
      this.hasAppliedConnectionCatchUp = false;
    }
    this.pushReadiness();
  }

  private handleWebViewReady(): void {
    this.isTerminalReady = true;
    this.flushOutputBuffer();
    this.pushReadiness();
  }

  private flushOutputBuffer(): void {
    if (this.outputBuffer.length === 0) {
      return;
    }
    // A queued Snapshot/Restore chunk (if any) is always first — see
    // `TerminalOutputBuffer.enqueueSnapshot`/`enqueueRestore`, both of
    // which clear the queue before adding themselves — so applying frames
    // in drained order naturally applies it before any `output` chunk
    // behind it, and `applyPendingFrame`'s catch-up side effect flips the
    // gate mid-loop for exactly those later frames. An `output` chunk
    // that still fails the gate (no catch-up frame has reached this
    // connection at all yet) is put back rather than applied early.
    for (const frame of this.outputBuffer.drain()) {
      if (frame.kind === "output" && (!this.isTerminalReady || !this.hasAppliedConnectionCatchUp)) {
        this.outputBuffer.enqueueOutput(frame.bytes);
        continue;
      }
      this.applyPendingFrame(frame);
    }
  }

  private applyPendingFrame(frame: TerminalPendingFrame): void {
    switch (frame.kind) {
      case "output":
        this.webview.write(frame.bytes);
        return;
      case "restore":
        this.webview.write(frame.bytes);
        this.markConnectionCatchUpApplied();
        return;
      case "snapshot":
        this.webview.restore(frame.state);
        this.markConnectionCatchUpApplied();
        return;
    }
  }

  private markConnectionCatchUpApplied(): void {
    if (this.hasAppliedConnectionCatchUp) {
      return;
    }
    this.hasAppliedConnectionCatchUp = true;
    // Anything that arrived and queued while this connection's catch-up
    // was still pending (see the Output case below) can now be applied,
    // in order, right behind it.
    this.flushOutputBuffer();
    this.pushReadiness();
  }

  private handleMeasuredSize(size: TerminalSize): void {
    this.resize.setSize(size);
  }

  private handleWebViewInput(bytes: Uint8Array): void {
    this.sendInputPayload(bytes);
  }

  /** Shared by both inbound paths onto `Input` — see class doc's T35B3 addendum. */
  private sendInputPayload(payload: Uint8Array | string): void {
    if (!this.transport.isOpen) {
      // Never race the daemon: dropping input while disconnected is
      // correct (there is nothing to receive it) rather than queuing it
      // for a later, possibly-different PTY session.
      return;
    }
    const frame = encodeTerminalStreamFrame({
      opcode: TerminalStreamOpcode.Input,
      slot: this.slot,
      payload,
    });
    this.transport.send(frame);
  }

  private sendResizeClaim(claim: { rows: number; cols: number; intent: "claim" | "update" }): void {
    if (!this.transport.isOpen) {
      // The resize controller only claims once `isConnected` is true, but
      // guard defensively against a transport that flips closed between
      // the debounce firing and this callback running.
      return;
    }
    const frame = encodeTerminalStreamFrame({
      opcode: TerminalStreamOpcode.Resize,
      slot: this.slot,
      payload: encodeTerminalResizePayload({
        rows: claim.rows,
        cols: claim.cols,
        intent: claim.intent,
      }),
    });
    this.transport.send(frame);
  }

  private handleTransportFrame(bytes: Uint8Array): void {
    const frame = decodeTerminalStreamFrame(bytes);
    if (frame === null || frame.slot !== this.slot) {
      return;
    }
    switch (frame.opcode) {
      case TerminalStreamOpcode.Output: {
        if (!this.isTerminalReady || !this.hasAppliedConnectionCatchUp) {
          // Queued, not dropped and not written early — see class doc
          // points 1 and 2, and TerminalOutputBuffer's bounded/coalescing
          // policy. The `!hasAppliedConnectionCatchUp` half of this guard
          // is what makes a reconnect race-proof: an Output frame that
          // slips in before this connection's own Restore/Snapshot lands
          // waits behind it instead of rendering out of order.
          this.outputBuffer.enqueueOutput(frame.payload);
          return;
        }
        this.webview.write(frame.payload);
        return;
      }
      case TerminalStreamOpcode.Restore: {
        // Restore is always a catch-up-only opcode on the wire (class doc
        // point 2) — applying it also satisfies this connection's
        // catch-up requirement for the resize controller.
        if (!this.isTerminalReady) {
          this.outputBuffer.enqueueRestore(frame.payload);
          return;
        }
        this.webview.write(frame.payload);
        this.markConnectionCatchUpApplied();
        return;
      }
      case TerminalStreamOpcode.Snapshot: {
        const state = decodeTerminalSnapshotPayload(frame.payload);
        if (state === null) {
          return;
        }
        if (!this.isTerminalReady) {
          this.outputBuffer.enqueueSnapshot(state);
          return;
        }
        this.webview.restore(state);
        this.markConnectionCatchUpApplied();
        return;
      }
      default:
        // Input/Resize are outbound-only opcodes; a daemon never sends
        // them back, so there is nothing to apply.
        return;
    }
  }

  /**
   * Fires when this screen goes away (`terminal-screen.tsx`'s unmount
   * cleanup already calls this — see that file). Beyond this class's own
   * cleanup, T65 adds the missing half: telling `this.transport` the
   * screen is gone via its optional `dispose()`, so a
   * `createTerminalSessionBinaryTransport`-backed transport actually
   * closes T62's underlying session instead of leaking a daemon-side
   * subscription for the rest of the process's lifetime — see
   * `terminal-binary-transport.ts`'s module doc for the full contract.
   * `dispose?.()` is itself idempotent, so a second call here is already
   * safe without an extra guard on this class.
   */
  dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.resize.dispose();
    this.webview.dispose();
    this.transport.dispose?.();
  }
}
