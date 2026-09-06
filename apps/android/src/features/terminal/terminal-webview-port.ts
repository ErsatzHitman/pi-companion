import type { TerminalState } from "@picompanion/protocol/messages";

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
 * **No WebView dependency is installed in this workspace.**
 * `apps/android/package.json` carries no `react-native-webview` today,
 * and this task may not run `npm install`.
 * `expo/bundledNativeModules.json` pins `react-native-webview` at
 * `13.16.1` and `@expo/dom-webview` at `~57.0.1` for whenever it is
 * added. `createUnavailableTerminalWebViewPort` below is therefore this
 * module's only production implementation: it never reports `onReady`,
 * so `terminal-session-controller.ts` never sends a byte to it and never
 * claims a resize — a silent, honest "nothing to draw" rather than a
 * fake terminal. `terminal-screen.tsx` renders this port's permanent
 * not-ready state as its own accessible empty state.
 *
 * To wire a real WebView once available:
 *
 *   npm install --workspace=@picompanion/android react-native-webview@13.16.1
 *
 * — then add a second implementation of `TerminalWebViewPort` backed by
 * an `xterm.js` bundle loaded into a `react-native-webview` `WebView`
 * (`postMessage`/`onMessage` for `write`/`onInput`, a `ResizeObserver` +
 * the `fit` addon inside the page for `onMeasuredSize`, `injectedJavaScript`
 * or a `postMessage` call for `setTheme`/`resize`/`restore`), fire
 * `onReady` once the page's `xterm.js` `Terminal` has been constructed,
 * and construct it in place of `createUnavailableTerminalWebViewPort()`
 * at `../app-shell/core.ts`'s `AppCore["terminalWebview"]` (T80, P5-W23
 * — the one production site this is threaded from, into `TerminalScreen`'s
 * `webview` prop via `../app/h/[serverId]/session/[agentId]/terminal/
 * [terminalId].tsx`). Nothing in `terminal-session-controller.ts`,
 * `terminal-screen.tsx`, or that route needs to change for that swap —
 * the whole point of this seam.
 */

export interface TerminalSize {
  readonly rows: number;
  readonly cols: number;
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
}

/** This build's only production `TerminalWebViewPort` — see module doc. */
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
