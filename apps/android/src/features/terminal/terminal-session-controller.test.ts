import type { Clock, TimerHandle } from "@picompanion/frontend-core";
import {
  decodeTerminalResizePayload,
  decodeTerminalStreamFrame,
  encodeTerminalSnapshotPayload,
  encodeTerminalStreamFrame,
  TerminalStreamOpcode,
} from "@picompanion/protocol/binary-frames/index";
import type { TerminalState } from "@picompanion/protocol/messages";
import { describe, expect, it } from "vitest";

import type { TerminalBinaryTransport } from "./terminal-binary-transport";
import { TerminalSessionController } from "./terminal-session-controller";
import type { TerminalSize, TerminalWebViewPort } from "./terminal-webview-port";

/** Deterministic, manually-advanced `Clock` test double, local to this file. */
class FakeClock implements Clock {
  private currentTime = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { dueAt: number; callback: () => void }>();

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { dueAt: this.currentTime + delayMs, callback });
    return id as unknown as TimerHandle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }

  setInterval(): TimerHandle {
    throw new Error("not used");
  }

  clearInterval(): void {
    throw new Error("not used");
  }

  advance(ms: number): void {
    this.currentTime += ms;
    const due = [...this.timers.entries()]
      .filter(([, t]) => t.dueAt <= this.currentTime)
      .sort((a, b) => a[1].dueAt - b[1].dueAt);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
  }
}

/** A `TerminalBinaryTransport` test double: a scripted, injectable fake — not a real socket. */
class FakeTransport implements TerminalBinaryTransport {
  isOpen = false;
  readonly sent: Uint8Array[] = [];
  /** T65: records `dispose()` calls — proves the controller actually reaches the transport's dispose hook on teardown. */
  disposeCalls = 0;
  private frameHandlers = new Set<(frame: Uint8Array) => void>();
  private openHandlers = new Set<(isOpen: boolean) => void>();

  send(frame: Uint8Array): void {
    this.sent.push(frame);
  }

  dispose(): "disposed" {
    this.disposeCalls += 1;
    return "disposed";
  }

  onFrame(handler: (frame: Uint8Array) => void): () => void {
    this.frameHandlers.add(handler);
    return () => this.frameHandlers.delete(handler);
  }

  onOpenChange(handler: (isOpen: boolean) => void): () => void {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
  }

  /** Test helper: simulates the daemon delivering one binary frame. */
  deliver(frame: Uint8Array): void {
    for (const handler of this.frameHandlers) handler(frame);
  }

  /** Test helper: simulates connect/disconnect. */
  setOpen(isOpen: boolean): void {
    this.isOpen = isOpen;
    for (const handler of this.openHandlers) handler(isOpen);
  }
}

/** A `TerminalWebViewPort` test double standing in for an embedded xterm.js page. */
class FakeWebViewPort implements TerminalWebViewPort {
  isAvailable = true;
  readonly writes: Uint8Array[] = [];
  readonly restores: TerminalState[] = [];
  readonly resizes: TerminalSize[] = [];
  disposed = false;
  private readyHandlers = new Set<() => void>();
  private inputHandlers = new Set<(bytes: Uint8Array) => void>();
  private sizeHandlers = new Set<(size: TerminalSize) => void>();

  write(bytes: Uint8Array): void {
    this.writes.push(bytes);
  }

  restore(state: TerminalState): void {
    this.restores.push(state);
  }

  setTheme(): void {
    // Not exercised by this test file — see terminal-theme.test.ts.
  }

  resize(size: TerminalSize): void {
    this.resizes.push(size);
  }

  onReady(handler: () => void): () => void {
    this.readyHandlers.add(handler);
    return () => this.readyHandlers.delete(handler);
  }

  onInput(handler: (bytes: Uint8Array) => void): () => void {
    this.inputHandlers.add(handler);
    return () => this.inputHandlers.delete(handler);
  }

  onMeasuredSize(handler: (size: TerminalSize) => void): () => void {
    this.sizeHandlers.add(handler);
    return () => this.sizeHandlers.delete(handler);
  }

  dispose(): void {
    this.disposed = true;
  }

