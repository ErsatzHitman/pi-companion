/**
 * Daemon-injected bootstrap configuration — plan.md §4.3/§8.2/§12.1, T27A5.
 *
 * When the daemon serves its own bundled web UI (rather than this app
 * being opened standalone, e.g. during local development against a
 * separately-run dev server) its `web-ui.ts` middleware injects a
 * same-origin connection hint into `index.html`:
 *
 * ```html
 * <script>window.__PASEO_INITIAL_DAEMON_CONNECTION__={"listen":"host:port","useTls":false,"label":"my-mac"}</script>
 * ```
 *
 * (`packages/server/src/server/web-ui.ts`'s `injectConnectionHint`).
 * `listen` is the `Host` header the daemon observed for this very
 * request (already a `host:port` — or `[ipv6]:port` — pair by
 * construction), `useTls` reflects whether that request arrived over
 * HTTPS (honouring `trustedProxies`), and `label` is the daemon's
 * hostname.
 *
 * This module turns that untrusted injected global into the same
 * `ConnectDraft` shape a manually typed address produces
 * (`validate-connect-form.ts`'s `parseHostAddress`), so a missing or
 * malformed hint always resolves to `null` — never a thrown error —
 * and `ConnectFormContainer` can fall back to the ordinary manual-entry
 * form exactly as if no hint had been injected at all (this task's "a
 * missing or malformed bootstrap falls back to manual connect"
 * criterion). Nothing here ever reads or writes the manual form's own
 * state; the two paths only ever meet through `ConnectAndAuthenticateAttempt`,
 * so a bootstrapped connection can never silently overwrite a host the
 * user already typed themselves.
 */
import { parseHostAddress } from "./validate-connect-form.js";
import type { ConnectDraft } from "./validate-connect-form.js";

/** The global `packages/server/src/server/web-ui.ts` injects into the daemon-served `index.html`. */
export const BOOTSTRAP_CONNECTION_GLOBAL_KEY = "__PASEO_INITIAL_DAEMON_CONNECTION__";

/** The untrusted shape read from `window.__PASEO_INITIAL_DAEMON_CONNECTION__`, before validation. */
export interface DaemonInjectedConnectionHint {
  listen: string;
  useTls: boolean;
  label: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads and shape-validates `globalObject[BOOTSTRAP_CONNECTION_GLOBAL_KEY]`
 * (`window.__PASEO_INITIAL_DAEMON_CONNECTION__` in production; an
 * injected fake in tests). Returns `null` — never throws — for
 * anything that is not a well-formed `{listen: string, useTls: boolean,
 * label: string}` object, including a missing global entirely.
 */
export function readInjectedConnectionHint(
  globalObject: unknown = globalThis,
): DaemonInjectedConnectionHint | null {
  if (!isRecord(globalObject)) return null;
  const raw = globalObject[BOOTSTRAP_CONNECTION_GLOBAL_KEY];
  if (!isRecord(raw)) return null;
  const { listen, useTls, label } = raw;
  if (typeof listen !== "string" || listen.trim() === "") return null;
  if (typeof useTls !== "boolean") return null;
  if (typeof label !== "string") return null;
  return { listen, useTls, label };
}

/**
 * Turns a shape-valid hint into the `ConnectDraft` a manually submitted
 * address would produce (direct connection, no password — the
 * daemon-served page is already same-origin, so there is no separate
 * token to prove here). Reuses `parseHostAddress` so a `listen` value
 * that is not actually a valid `host:port`/`[ipv6]:port` pair is
 * rejected exactly like a mistyped one would be: `null`, never a
 * thrown parse error.
 */
export function bootstrapConnectDraft(hint: DaemonInjectedConnectionHint): ConnectDraft | null {
  let parsed: ReturnType<typeof parseHostAddress>;
  try {
    parsed = parseHostAddress(hint.listen);
  } catch {
    return null;
  }
  const endpoint = parsed.isIpv6
    ? `[${parsed.host}]:${parsed.port}`
    : `${parsed.host}:${parsed.port}`;
  const label = hint.label.trim() || parsed.host;
  return {
    label,
    direct: { endpoint, useTls: hint.useTls },
    preferDirect: true,
  };
}

/**
 * Convenience combining `readInjectedConnectionHint` +
 * `bootstrapConnectDraft`: `null` for a missing or malformed bootstrap
 * hint, a ready-to-attempt `ConnectDraft` otherwise.
 */
export function readBootstrapConnectDraft(globalObject?: unknown): ConnectDraft | null {
  const hint = readInjectedConnectionHint(globalObject);
  if (!hint) return null;
  return bootstrapConnectDraft(hint);
}
