import {
  decodeTerminalSnapshotPayload,
  encodeTerminalResizePayload,
  encodeTerminalStreamFrame,
  TerminalStreamOpcode,
  type TerminalStreamFrame,
} from "@picompanion/protocol/binary-frames/index";
import type { TerminalInput, TerminalState } from "@picompanion/protocol/messages";

export type TerminalStreamEvent =
  | { terminalId: string; type: "output"; data: Uint8Array }
  | { terminalId: string; type: "snapshot"; state: TerminalState }
  | { terminalId: string; type: "restore"; data: Uint8Array };

/**
 * Why an inbound terminal binary frame was not routed to any terminal
 * (T62, `DaemonClient.onTerminalFrameDropped`). Both reasons collapse to
 * the same mechanical cause — `frame.slot` has no entry in
 * `slotTerminals` — because a terminal this connection never subscribed
 * to and a terminal this connection already closed locally (`close()`
 * calls `removeTerminal`, which erases the slot mapping immediately,
 * before the daemon's own unsubscribe has necessarily landed) are
 * indistinguishable from the router's point of view: neither has a slot
 * to route through. Named here as one reason rather than two only
 * because there is no third bit of information that would ever let a
 * caller tell them apart.
 *
 * Deliberately carries only `slot` (the wire multiplexing index, 0-255)
 * — never the frame's payload, its byte length, or a terminal id. Slot
 * numbers are reused across unrelated terminals over a connection's
 * lifetime and carry no content of their own.
 */
export type TerminalStreamDropReason = "unmapped-slot" | "undecodable-snapshot";

export class TerminalStreamRouter {
  private readonly terminalSlots = new Map<string, number>();
  private readonly slotTerminals = new Map<number, string>();
  private readonly listeners = new Set<(event: TerminalStreamEvent) => void>();
  private readonly dropListeners = new Set<
    (reason: TerminalStreamDropReason, slot: number) => void
  >();

  onEvent(handler: (event: TerminalStreamEvent) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  /** See `TerminalStreamDropReason` for what this fires for and why it never carries content. */
  onDrop(handler: (reason: TerminalStreamDropReason, slot: number) => void): () => void {
    this.dropListeners.add(handler);
    return () => {
      this.dropListeners.delete(handler);
    };
  }

  setSlot(terminalId: string, slot: number): void {
    const existingTerminalId = this.slotTerminals.get(slot);
    if (existingTerminalId && existingTerminalId !== terminalId) {
      this.terminalSlots.delete(existingTerminalId);
    }

    const existingSlot = this.terminalSlots.get(terminalId);
    if (typeof existingSlot === "number" && existingSlot !== slot) {
      this.slotTerminals.delete(existingSlot);
    }

    this.terminalSlots.set(terminalId, slot);
    this.slotTerminals.set(slot, terminalId);
  }

  removeTerminal(terminalId: string): void {
    const slot = this.terminalSlots.get(terminalId);
    if (typeof slot !== "number") {
      return;
    }
    this.terminalSlots.delete(terminalId);
    if (this.slotTerminals.get(slot) === terminalId) {
      this.slotTerminals.delete(slot);
    }
  }

  clearSlots(): void {
    this.terminalSlots.clear();
    this.slotTerminals.clear();
  }

  encodeInput(terminalId: string, message: TerminalInput["message"]): Uint8Array | null {
    const slot = this.terminalSlots.get(terminalId);
    if (typeof slot !== "number") {
      return null;
    }

    if (message.type === "input") {
      return encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Input,
        slot,
        payload: message.data,
      });
    }

    if (message.type === "resize") {
      return encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Resize,
        slot,
        payload: encodeTerminalResizePayload({
          rows: message.rows,
          cols: message.cols,
          ...(message.intent ? { intent: message.intent } : {}),
        }),
      });
    }

    return null;
  }

  /**
   * Encodes one Input frame straight from already-computed bytes (or
   * text), bypassing `encodeInput`'s `TerminalInput["message"]` shape —
   * that shape's `data` is `z.string()`, sized for the JSON-fallback
   * path `sendTerminalInput` also supports, not for a byte-precise
   * caller. Used by `TerminalSessionRegistry` (`terminal-session.ts`)
   * so a caller that has already encoded a control sequence (e.g. a
   * hardware key event) never has to round-trip it through a string.
   */
  encodeInputFrame(terminalId: string, data: Uint8Array | string): Uint8Array | null {
    const slot = this.terminalSlots.get(terminalId);
    if (typeof slot !== "number") {
      return null;
    }
    return encodeTerminalStreamFrame({
      opcode: TerminalStreamOpcode.Input,
      slot,
      payload: data,
    });
  }

  handleFrame(frame: TerminalStreamFrame): void {
    const terminalId = this.slotTerminals.get(frame.slot);
    if (!terminalId) {
      this.emitDrop("unmapped-slot", frame.slot);
      return;
    }

    if (frame.opcode === TerminalStreamOpcode.Output) {
      this.emit({
        terminalId,
        type: "output",
        data: frame.payload,
      });
      return;
    }

    if (frame.opcode === TerminalStreamOpcode.Restore) {
      this.emit({
        terminalId,
        type: "restore",
        data: frame.payload,
      });
      return;
    }

    if (frame.opcode === TerminalStreamOpcode.Snapshot) {
      const state = decodeTerminalSnapshotPayload(frame.payload);
      if (!state) {
        this.emitDrop("undecodable-snapshot", frame.slot);
        return;
      }
      this.emit({
        terminalId,
        type: "snapshot",
        state,
      });
    }
  }

  private emit(event: TerminalStreamEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // no-op
      }
    }
  }

  private emitDrop(reason: TerminalStreamDropReason, slot: number): void {
    for (const listener of this.dropListeners) {
      try {
        listener(reason, slot);
      } catch {
        // no-op
      }
    }
  }
}