  /** Test helper: simulates the page's xterm.js finishing initialization. */
  fireReady(): void {
    for (const handler of this.readyHandlers) handler();
  }

  /** Test helper: simulates a keystroke/paste inside the terminal. */
  fireInput(bytes: Uint8Array): void {
    for (const handler of this.inputHandlers) handler(bytes);
  }

  /** Test helper: simulates the fit addon reporting a new measured size. */
  fireMeasuredSize(size: TerminalSize): void {
    for (const handler of this.sizeHandlers) handler(size);
  }
}

const SLOT = 0;

function createHarness(debounceMs = 100) {
  const clock = new FakeClock();
  const transport = new FakeTransport();
  const webview = new FakeWebViewPort();
  const controller = new TerminalSessionController({
    transport,
    webview,
    slot: SLOT,
    resizeDebounceMs: debounceMs,
    clock,
  });
  return { clock, transport, webview, controller };
}

const SNAPSHOT_STATE: TerminalState = {
  rows: 24,
  cols: 80,
  grid: [[{ char: "$" }]],
  scrollback: [],
  cursor: { row: 0, col: 1 },
};

/** Test helper: simulates the daemon's connection-opening catch-up frame landing. */
function deliverCatchUpSnapshot(
  transport: FakeTransport,
  state: TerminalState = SNAPSHOT_STATE,
): void {
  transport.deliver(
    encodeTerminalStreamFrame({
      opcode: TerminalStreamOpcode.Snapshot,
      slot: SLOT,
      payload: encodeTerminalSnapshotPayload(state),
    }),
  );
}

describe("TerminalSessionController — rendering (daemon → webview)", () => {
  it("writes a decoded Output frame's payload straight into the webview once ready and caught up", () => {
    const { transport, webview } = createHarness();
    webview.fireReady();
    deliverCatchUpSnapshot(transport);
    const payload = new TextEncoder().encode("hello from the pty\r\n");
    transport.deliver(
      encodeTerminalStreamFrame({ opcode: TerminalStreamOpcode.Output, slot: SLOT, payload }),
    );

    expect(webview.writes).toHaveLength(1);
    expect(webview.writes[0]).toEqual(payload);
  });

  it("decodes a Snapshot frame's JSON payload and calls restore with the typed TerminalState", () => {
    const { transport, webview } = createHarness();
    webview.fireReady();
    transport.deliver(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Snapshot,
        slot: SLOT,
        payload: encodeTerminalSnapshotPayload(SNAPSHOT_STATE),
      }),
    );

    expect(webview.restores).toHaveLength(1);
    expect(webview.restores[0]).toEqual(SNAPSHOT_STATE);
  });

  it("writes a Restore frame's raw bytes the same way as Output", () => {
    const { transport, webview } = createHarness();
    webview.fireReady();
    const payload = new Uint8Array([27, 91, 50, 74]); // an escape sequence, not text
    transport.deliver(
      encodeTerminalStreamFrame({ opcode: TerminalStreamOpcode.Restore, slot: SLOT, payload }),
    );

    expect(webview.writes).toHaveLength(1);
    expect(webview.writes[0]).toEqual(payload);
  });

  it("ignores a frame addressed to a different slot", () => {
    const { transport, webview } = createHarness();
    webview.fireReady();
    transport.deliver(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Output,
        slot: SLOT + 1,
        payload: new TextEncoder().encode("not for us"),
      }),
    );
    expect(webview.writes).toHaveLength(0);
  });

  it("ignores an undecodable frame instead of throwing", () => {
    const { transport, webview } = createHarness();
    webview.fireReady();
    expect(() => transport.deliver(new Uint8Array([]))).not.toThrow();
    expect(webview.writes).toHaveLength(0);
  });
});

