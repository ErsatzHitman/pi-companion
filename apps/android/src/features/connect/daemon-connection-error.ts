/**
 * Connection error taxonomy — plan.md §12.1, T32A1B.
 *
 * `daemon-connect-attempt.ts` proves a connection "through core" the
 * same way `apps/web`'s `authenticate-host.ts` does: it opens one
 * `connection.DaemonClientLifecycle` generation and reads whatever
 * `Error` its `connect()` rejects with. That rejection's `.message` is
 * whatever the real daemon closed the transport with (see
 * `describeTransportClose` in
 * `packages/client/src/daemon-client-transport-utils.ts`, which reads
 * the WebSocket close `reason` verbatim) or, on a connect-timeout, the
 * literal string `"Connection timed out"` (`daemon-client.ts`'s
 * `connect()`).
 *
 * This is a deliberate near-verbatim port of
 * `apps/web/src/features/connect/connection-error.ts`'s
 * `ConnectionErrorKind` vocabulary and message copy, not a second,
 * independently-invented taxonomy — the same raw daemon/relay close
 * reasons must classify the same way on both platforms, so "wrong
 * daemon key" never means one thing on web and another on Android. It
 * is a port rather than a shared import because neither app is
 * currently declared to depend on the other, and `apps/web/src` is not
 * a package either app's `Owns` grant may import
 * source-relative-across-workspace paths from (see `CLAUDE.md`'s
 * "Cross-workspace imports use package exports ... never
 * source-relative paths").
 *
 * `describeRelayConnectionError` was added by T32A3
 * (`apply-connection-offer.ts`), byte-for-byte the same switch and copy
 * as `apps/web`'s version, so "wrong daemon key" reads identically on
 * both platforms' relay-pairing path — the same reason
 * `describeDirectConnectionError` was ported verbatim by T32A1B. Every
 * exported name in this file (`ConnectionErrorKind`,
 * `classifyConnectionError`, both describers, every message constant)
 * is now a byte-for-byte match of `apps/web/src/features/connect/
 * connection-error.ts`, not a subset of it — keep it that way.
 */

export type ConnectionErrorKind = "unreachable" | "wrong-password" | "wrong-daemon-key" | "unknown";

/** Exact WebSocket close reasons `websocket-server.ts`'s `attachAuthenticatedSocket` sends for a rejected `paseo.bearer.<token>` subprotocol. */
const WRONG_PASSWORD_REASONS = new Set(["incorrect password", "password required"]);

const UNREACHABLE_SUBSTRINGS = [
  "econnrefused",
  "enotfound",
  "ehostunreach",
  "enetunreach",
  "timed out",
  "timeout",
  "failed to connect",
  "transport closed",
  "transport error",
  "network",
];

function normalize(rawMessage: string | undefined | null): string {
  return (rawMessage ?? "").trim().toLowerCase();
}

/**
 * Classifies a raw `connection.DaemonClientLifecycle.connect()`
 * rejection message. Matches the real daemon's/relay's exact reason
 * strings (see module docs) so a genuinely different failure is never
 * folded into the wrong bucket; anything unrecognized classifies as
 * `"unknown"` rather than guessing.
 */
export function classifyConnectionError(
  rawMessage: string | undefined | null,
): ConnectionErrorKind {
  const normalized = normalize(rawMessage);
  if (!normalized) return "unknown";
  if (WRONG_PASSWORD_REASONS.has(normalized)) return "wrong-password";
  if (normalized.includes("decryption failed")) return "wrong-daemon-key";
  if (UNREACHABLE_SUBSTRINGS.some((substring) => normalized.includes(substring))) {
    return "unreachable";
  }
  return "unknown";
}

export const WRONG_PASSWORD_MESSAGE = "Incorrect password";
export const PASSWORD_REQUIRED_MESSAGE =
  "This daemon needs an access token. Enter it and try again.";
export const DIRECT_UNREACHABLE_MESSAGE =
  "Could not reach the daemon. Check the address and try again.";
export const DIRECT_UNKNOWN_MESSAGE =
  "Could not sign in to this daemon. Check the address and access token, then try again.";
export const WRONG_DAEMON_KEY_MESSAGE =
  "This pairing link's daemon key no longer matches. Ask for a new pairing link.";
export const RELAY_UNREACHABLE_MESSAGE =
  "This pairing link is no longer valid. Ask for a new one and try again.";

/**
 * Describes a direct-connect failure: a fixed, non-alarming sentence
 * per `ConnectionErrorKind`. A direct `ws://`/`wss://` address has no
 * daemon key to get wrong, so `"wrong-daemon-key"` (which should never
 * occur here in practice — that mismatch only exists on the relay
 * E2EE path) still degrades to the same actionable copy as
 * `"unknown"` rather than mentioning a concept this path doesn't have,
 * matching `apps/web`'s `describeDirectConnectionError`.
 */
export function describeDirectConnectionError(rawMessage: string | undefined | null): string {
  switch (classifyConnectionError(rawMessage)) {
    case "wrong-password":
      return normalize(rawMessage) === "password required"
        ? PASSWORD_REQUIRED_MESSAGE
        : WRONG_PASSWORD_MESSAGE;
    case "unreachable":
      return DIRECT_UNREACHABLE_MESSAGE;
    case "wrong-daemon-key":
    case "unknown":
    default:
      return DIRECT_UNKNOWN_MESSAGE;
  }
}

/**
 * Describes a relay-pairing failure (`apply-connection-offer.ts`): a
 * fixed, non-alarming sentence per `ConnectionErrorKind`, distinct from
 * `describeDirectConnectionError`'s — in particular
 * `"wrong-daemon-key"` names the actual mismatch instead of collapsing
 * into the same generic "pairing link is no longer valid" copy every
 * other relay failure gets. Byte-for-byte the same switch as `apps/
 * web`'s `describeRelayConnectionError` (T32A3).
 */
export function describeRelayConnectionError(rawMessage: string | undefined | null): string {
  switch (classifyConnectionError(rawMessage)) {
    case "wrong-password":
      return normalize(rawMessage) === "password required"
        ? PASSWORD_REQUIRED_MESSAGE
        : WRONG_PASSWORD_MESSAGE;
    case "wrong-daemon-key":
      return WRONG_DAEMON_KEY_MESSAGE;
    case "unreachable":
    case "unknown":
    default:
      return RELAY_UNREACHABLE_MESSAGE;
  }
}
