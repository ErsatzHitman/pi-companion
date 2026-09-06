import type { Clock, TimerHandle } from "@picompanion/frontend-core";
import { TerminalStreamResizeSchema } from "@picompanion/protocol/binary-frames/index";

import type { TerminalSize } from "./terminal-webview-port";

/**
 * Terminal resize ownership (T35B1, plan.md §5.2 "terminal resize
 * ownership", §13 Phase 7.2 "Terminal latency and resize ownership").
 *
 * This is a **written requirement derived from reading the reference**,
 * not copied code: `D:\paseo\packages\app\src\components\
 * terminal-resize-debouncer.ts` and `terminal-pane-focus-claim.ts`
 * implement a multi-pane focus-claim/ownership negotiation this app has
 * no equivalent of (Android shows exactly one terminal per screen, never
 * split panes), and neither file's logic is reused below. What is kept
 * is the *rule* their regression test
 * (`e2e/browser/terminal-stuck-size.spec.ts`) encodes:
 *
 *   The PTY is only ever resized by an explicit client "claim" — never a
 *   passive size report — and that claim must be sent only once the
 *   screen is visible, the transport is connected, and the embedded
 *   terminal has reported it is ready to be resized. Critically, a size
 *   measured while any of those is false is **not dropped**: it is
 *   retained and re-claimed the instant readiness is regained, so a
 *   terminal that was measured while backgrounded still ends up at its
 *   real size once the app returns to the foreground, instead of being
 *   stuck at whatever size (or the PTY's own default) it had before.
 *
 * Two more rules, both about not racing the daemon with resize traffic:
 *
 *   - Rapid measurements (device rotation, the soft keyboard opening,
 *     layout settling) are debounced to one claim, not one frame per
 *     measurement.
 *   - A claim is only sent when the size actually changed from the last
 *     one this controller successfully claimed — except across a
 *     reconnect, where the daemon's own PTY may have come back at a
 *     different (or default) size, so the dedup memory is cleared and
 *     the next claim always sends even if it repeats the last one.
 *
 * T35B3 adds one more guard, aimed at rotation specifically: a device
 * mid-rotation (or a soft keyboard opening/closing) can hand the
 * embedded `fit` addon a transiently degenerate viewport for one or two
 * layout passes — zero or negative rows/cols — before it settles. The
 * wire shape this controller's claims travel in,
 * `TerminalStreamResizeSchema` (`@picompanion/protocol/binary-frames/
 * terminal`), requires `rows`/`cols` to be positive integers, and the
 * daemon applies that exact schema on receipt
 * (`decodeTerminalResizePayload` in `packages/server/src/terminal/
 * terminal-session-controller.ts`'s `Resize`-opcode handler): a claim
 * that fails it is silently dropped server-side, fire-and-forget, with
 * no rejection ever sent back to the client. Rather than let a
 * degenerate measurement round-trip to a silent drop, `setSize` here
 * validates against that same schema and ignores a size that would fail
 * it — `currentSize` (and therefore the next real claim) is left exactly
 * as it was, so a transient garbage sample during rotation can neither
 * overwrite a good retained size nor produce a claim the daemon would
 * have rejected anyway.
 */

export interface TerminalResizeReadiness {
  /** This screen is the foregrounded, actively visible route — not backgrounded, not covered. */
  readonly isVisible: boolean;
  /** The binary transport to the daemon is open. */
  readonly isConnected: boolean;
  /** The embedded WebView terminal has reported `onReady` and can accept a resize. */
  readonly isTerminalReady: boolean;
}

const NOT_READY: TerminalResizeReadiness = {
  isVisible: false,
  isConnected: false,
  isTerminalReady: false,
};

/**
 * `"claim"` is the only intent this controller ever emits — see module
 * doc. The field still carries `TerminalStreamResizeSchema`'s real wire
 * vocabulary (`@picompanion/protocol/binary-frames/terminal`), including
 * the `"update"` value this single-owner screen never sends, so
 * `terminal-session-controller.ts` can encode a claim without a second
 * lookup table, and a future multi-observer feature can start sending
 * `"update"` without changing this type.
 */
export type TerminalResizeIntent = "claim" | "update";

export interface TerminalResizeClaim extends TerminalSize {
  readonly intent: TerminalResizeIntent;
}

export interface TerminalResizeControllerOptions {
  /** Coalescing window for rapid measurements, in milliseconds. */
  readonly debounceMs: number;
  readonly clock: Clock;
  readonly onClaim: (claim: TerminalResizeClaim) => void;
}

export class TerminalResizeController {
  private readonly options: TerminalResizeControllerOptions;
  private readiness: TerminalResizeReadiness = NOT_READY;
  private currentSize: TerminalSize | null = null;
  private lastClaimedSize: TerminalSize | null = null;
  private timer: TimerHandle | null = null;

  constructor(options: TerminalResizeControllerOptions) {
    this.options = options;
  }

  private get isReady(): boolean {
    return this.readiness.isVisible && this.readiness.isConnected && this.readiness.isTerminalReady;
  }

  /**
   * Reports a newly measured screen size. Retained even while not ready
   * — never dropped — unless it fails the wire schema (see class doc),
   * in which case it is ignored outright and the last valid size (if
   * any) stands.
   */
  setSize(size: TerminalSize): void {
    if (!TerminalStreamResizeSchema.pick({ rows: true, cols: true }).safeParse(size).success) {
      return;
    }
    this.currentSize = size;
    this.armTimer();
  }

  /** Reports a readiness change (visibility, connection, or terminal-ready). */
  setReadiness(readiness: TerminalResizeReadiness): void {
    const wasConnected = this.readiness.isConnected;
    this.readiness = readiness;

    if (readiness.isConnected && !wasConnected) {
      // Reconnected: the daemon's PTY may not be at the size we last
      // claimed (it may have restarted at its own default), so the next
      // claim must send even if it repeats `lastClaimedSize`.
      this.lastClaimedSize = null;
    }

    if (!this.isReady) {
      // Not ready: cancel any in-flight claim so it can't fire while
      // backgrounded/disconnected/not-yet-ready. `currentSize` is kept.
      this.cancelTimer();
      return;
    }

    this.armTimer();
  }

  private armTimer(): void {
    if (!this.isReady || this.currentSize === null) {
      return;
    }
    this.cancelTimer();
    this.timer = this.options.clock.setTimeout(() => {
      this.timer = null;
      this.emitClaim();
    }, this.options.debounceMs);
  }

  private emitClaim(): void {
    const size = this.currentSize;
    if (size === null) {
      return;
    }
    if (
      this.lastClaimedSize !== null &&
      this.lastClaimedSize.rows === size.rows &&
      this.lastClaimedSize.cols === size.cols
    ) {
      return;
    }
    this.lastClaimedSize = size;
    this.options.onClaim({ rows: size.rows, cols: size.cols, intent: "claim" });
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.options.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.cancelTimer();
  }
}