describe("TerminalSessionController — backpressure (frames before the webview is ready)", () => {
  it("queues an Output frame delivered before onReady instead of writing it early, then flushes it once ready fires", () => {
    const { transport, webview } = createHarness();
    deliverCatchUpSnapshot(transport); // also queued — the webview isn't ready yet
    const payload = new TextEncoder().encode("early output");
    transport.deliver(
      encodeTerminalStreamFrame({ opcode: TerminalStreamOpcode.Output, slot: SLOT, payload }),
    );
    // Never called into a webview port that hasn't reported ready — the
    // port's own contract ("must never be called before onReady").
    expect(webview.writes).toHaveLength(0);
    expect(webview.restores).toHaveLength(0);

    webview.fireReady();
    expect(webview.restores).toEqual([SNAPSHOT_STATE]);
    expect(webview.writes).toHaveLength(1);
    expect(webview.writes[0]).toEqual(payload);
  });

  it("flushes several queued frames in the exact order they were delivered, behind the catch-up frame that unlocked them", () => {
    const { transport, webview } = createHarness();
    deliverCatchUpSnapshot(transport);
    const first = new TextEncoder().encode("one");
    const second = new TextEncoder().encode("two");
    transport.deliver(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Output,
        slot: SLOT,
        payload: first,
      }),
    );
    transport.deliver(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Output,
        slot: SLOT,
        payload: second,
      }),
    );
    expect(webview.writes).toHaveLength(0);

    webview.fireReady();
    expect(webview.restores).toEqual([SNAPSHOT_STATE]);
    expect(webview.writes).toEqual([first, second]);
  });

  it("a Snapshot queued before ready supersedes Output queued ahead of it, and is what gets applied", () => {
    const { transport, webview } = createHarness();
    transport.deliver(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Output,
        slot: SLOT,
        payload: new TextEncoder().encode("stale, pre-snapshot output"),
      }),
    );
    deliverCatchUpSnapshot(transport);

    webview.fireReady();
    // The stale Output that predates the snapshot is never applied — only
    // the snapshot itself, matching TerminalOutputBuffer's stated policy.
    expect(webview.writes).toHaveLength(0);
    expect(webview.restores).toEqual([SNAPSHOT_STATE]);
  });

  it("never applies queued Output early even once ready, if no catch-up frame has reached this connection at all yet", () => {
    const { transport, webview } = createHarness();
    transport.deliver(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Output,
        slot: SLOT,
        payload: new TextEncoder().encode("no catch-up has ever arrived"),
      }),
    );
    webview.fireReady();
    // isTerminalReady is now true, but this connection has never applied a
    // catch-up frame — the queued Output must still wait rather than
    // render onto an unknown baseline.
    expect(webview.writes).toHaveLength(0);

    deliverCatchUpSnapshot(transport);
    expect(webview.restores).toEqual([SNAPSHOT_STATE]);
    expect(webview.writes).toHaveLength(1);
  });

  it("a flood of Output frames before ready never wedges the controller: bounded buffering, oldest dropped, reader never blocked", () => {
    const { transport, webview } = createHarness();
    deliverCatchUpSnapshot(transport); // arrives first, as the daemon always sends it before Output
    const CHUNK_BYTES = 64 * 1024;
    const FLOOD_FRAMES = 200; // 200 * 64 KiB = 12.5 MiB — over the 8 MiB hard cap
    const start = Date.now();
    for (let i = 0; i < FLOOD_FRAMES; i += 1) {
      const payload = new Uint8Array(CHUNK_BYTES).fill(i % 256);
      // deliver() is a synchronous call into handleTransportFrame; no
      // timer, no Promise, nothing here can block on the webview draining.
      transport.deliver(
        encodeTerminalStreamFrame({ opcode: TerminalStreamOpcode.Output, slot: SLOT, payload }),
      );
    }
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(5000); // the reader was never blocked waiting on anything

    // Nothing was applied to the (not-yet-ready) webview during the flood.
    expect(webview.writes).toHaveLength(0);

    webview.fireReady();
    expect(webview.restores).toEqual([SNAPSHOT_STATE]);
    // Bounded: fewer frames were kept than were sent, because the oldest
    // were dropped once the buffer's stated hard cap was crossed.
    expect(webview.writes.length).toBeGreaterThan(0);
    expect(webview.writes.length).toBeLessThan(FLOOD_FRAMES);
    const totalAppliedBytes = webview.writes.reduce((sum, w) => sum + w.byteLength, 0);
    expect(totalAppliedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    // The retained frames are the most recent ones sent (FIFO drop), not
    // an arbitrary subset — the last frame sent must be the last applied.
    const lastSentTag = (FLOOD_FRAMES - 1) % 256;
    const lastApplied = webview.writes[webview.writes.length - 1];
    expect(lastApplied[0]).toBe(lastSentTag);
  });
});

