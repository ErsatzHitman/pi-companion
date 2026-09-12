import { describe, expect, it, vi } from "vitest";
import { renderTerminalSnapshotToAnsi } from "@picompanion/protocol/terminal-snapshot";

import { bytesToBase64 } from "../../platform/bytes-to-base64.js";
import {
  createAndroidTerminalWebViewPort,
  createUnavailableTerminalWebViewPort,
} from "./terminal-webview-port";

describe("createUnavailableTerminalWebViewPort", () => {
  it("reports itself as unavailable and never fires onReady", () => {
    const port = createUnavailableTerminalWebViewPort();
    expect(port.isAvailable).toBe(false);

    let readyFired = false;
    port.onReady(() => {
      readyFired = true;
    });
    // No page exists to ever fire this — proven by absence over time,
    // not a fake timer: the handler is simply never invoked by anything
    // in this port.
    expect(readyFired).toBe(false);
  });

  it("every write/restore/setTheme/resize call is a silent no-op", () => {
    const port = createUnavailableTerminalWebViewPort();
    expect(() => port.write(new Uint8Array([1, 2, 3]))).not.toThrow();
    expect(() =>
      port.restore({
        rows: 24,
        cols: 80,
        grid: [],
        scrollback: [],
        cursor: { row: 0, col: 0, hidden: false, style: "block" },
      }),
    ).not.toThrow();
    expect(() =>
      port.setTheme({
        background: "x",
        foreground: "x",
        cursor: "x",
        cursorAccent: "x",
        selectionBackground: "x",
        fontFamily: "x",
        black: "x",
        red: "x",
        green: "x",
        yellow: "x",
        blue: "x",
        magenta: "x",
        cyan: "x",
        white: "x",
        brightBlack: "x",
        brightRed: "x",
        brightGreen: "x",
        brightYellow: "x",
        brightBlue: "x",
        brightMagenta: "x",
        brightCyan: "x",
        brightWhite: "x",
      }),
    ).not.toThrow();
    expect(() => port.resize({ rows: 10, cols: 10 })).not.toThrow();
    expect(() => port.dispose()).not.toThrow();
  });

  it("onInput and onMeasuredSize subscriptions return an unsubscribe that never fires their handler", () => {
    const port = createUnavailableTerminalWebViewPort();
    let inputCalls = 0;
    let sizeCalls = 0;
    const unsubInput = port.onInput(() => {
      inputCalls += 1;
    });
    const unsubSize = port.onMeasuredSize(() => {
      sizeCalls += 1;
    });
    unsubInput();
    unsubSize();
    expect(inputCalls).toBe(0);
    expect(sizeCalls).toBe(0);
  });
});

/** Collects every string a bound host would receive, so a test can assert the exact outbound protocol. */
function scriptedHost() {
  const posted: string[] = [];
  return {
    posted,
    host: { postMessage: (data: string) => posted.push(data) },
  };
}

function messageAt(posted: string[], index: number): { type: string } & Record<string, unknown> {
  return JSON.parse(posted[index]!) as { type: string } & Record<string, unknown>;
}

describe("createAndroidTerminalWebViewPort", () => {
  it("reports itself available and exposes the host-binding seam the screen renders for", () => {
    const port = createAndroidTerminalWebViewPort();
    expect(port.isAvailable).toBe(true);
    expect(typeof port.attachHost).toBe("function");
    expect(typeof port.handleHostMessage).toBe("function");
  });

  it("queues every outbound frame until the page reports ready, then flushes them in order", () => {
    const port = createAndroidTerminalWebViewPort();
    const { posted, host } = scriptedHost();
    port.attachHost!(host);

    port.setTheme({ fontFamily: "mono" } as never);
    port.resize({ rows: 40, cols: 100 });
    expect(posted).toEqual([]);

    port.handleHostMessage!(JSON.stringify({ type: "ready" }));

    expect(posted).toHaveLength(2);
    expect(messageAt(posted, 0)).toEqual({ type: "setTheme", theme: { fontFamily: "mono" } });
    expect(messageAt(posted, 1)).toEqual({ type: "resize", rows: 40, cols: 100 });

    // After ready, frames go straight out rather than queueing again.
    port.resize({ rows: 10, cols: 20 });
    expect(posted).toHaveLength(3);
  });

  it("write base64-encodes the raw output bytes so multi-byte UTF-8 survives the string bridge", () => {
    const port = createAndroidTerminalWebViewPort();
    const { posted, host } = scriptedHost();
    port.attachHost!(host);
    port.handleHostMessage!(JSON.stringify({ type: "ready" }));

    port.write(new Uint8Array([0xe2, 0x82, 0xac]));

    expect(messageAt(posted, 0)).toEqual({
      type: "writeBytes",
      data: bytesToBase64(new Uint8Array([0xe2, 0x82, 0xac])),
    });
  });

  it("restore sends the snapshot pre-rendered to ANSI through the protocol's own renderer", () => {
    const port = createAndroidTerminalWebViewPort();
    const { posted, host } = scriptedHost();
    port.attachHost!(host);
    port.handleHostMessage!(JSON.stringify({ type: "ready" }));

    const state = {
      rows: 1,
      cols: 3,
      grid: [[{ char: "h" }, { char: "i" }, { char: " " }]],
      scrollback: [],
      cursor: { row: 0, col: 0, hidden: false, style: "block" as const },
    };
    port.restore(state);

    expect(messageAt(posted, 0)).toEqual({
      type: "restore",
      text: renderTerminalSnapshotToAnsi(state),
    });
  });

  it("decodes an inbound input frame to bytes and fans it out to every onInput subscriber", () => {
    const port = createAndroidTerminalWebViewPort();
    const received: Uint8Array[] = [];
    const unsubscribe = port.onInput((bytes) => received.push(bytes));

    port.handleHostMessage!(JSON.stringify({ type: "input", data: "aGk=" }));
    expect(received).toEqual([new Uint8Array([0x68, 0x69])]);

    unsubscribe();
    port.handleHostMessage!(JSON.stringify({ type: "input", data: "aGk=" }));
    expect(received).toHaveLength(1);
  });

  it("reports a measured size to every onMeasuredSize subscriber", () => {
    const port = createAndroidTerminalWebViewPort();
    const sizes: Array<{ rows: number; cols: number }> = [];
    port.onMeasuredSize((size) => sizes.push(size));

    port.handleHostMessage!(JSON.stringify({ type: "size", rows: 24, cols: 80 }));

    expect(sizes).toEqual([{ rows: 24, cols: 80 }]);
  });

  it("ignores malformed frames instead of throwing", () => {
    const port = createAndroidTerminalWebViewPort();
    const onInput = vi.fn();
    port.onInput(onInput);

    expect(() => port.handleHostMessage!("not json")).not.toThrow();
    expect(() => port.handleHostMessage!(JSON.stringify({ type: "input" }))).not.toThrow();
    expect(() => port.handleHostMessage!(JSON.stringify(null))).not.toThrow();
    expect(onInput).not.toHaveBeenCalled();
  });

  it("stops sending and clears its subscriptions after dispose", () => {
    const port = createAndroidTerminalWebViewPort();
    const { posted, host } = scriptedHost();
    port.attachHost!(host);
    port.handleHostMessage!(JSON.stringify({ type: "ready" }));
    const onInput = vi.fn();
    port.onInput(onInput);

    port.dispose();
    port.write(new Uint8Array([1]));
    port.handleHostMessage!(JSON.stringify({ type: "input", data: "YQ==" }));

    expect(posted).toEqual([]);
    expect(onInput).not.toHaveBeenCalled();
  });
});
