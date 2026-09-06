import { describe, expect, it } from "vitest";

import { createUnavailableTerminalWebViewPort } from "./terminal-webview-port";

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