describe("TerminalSessionController — accepting input (webview → daemon)", () => {
  it("encodes a keystroke as an Input frame on the real slot and sends it once connected", () => {
    const { transport, webview } = createHarness();
    transport.setOpen(true);
    webview.fireInput(new TextEncoder().encode("ls\n"));

    expect(transport.sent).toHaveLength(1);
    const frame = decodeTerminalStreamFrame(transport.sent[0]);
    expect(frame?.opcode).toBe(TerminalStreamOpcode.Input);
    expect(frame?.slot).toBe(SLOT);
    expect(new TextDecoder().decode(frame?.payload)).toBe("ls\n");
  });

  it("drops input rather than sending it while the transport is not open", () => {
    const { transport, webview } = createHarness();
    // transport.isOpen defaults to false — never opened in this test.
    webview.fireInput(new TextEncoder().encode("ls\n"));
    expect(transport.sent).toHaveLength(0);
  });
});

describe("TerminalSessionController — hardware-keyboard/accessory-bar input (T35B3)", () => {
  it("encodes a hardware Ctrl+C the same way the daemon's own terminal-key-input encoder expects, as an Input frame", () => {
    const { transport, controller } = createHarness();
    transport.setOpen(true);
    controller.sendHardwareKeyInput({ key: "c", ctrl: true });

    expect(transport.sent).toHaveLength(1);
    const frame = decodeTerminalStreamFrame(transport.sent[0]);
    expect(frame?.opcode).toBe(TerminalStreamOpcode.Input);
    expect(frame?.slot).toBe(SLOT);
    // Ctrl+C is byte 0x03 (ETX) — the exact byte a soft keyboard could
    // never send, since it has no "hold Ctrl" gesture of its own.
    expect(frame?.payload).toEqual(new Uint8Array([0x03]));
  });

  it("encodes hardware arrow/function keys a soft keyboard's text input cannot express, as real CSI escape sequences", () => {
    const { transport, controller } = createHarness();
    transport.setOpen(true);

    controller.sendHardwareKeyInput({ key: "ArrowUp" });
    controller.sendHardwareKeyInput({ key: "Escape" });
    controller.sendHardwareKeyInput({ key: "F5" });

    expect(transport.sent).toHaveLength(3);
    const payloads = transport.sent.map((bytes) => {
      const frame = decodeTerminalStreamFrame(bytes);
      return new TextDecoder().decode(frame?.payload);
    });
    expect(payloads).toEqual(["\x1b[A", "\x1b", "\x1b[15~"]);
  });

  it("sends a hardware key over the identical Input opcode/slot a soft-keyboard keystroke uses — one convergent wire path", () => {
    const { transport, webview, controller } = createHarness();
    transport.setOpen(true);

    webview.fireInput(new TextEncoder().encode("a"));
    controller.sendHardwareKeyInput({ key: "a" });

    expect(transport.sent).toHaveLength(2);
    const [softFrame, hardwareFrame] = transport.sent.map(decodeTerminalStreamFrame);
    expect(softFrame?.opcode).toBe(hardwareFrame?.opcode);
    expect(softFrame?.slot).toBe(hardwareFrame?.slot);
    expect(softFrame?.payload).toEqual(hardwareFrame?.payload);
  });

  it("drops a hardware key the same way as WebView input while the transport is not open", () => {
    const { transport, controller } = createHarness();
    // transport.isOpen defaults to false.
    controller.sendHardwareKeyInput({ key: "c", ctrl: true });
    expect(transport.sent).toHaveLength(0);
  });

  it("sends nothing for a key the encoder cannot represent, rather than an empty Input frame", () => {
    const { transport, controller } = createHarness();
    transport.setOpen(true);
    controller.sendHardwareKeyInput({ key: "" });
    expect(transport.sent).toHaveLength(0);
  });
});

