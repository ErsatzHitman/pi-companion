import type { TerminalState } from "@picompanion/protocol/messages";
import { renderTerminalSnapshotToAnsi } from "@picompanion/protocol/terminal-snapshot";

import { base64ToBytes, bytesToBase64 } from "../../platform/bytes-to-base64.js";
import type { TerminalTheme } from "./terminal-theme";

/**
 * WebView-terminal port (T35B1, plan.md §12.4 "Android rebuilds an xterm
 * WebView wrapper from the established binary protocol and behavior
 * tests").
 *
 * The seam between `terminal-session-controller.ts`'s RN-free wiring and
 * whatever actually paints an `xterm.js` terminal inside a WebView.
 * Modeled on `apps/android/src/features/connect/qr-scanner-port.ts`'s
 * `CameraScannerPort` seam: a narrow, structural interface plus one
 * production factory, so the controller and every test in this feature
 * only ever depend on this file, never on a native module.
 *
 * **The WebView now exists (T32S11).** `apps/android/package.json` declares
 * `react-native-webview@13.15.0` — the version this app's own resolved
 * `expo/bundledNativeModules.json` pins, measured against `apps/android`'s
 * own resolution of that file (the same T326 correction recorded below).
 * (CORRECTED at T326: this section used to say `13.16.1`, and that the same
 * file pinned `@expo/dom-webview` at `~57.0.1`; both figures came from the
 * SDK-57 `expo` hoisted at the repository root, which this app does not
 * resolve.) `createAndroidTerminalWebViewPort` below is now the production
 * port: it speaks a small JSON protocol (documented on its own doc comment)
 * to `./terminal-webview-host.tsx`'s `<WebView>`, which
 * `terminal-screen.tsx` renders and binds through `attachHost`.
 * `createUnavailableTerminalWebViewPort` remains as this module's named,
 * honestly-degraded fallback (and what every existing isolated test still
 * proves): it never reports `onReady`, so `terminal-session-controller.ts`
 * never sends a byte to it and never claims a resize.
 *
 * **The one remaining step, which this environment cannot perform:**
 * `react-native-webview` is a native module, so a prebuilt binary does not
 * contain it yet. Running the app against this port therefore still needs a
 * native rebuild — `npx expo prebuild --platform android --no-install`
 * followed by `npx expo run:android` (or an EAS build) — to link the
 * package into the APK. Until that happens on a device, the JS side is
 * complete: the port, its host, the xterm page bundle
 * (`./terminal-webview-html.gen.ts`) and the `../app-shell/core.ts` construction
 * below are all in place. Nothing in `terminal-session-controller.ts` or the
 * terminal route needs to change for that swap — the whole point of this
 * seam.
 */

export interface TerminalSize {
  readonly rows: number;
  readonly cols: number;
}

/**
 * The one thing a real `TerminalWebViewPort` needs from the React tree: a way
 * to post a string into the rendered `<WebView>`. Structural, so the host
 * component can hand in a closure over its own imperative ref without this
 * RN-free module importing `react-native-webview` (or `react`).
 */
export interface TerminalWebViewHostBridge {
  postMessage(data: string): void;
}

export interface TerminalWebViewPort {
  /**
   * Whether this port can ever become ready. `false` for
   * `createUnavailableTerminalWebViewPort()`; a real port reports `true`
   * even before its page has loaded — see `onReady`.
   */
  readonly isAvailable: boolean;
  /**
   * Writes raw output bytes (a decoded `TerminalStreamOpcode.Output`
   * payload) into the terminal for `xterm.js` to render. Must never be
   * called before `onReady` has fired — `terminal-session-controller.ts`
   * enforces that, this port does not need to guard it defensively.
   */
  write(bytes: Uint8Array): void;
  /** Replaces the terminal's buffer wholesale from a decoded snapshot (`TerminalStreamOpcode.Snapshot`). */
  restore(state: TerminalState): void;
  /** Applies (or re-applies, on theme change) the terminal's color/font theme. */
  setTheme(theme: TerminalTheme): void;
  /** Tells the embedded `xterm.js` viewport to resize — a local re-layout, never a wire send. */
  resize(size: TerminalSize): void;
  /**
   * Fires once the embedded page's `xterm.js` `Terminal` exists and can
   * accept `write`/`resize`/`setTheme`. Nothing above may be called
   * before this fires; `terminal-session-controller.ts` is the only
   * caller that relies on that ordering.
   */
  onReady(handler: () => void): () => void;
  /** Fires with the bytes of a keystroke/paste the user made inside the terminal. */
  onInput(handler: (bytes: Uint8Array) => void): () => void;
  /** Fires whenever the page's own `fit`-addon measurement changes (layout, rotation, keyboard). */
  onMeasuredSize(handler: (size: TerminalSize) => void): () => void;
  /** Releases every listener and any underlying native resource. */
  dispose(): void;
  /**
   * Binds a rendered native host — the RN-free controller never calls this;
   * `terminal-screen.tsx` calls it from the `<WebView>`'s own ref callback,
   * once, with a closure over that view. Optional so
   * `createUnavailableTerminalWebViewPort` (and any future non-WebView port)
   * can omit it; the screen renders its empty state when this is absent.
   */
  attachHost?(host: TerminalWebViewHostBridge): void;
  /**
   * The inbound half of `attachHost`: whatever the page's
   * `ReactNativeWebView.postMessage` sent, as a raw JSON string. The screen's
   * `<WebView onMessage>` is the only caller.
   */
  handleHostMessage?(data: string): void;
}

