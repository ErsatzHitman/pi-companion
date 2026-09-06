/**
 * Connection error taxonomy — plan.md §12.1, T27A6.
 *
 * `authenticate-host.ts` (direct) and `apply-connection-offer.ts`
 * (relay) both prove a connection "through core" by opening one
 * disposable `connection.DaemonClientLifecycle` and reading whatever
 * `Error` its `connect()` rejects with. That rejection's `.message` is
 * whatever the real daemon or relay closed the transport with — see
 * `describeTransportClose` in
 * `packages/client/src/daemon-client-transport-utils.ts`, which reads
 * the WebSocket close `reason` verbatim.
 *
 * Two of those reasons name genuinely different failures that must
 * never be shown with the same copy:
 *
 * - a **wrong password**: the direct-connect path's daemon rejects the
 *   `paseo.bearer.<token>` subprotocol with close code 4401 and reason
 *   `"Incorrect password"` (no token: `"Password required"`) — see
 *   `packages/server/src/server/websocket-server.ts`'s
 *   `attachAuthenticatedSocket` and `WS_CLOSE_DAEMON_AUTH_FAILED`.
 * - a **wrong daemon key**: the relay-pairing path's E2EE handshake
 *   used the pinned `daemonPublicKeyB64` from a `ConnectionOffer` that
 *   no longer matches the daemon's real key (it rotated, or the offer
 *   was never valid). ECDH does not itself reject a wrong peer key —
 *   the two sides simply derive different shared keys — so the failure
 *   only surfaces once a message fails to decrypt with reason
 *   `"Decryption failed"` and the channel closes (code 1011). See
 *   `packages/relay/src/crypto.ts`'s `decrypt()` and
 *   `packages/relay/src/encrypted-channel.ts`'s `handleMessage` catch.
 *
 * `classifyConnectionError` turns that raw, backend-owned string into
 * one of a small, closed set of `ConnectionErrorKind`s;
 * `describeDirectConnectionError`/`describeRelayConnectionError` turn
 * the kind into one fixed, non-alarming, human-readable sentence per
 * connection path (the right next action differs: re-enter a token vs.
 * ask for a new pairing link), so a wrong password and a wrong daemon
 * key are never reported with the same message.
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
 * Describes a direct-connect failure (`authenticate-host.ts`): a fixed,
 * non-alarming sentence per `ConnectionErrorKind`, distinct from
 * `describeRelayConnectionError`'s. A direct connection has no daemon
 * key to get wrong, so `"wrong-daemon-key"` (which should never occur
 * here in practice) still degrades to the same actionable copy as
 * `"unknown"` rather than mentioning a concept this path doesn't have.
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
 * other relay failure gets.
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
