/**
 * Browser `HostProbeTransport` — plan.md §7.1/§12.1, T27A1.
 *
 * `@picompanion/frontend-core`'s `hosts.ConnectionProber` needs a
 * platform-supplied `HostProbeTransport`: a function that resolves once
 * a WebSocket URL is reachable and rejects once it is confirmed
 * unreachable (see that module's docstring). This is `apps/web`'s
 * implementation, backed by a throwaway `WebSocket` that is closed the
 * moment it opens — this only probes reachability, it never becomes the
 * connection `HostController`/`DaemonClientLifecycle` later establish.
 *
 * Takes an injectable socket factory (defaulting to the real
 * `WebSocket` constructor) purely so tests never need to open a real
 * network socket, matching the narrow-interface pattern the rest of
 * `apps/web/src/platform` already uses for browser globals.
 */
import type { hosts } from "@picompanion/frontend-core";

export type ProbeSocketEventType = "open" | "error" | "close";

/** The subset of `WebSocket` this transport touches. */
export interface ProbeSocket {
  close(): void;
  addEventListener(type: ProbeSocketEventType, listener: () => void): void;
  removeEventListener(type: ProbeSocketEventType, listener: () => void): void;
}

export type ProbeSocketFactory = (url: string) => ProbeSocket;

const defaultSocketFactory: ProbeSocketFactory = (url) => new WebSocket(url);

/**
 * Builds a `HostProbeTransport` that opens (and immediately closes) a
 * `WebSocket` at `url` to determine reachability. Never itself enforces
 * a timeout — `ConnectionProber` owns that via the injected `Clock`.
 */
export function createBrowserHostProbeTransport(
  createSocket: ProbeSocketFactory = defaultSocketFactory,
): hosts.HostProbeTransport {
  return (url) =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      let socket: ProbeSocket;
      try {
        socket = createSocket(url);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      const cleanup = (): void => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onFailure);
        socket.removeEventListener("close", onFailure);
      };

      function onOpen(): void {
        if (settled) return;
        settled = true;
        cleanup();
        socket.close();
        resolve();
      }

      function onFailure(): void {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Unable to reach ${url}`));
      }

      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onFailure);
      socket.addEventListener("close", onFailure);
    });
}
