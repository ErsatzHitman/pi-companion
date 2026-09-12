/**
 * The in-WebView half of Android's terminal (T32S11) — bundled by
 * `../../scripts/build-terminal-webview-html.mjs` into
 * `../../src/features/terminal/terminal-webview-html.gen.ts` and loaded by
 * `react-native-webview` as an inline `source={{ html }}` document.
 *
 * Deliberately outside `src/`: it is a browser bundle entry, not a React
 * Native module, so it must not be pulled into the app's Metro graph nor
 * typechecked against the app's `lib`/DOM-less tsconfig. It talks to
 * `terminal-webview-port.ts` over the JSON protocol documented on that
 * file's `createAndroidTerminalWebViewPort`; nothing here imports React or
 * React Native.
 */
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import xtermCss from "@xterm/xterm/css/xterm.css";

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
  }
}

function post(message: unknown): void {
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

const style = document.createElement("style");
style.textContent = xtermCss;
document.head.appendChild(style);

const container = document.getElementById("terminal");
const terminal = new Terminal({
  cursorBlink: true,
  fontFamily: "monospace",
  fontSize: 13,
  scrollback: 5000,
  theme: { background: "#000000", foreground: "#ffffff", cursor: "#ffffff" },
});
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
if (container) {
  terminal.open(container);
}

function measure(): void {
  try {
    fitAddon.fit();
  } catch {
    // The container has no layout yet; the next resize/report will retry.
  }
  post({ type: "size", rows: terminal.rows, cols: terminal.cols });
}

terminal.onData((data) => {
  post({ type: "input", data: bytesToBase64(new TextEncoder().encode(data)) });
});

window.addEventListener("message", (event: MessageEvent<string>) => {
  let message: {
    type?: string;
    data?: string;
    text?: string;
    theme?: unknown;
    rows?: number;
    cols?: number;
  };
  try {
    message = JSON.parse(event.data) as typeof message;
  } catch {
    return;
  }
  switch (message.type) {
    case "writeBytes":
      if (typeof message.data === "string") terminal.write(base64ToBytes(message.data));
      return;
    case "restore":
      if (typeof message.text === "string") {
        terminal.reset();
        terminal.write(message.text);
      }
      return;
    case "setTheme":
      if (message.theme) terminal.options.theme = message.theme as typeof terminal.options.theme;
      return;
    case "resize":
      if (typeof message.rows === "number" && typeof message.cols === "number") {
        terminal.resize(message.cols, message.rows);
      }
      return;
    default:
      return;
  }
});

window.addEventListener("resize", measure);

requestAnimationFrame(() => {
  measure();
  post({ type: "ready" });
});
