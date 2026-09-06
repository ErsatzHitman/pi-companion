/**
 * Host profile drafts from pairing input — plan.md §12.1, T19B.
 *
 * Turns the two existing wire-level connection descriptors — the
 * relay-only `ConnectionOffer` (`@picompanion/protocol/connection-offer`,
 * decoded from a QR/pairing URL) and a direct `host:port` connection
 * descriptor (`@picompanion/protocol/host-connection-schema`) — into a
 * `HostProfileDraft` ready for `HostProfileStore.save`. Never persists
 * anything itself, and never lets a plaintext password ride along inside
 * the draft: `hostProfileDraftFromDirectConnection` returns the password
 * separately so callers pass it to `HostProfileStore.save`'s own
 * `options.password`, which routes it to `SecureStorage`.
 */
import {
  deriveLabelFromEndpoint,
  normalizeLoopbackToLocalhost,
} from "@picompanion/protocol/daemon-endpoints";
import type { ConnectionOffer } from "@picompanion/protocol/connection-offer";
import {
  DirectTcpHostConnectionSchema,
  type DirectTcpHostConnection,
} from "@picompanion/protocol/host-connection-schema";
import type { HostProfileDraft } from "./types.js";

export interface HostProfileDraftOverrides {
  id?: string;
  label?: string;
  preferDirect?: boolean;
}

/**
 * A `ConnectionOffer` only ever describes a relay target (see that
 * module's docstring), so the resulting draft configures `relay` only
 * and sets `preferDirect: false` — there is nothing direct to prefer
 * until the user separately adds a direct connection to the same
 * profile.
 */
export function hostProfileDraftFromConnectionOffer(
  offer: ConnectionOffer,
  overrides: HostProfileDraftOverrides = {},
): HostProfileDraft {
  return {
    ...(overrides.id !== undefined ? { id: overrides.id } : {}),
    label: overrides.label ?? deriveLabelFromEndpoint(offer.relay.endpoint),
    relay: {
      endpoint: offer.relay.endpoint,
      useTls: offer.relay.useTls ?? true,
      serverId: offer.serverId,
      daemonPublicKeyB64: offer.daemonPublicKeyB64,
    },
    preferDirect: overrides.preferDirect ?? false,
  };
}

export interface HostProfileDraftFromDirectConnectionResult {
  draft: HostProfileDraft;
  /** The direct connection's password, if any, kept out of `draft` on purpose. `undefined` when the input carried none. */
  password: string | undefined;
}

/**
 * Validates and normalizes `input` against
 * `DirectTcpHostConnectionSchema` (defaulting `useTls`, normalizing a
 * loopback endpoint to `localhost` so cached profiles remain stable
 * across `127.0.0.1`/`0.0.0.0`/`::1` variants of the same daemon), then
 * builds a direct-only `HostProfileDraft`.
 */
export function hostProfileDraftFromDirectConnection(
  input: DirectTcpHostConnection,
  overrides: HostProfileDraftOverrides = {},
): HostProfileDraftFromDirectConnectionResult {
  const normalized = DirectTcpHostConnectionSchema.parse(input);
  const endpoint = normalizeLoopbackToLocalhost(normalized.endpoint);
  return {
    draft: {
      id: overrides.id ?? normalized.id,
      label: overrides.label ?? deriveLabelFromEndpoint(endpoint),
      direct: { endpoint, useTls: normalized.useTls },
      preferDirect: overrides.preferDirect ?? true,
    },
    password: normalized.password,
  };
}
