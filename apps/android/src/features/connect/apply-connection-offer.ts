/**
 * ConnectionOffer pairing on Android — plan.md §7.1/§12.1/§12.5, T32A3,
 * extended by T32A5 ("Support relay host profiles on Android") to carry
 * an optional daemon password over the relay path.
 *
 * Turns pasted pairing-offer input (a full `https://app.paseo.sh/#offer=<base64url>`
 * URL, a bare `#offer=`/`offer=` fragment, or the raw base64url payload
 * on its own — the same shapes a QR scan, T32A4's job, will feed
 * through this same `parseConnectionOfferInput`/`createApplyConnectionOfferAttempt`
 * pair) into a relay-only `hosts.HostProfileDraft`
 * (`hosts.hostProfileDraftFromConnectionOffer`) and attempts one
 * disposable-on-failure `connection.DaemonClientLifecycle` connection
 * through it, pinned to the offer's `daemonPublicKeyB64`.
 *
 * This started as a near-verbatim port of `apps/web`'s
 * `apply-connection-offer.ts` — same input shapes, same
 * `ConnectionOfferParseError` — and stays a port, not a second,
 * independently-invented taxonomy: every `ConnectionErrorKind` value
 * and every message constant this module uses still comes from
 * `daemon-connection-error.ts`, byte-for-byte the same as `apps/web`'s
 * `connection-error.ts` (see that module's docstring). It is a port
 * rather than a shared import for the same reason
 * `daemon-connection-error.ts` is: neither app is currently declared to
 * depend on the other, and `apps/web/src` is not a package either app's
 * `Owns` grant may import source-relative-across-workspace paths from.
 *
 * T32A5 widened this module's own `ApplyConnectionOfferFailure.kind`
 * from web's three-way `"malformed" | "wrong-daemon-key" | "expired"`
 * to a four-way `"malformed" | "wrong-password" | "wrong-daemon-key" |
 * "expired"` — **without adding a new `ConnectionErrorKind`** — because
 * `@picompanion/client`'s `paseo.bearer.<token>` password check
 * (`daemon-client.ts`'s `connect()`, `WRONG_PASSWORD_REASONS` in
 * `daemon-connection-error.ts`) runs at the transport layer underneath
 * *both* a direct WebSocket and a relay-tunnelled one — a relay-paired
 * daemon that also sets a password rejects a missing/wrong one exactly
 * the same way a direct one does. Before T32A5 this function never
 * forwarded a `password` at all, so that rejection could never be
 * produced or observed on the relay path, and a bad relay password
 * silently fell into the generic `"expired"` bucket alongside a merely
 * offline daemon — collapsing a credential failure into a reachability
 * failure, exactly what plan.md §12.1's "Add tests for ... wrong
 * password, wrong daemon key" calls out as distinct. `apply-connection-
 * offer.test.ts`'s "classifies an incorrect relay password as
 * 'wrong-password' distinct from 'wrong-daemon-key' and 'expired'"
 * proves this is fixed.
 *
 * Unlike web's version, this module never persists a `HostProfile`:
 * Android has no `HostProfileStore`/`StructuredStorage`-backed profile
 * registry yet — `daemon-connect-attempt.ts`'s module docstring notes
 * the same gap for the direct-connect path ("Android has no
 * `HostController`/probe-then-persist two-step yet ... the lifecycle
 * this module opens *is* the app's connection, not a disposable
 * reachability probe"). This module follows that same precedent: on
 * success it hands back the *live* lifecycle, and the caller owns
 * disposing it. Wiring a saved-profile list for relay pairings (so a
 * paired daemon can be reconnected without re-pasting the offer) remains
 * for whichever task first wires Android's profile-picker UI to a relay
 * target; `credential-store.ts` is untouched here because the *offer*
 * itself still carries no secret to route through it — its
 * `daemonPublicKeyB64` is a *public* key (`hosts/types.ts`'s
 * `RelayHostConnectionProfile` docstring: "not a secret by itself"). The
 * *daemon's own password*, when the caller supplies one (see `password`
 * below), is a secret, but it is never written to storage by this
 * module either way — it only ever reaches
 * `DaemonClientLifecycleConfig.password` for the one connection attempt
 * this function makes, exactly like `daemon-connect-attempt.ts`'s direct
 * path.
 *
 * Four failure kinds are surfaced distinctly, matching this task's
 * (T32A5) acceptance criterion ("Wrong password and wrong daemon key
 * produce different errors") and, for the three web already had, T27A6's
 * taxonomy:
 *
 * - `"malformed"`: the input never became a valid v2 `ConnectionOffer`
 *   (bad base64/JSON, a schema mismatch, or no offer payload at all).
 *   Rejected before any connection attempt.
 * - `"wrong-password"` (T32A5): the offer parsed, its relay and the
 *   daemon behind it were reachable, but the daemon's own
 *   `paseo.bearer.<token>` password check rejected the `password`
 *   argument (or its absence) — a credential failure, distinct from a
 *   possible man-in-the-middle. `daemon-connection-error.ts`'s
 *   `classifyConnectionError` recognizes the daemon's exact
 *   `"incorrect password"`/`"password required"` close reasons
 *   (`WRONG_PASSWORD_REASONS`), the same set the direct path matches.
 * - `"wrong-daemon-key"`: the offer parsed and its relay was reachable,
 *   but the pinned `daemonPublicKeyB64` no longer matches the daemon's
 *   real key — a *possible man-in-the-middle*, never folded into the
 *   credential-failure copy above. `daemon-connection-error.ts`'s
 *   `classifyConnectionError` recognizes the relay encrypted channel's
 *   `"Decryption failed"` close reason.
 * - `"expired"`: the input parsed into a well-formed offer, but the
 *   relay/daemon it names could not be reached or complete the
 *   encrypted handshake for any other reason — covers both a genuinely
 *   unreachable relay (the WebSocket never opens — the relay host is
 *   down or unroutable) and a *reachable relay whose named daemon isn't
 *   currently attached* (`packages/relay/src/cloudflare-adapter.ts`'s
 *   `webSocketClose` closes the client side with the exact reason
 *   `"Server disconnected"` once the daemon side's own socket drops —
 *   see `classifyConnectionError`'s docstring for why this collapses
 *   into the same `"unknown"`-classified, non-alarming
 *   `RELAY_UNREACHABLE_MESSAGE` copy as a plain network failure rather
 *   than getting its own `ConnectionErrorKind`: nothing in the wire
 *   protocol lets a client tell "this daemon was never paired here" and
 *   "this relay is merely slow" apart before its own connect-timeout
 *   fires either way, so inventing a fifth kind for the one case that
 *   *is* observable — the daemon actively dropping mid-buffer — would
 *   describe a distinction the taxonomy can't keep consistently). Both
 *   are rejected only after trying, never persisted. See
 *   `apply-connection-offer.test.ts`'s "classifies a relay-reachable
 *   daemon-side disconnect as 'expired', not 'wrong-daemon-key' or
 *   'wrong-password'" and "classifies an unreachable relay endpoint as
 *   'expired'" for both wire shapes proven distinct from the two
 *   credential-shaped kinds above.
 *
 * There is no `expiresAt`/issued-at timestamp anywhere in
 * `ConnectionOfferV2Schema` (`@picompanion/protocol/connection-offer`)
 * to compare against a clock — "expired" here, exactly as on web, is
 * determined empirically by whether the pinned connection still
 * completes, not by comparing timestamps. Nothing in this module calls
 * `Date.now()`, `setTimeout`, or otherwise measures elapsed time
 * itself, so it takes no `Clock` dependency: `DaemonClientLifecycle`
 * owns its own connect-timeout internally, the same way it already does
 * for `daemon-connect-attempt.ts`'s direct-connect path, which also
 * takes no `Clock`.
 */
