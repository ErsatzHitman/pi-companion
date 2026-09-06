/**
 * Host profile types — plan.md §7.1/§7.2/§12.1, T19B.
 *
 * A `HostProfile` is local durable state (plan.md §7.2): it never comes
 * from the daemon and the daemon never sees it directly. It records how
 * to reach one daemon, either directly (LAN/loopback WebSocket) or
 * through the hosted relay (`packages/relay`), or both — direct and
 * relay connection details may both be present on the same profile so
 * `ConnectionProber` (`connection-prober.ts`) can choose between them.
 *
 * Deliberately excludes secrets: passwords and relay-authenticating
 * material never live on the `HostProfile` object itself. They are
 * addressed by the profile's `id` in `SecureStorage` via
 * `HostProfileStore` (`host-profile-store.ts`) instead, matching
 * plan.md §12.1's "private material never enters a URL query" and
 * §12.5/§15's "never persist a plaintext daemon password" posture.
 */

export type HostConnectionKind = "direct" | "relay";

/** A direct LAN/loopback WebSocket target — plan.md §12.1's direct path. */
export interface DirectHostConnectionProfile {
  /** `host:port`, e.g. `localhost:6767` or `[::1]:6767`. */
  endpoint: string;
  useTls: boolean;
}

/**
 * A hosted-relay target — plan.md §12.1's relay path, sourced from a
 * `ConnectionOffer` (`@picompanion/protocol/connection-offer`). The
 * relay only ever proxies the encrypted transport; `daemonPublicKeyB64`
 * is what the relay-aware transport in `@picompanion/client` pins
 * against, not a secret by itself.
 */
export interface RelayHostConnectionProfile {
  /** `host:port` of the relay, e.g. `relay.paseo.sh:443`. */
  endpoint: string;
  useTls: boolean;
  serverId: string;
  daemonPublicKeyB64: string;
}

export interface HostProfile {
  id: string;
  label: string;
  direct?: DirectHostConnectionProfile;
  relay?: RelayHostConnectionProfile;
  /**
   * Whether `ConnectionProber` should try the direct target before the
   * relay target when both are configured. `true` unless the profile
   * was created from a relay-only `ConnectionOffer` (which has no
   * direct target to prefer in the first place).
   */
  preferDirect: boolean;
  createdAt: number;
  updatedAt: number;
  lastConnectedAt: number | null;
  lastConnectionKind: HostConnectionKind | null;
}

/**
 * Input to `HostProfileStore.save`. Omitting `id` creates a new profile
 * (the store assigns one); providing an existing `id` updates that
 * profile's fields in place while preserving its `createdAt`,
 * `lastConnectedAt`, and `lastConnectionKind`.
 */
export type HostProfileDraft = Pick<HostProfile, "label"> &
  Partial<Pick<HostProfile, "id" | "direct" | "relay" | "preferDirect">>;

export function hasDirectConnection(
  profile: HostProfile,
): profile is HostProfile & { direct: DirectHostConnectionProfile } {
  return profile.direct !== undefined;
}

export function hasRelayConnection(
  profile: HostProfile,
): profile is HostProfile & { relay: RelayHostConnectionProfile } {
  return profile.relay !== undefined;
}