describe("TerminalSessionController — resize ownership", () => {
  it("claims a resize only once visible+connected+ready+caught-up, as a real Resize frame with intent 'claim'", () => {
    const { clock, transport, webview, controller } = createHarness(100);
    controller.setVisible(true);
    transport.setOpen(true);
    webview.fireReady();
    deliverCatchUpSnapshot(transport);
    webview.fireMeasuredSize({ rows: 40, cols: 120 });

    expect(transport.sent).toHaveLength(0); // still debouncing
    clock.advance(100);

    expect(transport.sent).toHaveLength(1);
    const frame = decodeTerminalStreamFrame(transport.sent[0]);
    expect(frame?.opcode).toBe(TerminalStreamOpcode.Resize);
    expect(frame?.slot).toBe(SLOT);
    const resize = frame ? decodeTerminalResizePayload(frame.payload) : null;
    expect(resize).toEqual({ rows: 40, cols: 120, intent: "claim" });
  });

  it("never claims before the webview reports ready, even if visible, connected, and caught up", () => {
    const { clock, transport, webview, controller } = createHarness(100);
    controller.setVisible(true);
    transport.setOpen(true);
    webview.fireMeasuredSize({ rows: 40, cols: 120 }); // no fireReady()
    clock.advance(1000);
    expect(transport.sent).toHaveLength(0);
  });

  it("never claims once the transport is open until this connection's catch-up frame has landed", () => {
    const { clock, transport, webview, controller } = createHarness(100);
    controller.setVisible(true);
    transport.setOpen(true);
    webview.fireReady();
    webview.fireMeasuredSize({ rows: 40, cols: 120 });
    clock.advance(1000);
    // Transport open, webview ready, visible, a size measured — everything
    // except the catch-up frame. No claim yet.
    expect(transport.sent).toHaveLength(0);

    deliverCatchUpSnapshot(transport);
    clock.advance(100);
    expect(transport.sent).toHaveLength(1);
  });

  it("claims a size measured while backgrounded once the screen becomes visible again", () => {
    const { clock, transport, webview, controller } = createHarness(100);
    transport.setOpen(true);
    webview.fireReady();
    deliverCatchUpSnapshot(transport);
    // Not yet visible — controller starts with isVisible = false.
    webview.fireMeasuredSize({ rows: 50, cols: 132 });
    clock.advance(1000);
    expect(transport.sent).toHaveLength(0);

    controller.setVisible(true);
    clock.advance(100);
    expect(transport.sent).toHaveLength(1);
    const frame = decodeTerminalStreamFrame(transport.sent[0]);
    const resize = frame ? decodeTerminalResizePayload(frame.payload) : null;
    expect(resize).toEqual({ rows: 50, cols: 132, intent: "claim" });
  });
});

