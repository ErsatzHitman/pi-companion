import { TerminalStreamOpcode } from "@picompanion/protocol/binary-frames/index";
import { describe, expect, test } from "vitest";

import { TerminalStreamRouter, type TerminalStreamEvent } from "./terminal-stream-router.js";

describe("terminal-stream-router", () => {
  test("routes restore frames as restore events", () => {
    const router = new TerminalStreamRouter();
    const events: TerminalStreamEvent[] = [];
    const payload = new TextEncoder().encode("restored screen");

    router.setSlot("term-1", 7);
    router.onEvent((event) => events.push(event));
    router.handleFrame({
      opcode: TerminalStreamOpcode.Restore,
      slot: 7,
      payload,
    });

    expect(events).toEqual([
      {
        terminalId: "term-1",
        type: "restore",
        data: payload,
      },
    ]);
  });

  test("a frame for an unmapped slot lands as a named drop, not an exception, and emits no event", () => {
    const router = new TerminalStreamRouter();
    const events: TerminalStreamEvent[] = [];
    const drops: Array<{ reason: string; slot: number }> = [];
    router.onEvent((event) => events.push(event));
    router.onDrop((reason, slot) => drops.push({ reason, slot }));

    expect(() =>
      router.handleFrame({
        opcode: TerminalStreamOpcode.Output,
        slot: 42,
        payload: new TextEncoder().encode("nobody is listening"),
      }),
    ).not.toThrow();

    expect(events).toEqual([]);
    expect(drops).toEqual([{ reason: "unmapped-slot", slot: 42 }]);
  });

  test("a frame for a terminal closed locally (slot removed) also lands as a named drop", () => {
    const router = new TerminalStreamRouter();
    const events: TerminalStreamEvent[] = [];
    const drops: Array<{ reason: string; slot: number }> = [];
    router.setSlot("term-1", 9);
    router.removeTerminal("term-1");
    router.onEvent((event) => events.push(event));
    router.onDrop((reason, slot) => drops.push({ reason, slot }));

    router.handleFrame({
      opcode: TerminalStreamOpcode.Output,
      slot: 9,
      payload: new TextEncoder().encode("late arrival"),
    });

    expect(events).toEqual([]);
    expect(drops).toEqual([{ reason: "unmapped-slot", slot: 9 }]);
  });

  test("an undecodable snapshot payload lands as a named drop instead of a silent no-op", () => {
    const router = new TerminalStreamRouter();
    const drops: Array<{ reason: string; slot: number }> = [];
    router.setSlot("term-1", 3);
    router.onDrop((reason, slot) => drops.push({ reason, slot }));

    router.handleFrame({
      opcode: TerminalStreamOpcode.Snapshot,
      slot: 3,
      payload: new TextEncoder().encode("not json"),
    });

    expect(drops).toEqual([{ reason: "undecodable-snapshot", slot: 3 }]);
  });

  test("encodeInputFrame carries already-encoded bytes verbatim without the string-typed JSON message shape", () => {
    const router = new TerminalStreamRouter();
    router.setSlot("term-1", 5);
    const bytes = new Uint8Array([0x1b, 0x5b, 0x41]); // an already-encoded control sequence

    const frame = router.encodeInputFrame("term-1", bytes);

    expect(frame).not.toBeNull();
    const decoded = TerminalStreamOpcode.Input === frame![0] ? frame!.subarray(2) : null;
    expect(decoded).toEqual(bytes);
    expect(frame![1]).toBe(5);
  });

  test("encodeInputFrame returns null for a terminal with no known slot", () => {
    const router = new TerminalStreamRouter();
    expect(router.encodeInputFrame("unknown-terminal", new Uint8Array([1]))).toBeNull();
  });
});
