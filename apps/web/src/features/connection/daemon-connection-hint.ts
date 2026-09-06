/**
 * Daemon-served connection hint (plan.md §8.2, §16 "web middleware").
 *
 * When the daemon serves this app's static build, its web middleware
 * injects `window.__PASEO_INITIAL_DAEMON_CONNECTION__` into `index.html`
 * before the page's own scripts run, so the shell knows which daemon
 * served it without a round trip. This module only reads that global; the
 * daemon-side injection is `scripts/build-daemon-web-ui.mjs` (T18) and the
 * server's web middleware, not this app.
 */
export interface DaemonConnectionHint {
  /** The `Host` header the daemon observed for this request, e.g. `localhost:4317`. */
  listen: string;
  /** Whether the page was served over HTTPS. */
  useTls: boolean;
  /** A human-readable label for this daemon (hostname, device name, and so on). */
  label: string;
}

declare global {
  interface Window {
    __PASEO_INITIAL_DAEMON_CONNECTION__?: DaemonConnectionHint;
  }
}

function isDaemonConnectionHint(value: unknown): value is DaemonConnectionHint {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DaemonConnectionHint>;
  return (
    typeof candidate.listen === "string" &&
    typeof candidate.useTls === "boolean" &&
    typeof candidate.label === "string"
  );
}

/** Reads and validates the daemon-injected connection hint, if present. */
export function readDaemonConnectionHint(): DaemonConnectionHint | null {
  if (typeof window === "undefined") return null;
  const hint = window.__PASEO_INITIAL_DAEMON_CONNECTION__;
  return isDaemonConnectionHint(hint) ? hint : null;
}
