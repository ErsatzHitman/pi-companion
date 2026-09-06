/**
 * ConnectionOffer pairing — plan.md §7.1/§12.1/§12.5, T27A3.
 *
 * Turns pasted pairing-offer input (a full `https://app.paseo.sh/#offer=<base64url>`
 * URL, a bare `#offer=`/`offer=` fragment, or the raw base64url payload
 * on its own — the same shapes a QR scan, T27A4's job, will feed
 * through this same `parseConnectionOfferInput`/`createApplyConnectionOfferAttempt`
 * pair) into a relay-only `hosts.HostProfile`
 * (`hosts.hostProfileDraftFromConnectionOffer`) and attempts one
 * disposable `connection.DaemonClientLifecycle` connection through it
 * before persisting anything — mirroring `authenticate-host.ts`'s
 * "prove it works before you save it" posture for the direct-connect
 * path (T27A2).
 *
 * Three failure kinds are surfaced distinctly, matching this task's and
 * T27A6's acceptance criteria:
 *
 * - `"malformed"`: the input never became a valid v2 `ConnectionOffer`
 *   (bad base64/JSON, a schema mismatch, or no offer payload at all).
 *   Rejected before any network attempt.
 * - `"wrong-daemon-key"` (T27A6): the offer parsed and its relay was
 *   reachable, but the pinned `daemonPublicKeyB64` no longer matches
 *   the daemon's real key — `connection-error.ts`'s
 *   `classifyConnectionError` recognizes the relay encrypted channel's
 *   `"Decryption failed"` close reason. Named distinctly rather than
 *   folded into `"expired"`, so it never reads the same as a wrong
 *   password would on the direct-connect path.
 * - `"expired"`: the input parsed into a well-formed offer, but the
 *   relay/daemon it names could not be reached or completed the
 *   encrypted handshake for any other reason — the pairing session the
 *   link once named is no longer usable (the daemon that issued it went
 *   offline or was re-paired). Rejected only after trying, and never
 *   persisted.
 *
 * `daemonPublicKeyB64` only ever reaches
 * `DaemonClientLifecycleConfig.e2ee`, and the relay WebSocket URL
 * (`hosts.buildRelayConnectionUrl`) never carries it or any other
 * private material as a query parameter — plan.md §12.1's "private
 * material never enters a URL query".
 */
import { connection, hosts } from "@picompanion/frontend-core";
import type { Clock, SecureStorage, StructuredStorage } from "@picompanion/frontend-core";
import {
  parseConnectionOfferFromUrl,
  type ConnectionOffer,
} from "@picompanion/protocol/connection-offer";

import {
  RELAY_UNREACHABLE_MESSAGE,
  classifyConnectionError,
  describeRelayConnectionError,
} from "./connection-error.js";

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
/**
 * Kept as its own export (T27A3) for callers already matching on this
 * exact string; identical to `connection-error.ts`'s
 * `RELAY_UNREACHABLE_MESSAGE`, the taxonomy's fallback copy for any
 * relay/offer failure that isn't specifically a wrong daemon key
 * (T27A6).
 */
export const CONNECTION_OFFER_EXPIRED_MESSAGE = RELAY_UNREACHABLE_MESSAGE;

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
 * failure's shape themselves.
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

export interface ApplyConnectionOfferOutcome {
  /** True only once the offer parsed, the relay/daemon accepted the handshake, and the resulting profile was persisted. */
  ok: boolean;
  kind: "success" | "malformed" | "wrong-daemon-key" | "expired";
  /** The label the resulting (or attempted) profile would use, derived from the offer's relay endpoint; `null` for a malformed offer. */
  label: string | null;
  /** The persisted `HostProfile.id`, once `ok`; `null` otherwise. */
  savedProfileId: string | null;
  /** A human-readable reason the attempt did not succeed; `null` when `ok`. */
  error: string | null;
}

export type ApplyConnectionOfferAttempt = (input: string) => Promise<ApplyConnectionOfferOutcome>;

export interface CreateApplyConnectionOfferOptions {
  clock: Clock;
  storage: StructuredStorage;
  secrets: SecureStorage;
  clientId: string;
  clientType?: "mobile" | "browser" | "cli" | "mcp";
  appVersion?: string;
  /** Overrides the real `DaemonClient` construction used to verify the offer still connects; test-only. */
  createDaemonClient?: connection.DaemonClientFactory;
}

/**
 * Builds an `ApplyConnectionOfferAttempt`: parses the input
 * (`parseConnectionOfferInput`), then — only if it parsed — opens one
 * short-lived, disposable, E2EE-pinned `DaemonClientLifecycle`
 * generation against the offer's relay target to confirm it is still
 * live. Persists the resulting relay-only `HostProfile`
 * (`hosts.HostProfileStore`) only once that connection succeeds, so a
 * stale pairing link is never written to storage.
 */
export function createApplyConnectionOfferAttempt(
  options: CreateApplyConnectionOfferOptions,
): ApplyConnectionOfferAttempt {
  const profiles = new hosts.HostProfileStore({
    storage: options.storage,
    secrets: options.secrets,
    clock: options.clock,
  });

  return async function applyConnectionOffer(input: string): Promise<ApplyConnectionOfferOutcome> {
    let offer: ConnectionOffer;
    try {
      offer = parseConnectionOfferInput(input);
    } catch (error) {
      return {
        ok: false,
        kind: "malformed",
        label: null,
        savedProfileId: null,
        error: error instanceof Error ? error.message : MALFORMED_MESSAGE,
      };
    }

    const draft = hosts.hostProfileDraftFromConnectionOffer(offer);
    const relay = draft.relay;
    /* istanbul ignore next -- hostProfileDraftFromConnectionOffer always sets `relay` from the offer it was just given. */
    if (!relay) {
      return {
        ok: false,
        kind: "malformed",
        label: draft.label,
        savedProfileId: null,
        error: MALFORMED_MESSAGE,
      };
    }

    const lifecycle = new connection.DaemonClientLifecycle({
      url: hosts.buildRelayConnectionUrl(relay),
      clientId: options.clientId,
      ...(options.clientType !== undefined ? { clientType: options.clientType } : {}),
      ...(options.appVersion !== undefined ? { appVersion: options.appVersion } : {}),
      e2ee: { enabled: true, daemonPublicKeyB64: relay.daemonPublicKeyB64 },
      ...(options.createDaemonClient !== undefined
        ? { createDaemonClient: options.createDaemonClient }
        : {}),
      reconnect: { enabled: false },
    });

    try {
      try {
        await lifecycle.connect();
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          kind:
            classifyConnectionError(rawMessage) === "wrong-daemon-key"
              ? "wrong-daemon-key"
              : "expired",
          label: draft.label,
          savedProfileId: null,
          error: describeRelayConnectionError(rawMessage),
        };
      }
    } finally {
      await lifecycle.dispose();
    }

    const saved = await profiles.save(draft);

    return {
      ok: true,
      kind: "success",
      label: saved.label,
      savedProfileId: saved.id,
      error: null,
    };
  };
}