import { connection, hosts } from "@picompanion/frontend-core";
import {
  parseConnectionOfferFromUrl,
  type ConnectionOffer,
} from "@picompanion/protocol/connection-offer";

import {
  classifyConnectionError,
  describeRelayConnectionError,
} from "./daemon-connection-error.js";

/** Thrown only by `parseConnectionOfferInput`; never a raw zod/JSON/base64 error. */
export class ConnectionOfferParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionOfferParseError";
  }
}

const EMPTY_INPUT_MESSAGE = "Paste a pairing link.";
const MALFORMED_MESSAGE =
  "This pairing link isn't valid. Check it was copied in full and try again.";

/** Normalizes bare-fragment and raw-payload input into the `#offer=<payload>` shape `parseConnectionOfferFromUrl` expects. */
function normalizeOfferFragment(trimmed: string): string {
  if (trimmed.includes("#offer=")) return trimmed;
  if (trimmed.startsWith("offer=")) return `#${trimmed}`;
  return `#offer=${trimmed}`;
}

/**
 * Parses a pairing-offer URL, a bare `#offer=`/`offer=` fragment, or the
 * raw base64url payload on its own into a `ConnectionOffer`. Throws
 * `ConnectionOfferParseError` — never a raw zod/JSON/base64 error — for
 * anything that is not a well-formed v2 offer, so callers can show one
 * distinct, human-readable "malformed" message without inspecting the
 * failure's shape themselves. Byte-for-byte the same logic as `apps/
 * web`'s `parseConnectionOfferInput`.
 */