describe("TerminalSessionController — rotation does not corrupt the buffer (T35B3)", () => {
  it("a rotation mid-flood leaves the output buffer's FIFO-drop bound exactly as it is without any rotation", () => {
    const { transport, webview } = createHarness();
    deliverCatchUpSnapshot(transport); // not yet ready — Output queues in the buffer
    const CHUNK_BYTES = 64 * 1024;
    const FLOOD_FRAMES = 200; // 12.5 MiB of Output — over the 8 MiB hard cap
    for (let i = 0; i < FLOOD_FRAMES; i += 1) {
      // A rotation's measured-size events race the flood every 10 frames —
      // this is the interleaving itself, not a separate phase.
      if (i % 10 === 0) {
        webview.fireMeasuredSize({ rows: 24 + (i % 5), cols: 80 });
      }
      const payload = new Uint8Array(CHUNK_BYTES).fill(i % 256);
      transport.deliver(
        encodeTerminalStreamFrame({ opcode: TerminalStreamOpcode.Output, slot: SLOT, payload }),
      );
    }
    webview.fireMeasuredSize({ rows: 45, cols: 132 }); // rotation settles

    webview.fireReady();
    expect(webview.restores).toEqual([SNAPSHOT_STATE]);
    // Identical bound to the rotation-free flood test: the interleaved
    // resize measurements never touched the output buffer's bytes.
    const totalAppliedBytes = webview.writes.reduce((sum, w) => sum + w.byteLength, 0);
    expect(totalAppliedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(webview.writes.length).toBeGreaterThan(0);
    expect(webview.writes.length).toBeLessThan(FLOOD_FRAMES);
    const lastSentTag = (FLOOD_FRAMES - 1) % 256;
    expect(webview.writes[webview.writes.length - 1][0]).toBe(lastSentTag);
  });

  it("two rotations in quick succession inside the debounce window still collapse to one Resize frame with the final size", () => {
    const { clock, transport, webview, controller } = createHarness(150);
    controller.setVisible(true);
    transport.setOpen(true);
    webview.fireReady();
    deliverCatchUpSnapshot(transport);

    webview.fireMeasuredSize({ rows: 24, cols: 80 }); // portrait
    clock.advance(50);
    webview.fireMeasuredSize({ rows: 30, cols: 100 }); // mid-rotation transient
    clock.advance(50);
    webview.fireMeasuredSize({ rows: 45, cols: 132 }); // landscape, settled
    clock.advance(50); // 150ms elapsed since the first measurement, but only 50 since the last

    expect(transport.sent).toHaveLength(0); // still debouncing off the last measurement
    clock.advance(100);

    expect(transport.sent).toHaveLength(1); // one claim, not three
    const frame = decodeTerminalStreamFrame(transport.sent[0]);
    const resize = frame ? decodeTerminalResizePayload(frame.payload) : null;
    expect(resize).toEqual({ rows: 45, cols: 132, intent: "claim" });
  });

  it("a rotation's degenerate transient frame (the shape the daemon's own schema would reject) is silently ignored, and the next valid claim still lands", () => {
    const { clock, transport, webview, controller } = createHarness(100);
    controller.setVisible(true);
    transport.setOpen(true);
    webview.fireReady();
    deliverCatchUpSnapshot(transport);

    // Mid-rotation, the fit addon reports zero rows for one layout pass —
    // a size `TerminalStreamResizeSchema` requires positive integers for,
    // so the daemon would silently drop it if it were ever sent.
    webview.fireMeasuredSize({ rows: 0, cols: 80 });
    clock.advance(100);
    expect(transport.sent).toHaveLength(0); // never sent at all

    // The very next (valid) measurement claims normally — the degenerate
    // sample did not corrupt the controller's retained size, the output
    // buffer, or any later claim.
    webview.fireMeasuredSize({ rows: 45, cols: 132 });
    clock.advance(100);
    expect(transport.sent).toHaveLength(1);
    const frame = decodeTerminalStreamFrame(transport.sent[0]);
    const resize = frame ? decodeTerminalResizePayload(frame.payload) : null;
    expect(resize).toEqual({ rows: 45, cols: 132, intent: "claim" });
    // And output delivered around the rejected claim was applied normally.
    const payload = new TextEncoder().encode("still rendering\r\n");
    transport.deliver(
      encodeTerminalStreamFrame({ opcode: TerminalStreamOpcode.Output, slot: SLOT, payload }),
    );
    expect(webview.writes.at(-1)).toEqual(payload);
  });
});

describe("TerminalSessionController — disconnect/reconnect ordering", () => {
  it("replays the reconnect's catch-up frame before any resize claim can be sent, even when a stale size was already measured", () => {
    const { clock, transport, webview, controller } = createHarness(100);
    controller.setVisible(true);
    transport.setOpen(true);
    webview.fireReady();
    deliverCatchUpSnapshot(transport, { ...SNAPSHOT_STATE, rows: 24, cols: 80 });
    webview.fireMeasuredSize({ rows: 24, cols: 80 });
    clock.advance(100);
    expect(transport.sent).toHaveLength(1); // the first connection's claim

    // Disconnect. A rotation is measured locally WHILE disconnected — this
    // must be retained (T35B1's "stuck size" rule), not dropped.
    transport.setOpen(false);
    webview.fireMeasuredSize({ rows: 30, cols: 100 });
    clock.advance(1000);
    expect(transport.sent).toHaveLength(1); // still just the first claim

    // Reconnect: the transport is open again, but this connection's own
    // catch-up frame has not landed yet.
    transport.setOpen(true);
    clock.advance(1000); // even with the debounce window well elapsed...
    expect(transport.sent).toHaveLength(1); // ...no second claim races ahead of the restore.
    expect(webview.restores).toHaveLength(1); // still only the first connection's restore.

    // Now the reconnect's own catch-up frame lands.
    deliverCatchUpSnapshot(transport, { ...SNAPSHOT_STATE, rows: 24, cols: 80 });
    expect(webview.restores).toHaveLength(2); // the restore always happens before the claim below.

    clock.advance(100);
    expect(transport.sent).toHaveLength(2);
    const frame = decodeTerminalStreamFrame(transport.sent[1]);
    const resize = frame ? decodeTerminalResizePayload(frame.payload) : null;
    // The retained (real, current) local measurement is what gets claimed
    // — not clobbered by the snapshot's own (possibly stale) rows/cols.
    expect(resize).toEqual({ rows: 30, cols: 100, intent: "claim" });
  });

  it("resumes streaming Output only after the reconnect's Restore/Snapshot catch-up frame, never before", () => {
    const { transport, webview } = createHarness(100);
    transport.setOpen(true);
    webview.fireReady();
    deliverCatchUpSnapshot(transport);
    transport.deliver(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Output,
        slot: SLOT,
        payload: new TextEncoder().encode("pre-disconnect output"),
      }),
    );
    expect(webview.writes).toEqual([new TextEncoder().encode("pre-disconnect output")]);

    transport.setOpen(false);
    transport.setOpen(true); // reconnected — same webview instance, still ready.

    // An Output frame arriving right on reconnect, before this
    // connection's own catch-up frame, is queued rather than applied
    // early (it would render onto whatever was left over from before the
    // disconnect, out of the daemon's intended order).
    transport.deliver(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Output,
        slot: SLOT,
        payload: new TextEncoder().encode("raced output"),
      }),
    );
    expect(webview.writes).toHaveLength(1); // unchanged — still just the pre-disconnect write

    deliverCatchUpSnapshot(transport);
    expect(webview.restores).toHaveLength(2);
    // The queued, raced Output is applied right after the restore it was
    // queued behind — order preserved, nothing lost.
    expect(webview.writes).toEqual([
      new TextEncoder().encode("pre-disconnect output"),
      new TextEncoder().encode("raced output"),
    ]);
  });

  it("a real terminal is usable again after reconnect: input flows and new Output renders", () => {
    const { transport, webview } = createHarness(100);
    transport.setOpen(true);
    webview.fireReady();
    deliverCatchUpSnapshot(transport);

    transport.setOpen(false);
    transport.setOpen(true);
    deliverCatchUpSnapshot(transport);

    webview.fireInput(new TextEncoder().encode("echo hi\n"));
    expect(transport.sent).toHaveLength(1);
    const inputFrame = decodeTerminalStreamFrame(transport.sent[0]);
    expect(inputFrame?.opcode).toBe(TerminalStreamOpcode.Input);

    transport.deliver(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Output,
        slot: SLOT,
        payload: new TextEncoder().encode("hi\n"),
      }),
    );
    expect(webview.writes.at(-1)).toEqual(new TextEncoder().encode("hi\n"));
  });
});

describe("TerminalSessionController — teardown", () => {
  it("dispose unsubscribes from both ports and disposes the webview, so nothing fires afterward", () => {
    const { transport, webview, controller } = createHarness();
    controller.dispose();
    expect(webview.disposed).toBe(true);

    transport.deliver(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Output,
        slot: SLOT,
        payload: new Uint8Array([1]),
      }),
    );
    webview.fireInput(new Uint8Array([1]));
    expect(webview.writes).toHaveLength(0);
    expect(transport.sent).toHaveLength(0);
  });

  it("T65: dispose calls the transport's own dispose exactly once, so a left screen's underlying session is told to close", () => {
    const { transport, controller } = createHarness();
    expect(transport.disposeCalls).toBe(0);
    controller.dispose();
    expect(transport.disposeCalls).toBe(1);
  });
});