/**
 * This build's real `TerminalWebViewPort` (T32S11) — the RN-free half of the
 * Android terminal. It never imports `react-native-webview` or `react`: it
 * speaks one small JSON protocol to whatever `attachHost` hands it (in
 * production, `./terminal-webview-host.tsx`'s `<WebView>`), and every rule
 * below is provable in plain `vitest` against a scripted host bridge (see
 * `./terminal-webview-port.test.ts`).
 *
 * Wire protocol (all frames JSON, both directions):
 *
 *   port → page:  { type: "writeBytes", data: <base64> }
 *                 { type: "restore", text: <ANSI> }
 *                 { type: "setTheme", theme: <TerminalTheme> }
 *                 { type: "resize", rows, cols }
 *   page → port:  { type: "ready" }
 *                 { type: "input", data: <base64> }
 *                 { type: "size", rows, cols }
 *
 * Output bytes travel as base64 because a WebView `postMessage` carries a
 * string; the page base64-decodes them back to a `Uint8Array` before handing
 * them to `xterm.js`, so multi-byte UTF-8 output is preserved rather than
 * Latin-1-mangled. `restore` sends the snapshot already rendered to ANSI
 * (`renderTerminalSnapshotToAnsi`, the same renderer the daemon's own restore
 * uses) because the page has no business re-implementing snapshot rendering.
 *
 * **Ordering:** every outbound call made before the page reports `"ready"` is
 * queued here and flushed, in order, the instant `ready` arrives. That is
 * belt-and-braces with `terminal-session-controller.ts`'s own
 * `TerminalOutputBuffer` gate: the controller never calls `write`/`restore`
 * before `onReady`, but `setTheme` is called eagerly on mount, so the port
 * must not assume the page exists yet either.
 */
export function createAndroidTerminalWebViewPort(): TerminalWebViewPort {
  const readyHandlers = new Set<() => void>();
  const inputHandlers = new Set<(bytes: Uint8Array) => void>();
  const sizeHandlers = new Set<(size: TerminalSize) => void>();
  const pending: string[] = [];
  let host: TerminalWebViewHostBridge | null = null;
  let isReady = false;
  let disposed = false;

  function flush(): void {
    if (!host || !isReady) return;
    while (pending.length > 0) {
      host.postMessage(pending.shift()!);
    }
  }

  function send(message: unknown): void {
    if (disposed) return;
    const data = JSON.stringify(message);
    if (host && isReady) {
      host.postMessage(data);
    } else {
      pending.push(data);
    }
  }

  function handleMessage(data: string): void {
    if (disposed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const message = parsed as { type?: unknown } & Record<string, unknown>;
    switch (message.type) {
      case "ready":
        if (isReady) return;
        isReady = true;
        flush();
        for (const handler of readyHandlers) handler();
        return;
      case "input": {
        if (typeof message.data !== "string") return;
        const bytes = base64ToBytes(message.data);
        for (const handler of inputHandlers) handler(bytes);
        return;
      }
      case "size": {
        if (typeof message.rows !== "number" || typeof message.cols !== "number") return;
        const size: TerminalSize = { rows: message.rows, cols: message.cols };
        for (const handler of sizeHandlers) handler(size);
        return;
      }
      default:
        return;
    }
  }

  return {
    isAvailable: true,

    write(bytes: Uint8Array): void {
      send({ type: "writeBytes", data: bytesToBase64(bytes) });
    },

    restore(state: TerminalState): void {
      send({ type: "restore", text: renderTerminalSnapshotToAnsi(state) });
    },

    setTheme(theme: TerminalTheme): void {
      send({ type: "setTheme", theme });
    },

    resize(size: TerminalSize): void {
      send({ type: "resize", rows: size.rows, cols: size.cols });
    },

    onReady(handler: () => void): () => void {
      readyHandlers.add(handler);
      return () => {
        readyHandlers.delete(handler);
      };
    },

    onInput(handler: (bytes: Uint8Array) => void): () => void {
      inputHandlers.add(handler);
      return () => {
        inputHandlers.delete(handler);
      };
    },

    onMeasuredSize(handler: (size: TerminalSize) => void): () => void {
      sizeHandlers.add(handler);
      return () => {
        sizeHandlers.delete(handler);
      };
    },

    dispose(): void {
      disposed = true;
      readyHandlers.clear();
      inputHandlers.clear();
      sizeHandlers.clear();
      pending.length = 0;
      host = null;
    },

    attachHost(bridge: TerminalWebViewHostBridge): void {
      host = bridge;
      flush();
    },

    handleHostMessage(data: string): void {
      handleMessage(data);
    },
  };
}

/** This build's named, honestly-degraded `TerminalWebViewPort` — the shape `terminal-screen.tsx` renders its accessible empty state for when no real host is available. */
export function createUnavailableTerminalWebViewPort(): TerminalWebViewPort {
  return {
    isAvailable: false,
    write() {
      // No page exists to write into.
    },
    restore() {
      // No page exists to restore into.
    },
    setTheme() {
      // No page exists to theme.
    },
    resize() {
      // No page exists to resize.
    },
    onReady() {
      // Never fires: this port can never become ready.
      return () => undefined;
    },
    onInput() {
      return () => undefined;
    },
    onMeasuredSize() {
      return () => undefined;
    },
    dispose() {
      // Nothing was ever allocated.
    },
  };
}