export function parseConnectionOfferInput(input: string): ConnectionOffer {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ConnectionOfferParseError(EMPTY_INPUT_MESSAGE);
  }
  try {
    const offer = parseConnectionOfferFromUrl(normalizeOfferFragment(trimmed));
    if (!offer) {
      throw new ConnectionOfferParseError(MALFORMED_MESSAGE);
    }
    return offer;
  } catch (error) {
    if (error instanceof ConnectionOfferParseError) throw error;
    throw new ConnectionOfferParseError(MALFORMED_MESSAGE);
  }
}

export interface ApplyConnectionOfferSuccess {
  ok: true;
  kind: "success";
  /** The live, still-connected lifecycle for this pairing. Caller owns its disposal. */
  lifecycle: connection.DaemonClientLifecycle;
  /** The relay profile this offer described — `hosts.RelayHostConnectionProfile` shape, for a caller that wants to label the connection or save it later. */
  relay: hosts.RelayHostConnectionProfile;
  label: string;
}

export interface ApplyConnectionOfferFailure {
  ok: false;
  kind: "malformed" | "wrong-password" | "wrong-daemon-key" | "expired";
  /** A human-readable, non-alarming reason the attempt did not succeed. */
  error: string;
}

export type ApplyConnectionOfferResult = ApplyConnectionOfferSuccess | ApplyConnectionOfferFailure;

/**
 * `password` (T32A5) is the relay-paired daemon's own
 * `paseo.bearer.<token>` password, when the caller has one to offer —
 * optional because most relay pairings have no daemon password at all
 * (the offer's E2EE key pinning is the only trust anchor). Never
 * persisted by this module; see the module docstring.
 */
export type ApplyConnectionOfferAttempt = (
  input: string,
  password?: string,
) => Promise<ApplyConnectionOfferResult>;

export interface CreateApplyConnectionOfferOptions {
  clientId: string;
  clientType?: "mobile" | "browser" | "cli" | "mcp";
  appVersion?: string;
  connectTimeoutMs?: number;
  /** Overrides the real `DaemonClient` construction; test/DI seam — proves this module "against the injected transport", never a real socket. */
  createDaemonClient?: connection.DaemonClientFactory;
}

/**
 * Builds an `ApplyConnectionOfferAttempt`: parses the input
 * (`parseConnectionOfferInput`), then — only if it parsed — opens one
 * `DaemonClientLifecycle` generation against the offer's relay target,
 * E2EE-pinned to its `daemonPublicKeyB64` and carrying `password` (if
 * given) exactly like the direct path's `daemon-connect-attempt.ts`
 * does, and reports which of `"success"`/`"malformed"`/
 * `"wrong-password"`/`"wrong-daemon-key"`/`"expired"` the attempt
 * produced.
 */
export function createApplyConnectionOfferAttempt(
  options: CreateApplyConnectionOfferOptions,
): ApplyConnectionOfferAttempt {
  return async function applyConnectionOffer(
    input: string,
    password?: string,
  ): Promise<ApplyConnectionOfferResult> {
    let offer: ConnectionOffer;
    try {
      offer = parseConnectionOfferInput(input);
    } catch (error) {
      return {
        ok: false,
        kind: "malformed",
        error: error instanceof Error ? error.message : MALFORMED_MESSAGE,
      };
    }

    const draft = hosts.hostProfileDraftFromConnectionOffer(offer);
    const relay = draft.relay;
    /* istanbul ignore next -- hostProfileDraftFromConnectionOffer always sets `relay` from the offer it was just given. */
    if (!relay) {
      return { ok: false, kind: "malformed", error: MALFORMED_MESSAGE };
    }

    const lifecycle = new connection.DaemonClientLifecycle({
      url: hosts.buildRelayConnectionUrl(relay),
      clientId: options.clientId,
      clientType: options.clientType ?? "mobile",
      ...(options.appVersion !== undefined ? { appVersion: options.appVersion } : {}),
      ...(options.connectTimeoutMs !== undefined
        ? { connectTimeoutMs: options.connectTimeoutMs }
        : {}),
      e2ee: { enabled: true, daemonPublicKeyB64: relay.daemonPublicKeyB64 },
      ...(password !== undefined ? { password } : {}),
      ...(options.createDaemonClient !== undefined
        ? { createDaemonClient: options.createDaemonClient }
        : {}),
      reconnect: { enabled: false },
    });

    try {
      await lifecycle.connect();
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      await lifecycle.dispose();
      const classified = classifyConnectionError(rawMessage);
      return {
        ok: false,
        kind:
          classified === "wrong-password" || classified === "wrong-daemon-key"
            ? classified
            : "expired",
        error: describeRelayConnectionError(rawMessage),
      };
    }

    return { ok: true, kind: "success", lifecycle, relay, label: draft.label };
  };
}
