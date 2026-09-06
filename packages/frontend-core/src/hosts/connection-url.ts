/**
 * Host profile -> WebSocket URL resolution — plan.md §12.1, T19B.
 *
 * Turns a `HostProfile`'s direct/relay connection details into the
 * concrete WebSocket URL `@picompanion/client`'s `DaemonClient` (and,
 * before that, `ConnectionProber`) connects to. Delegates the actual URL
 * construction to `@picompanion/protocol/daemon-endpoints`, which is the
 * single source of truth for the daemon's `/ws` path and the relay's
 * `serverId`/`role`/`v` query parameters — this module never builds a
 * URL by hand.
 *
 * `resolveConnectionTargets` is also where direct-preferred, relay-fallback
 * ordering is decided: it returns targets in the order `ConnectionProber`
 * and `HostController` should try them, honoring `HostProfile.preferDirect`
 * and skipping any connection kind the profile does not configure.
 */
import {
  buildDaemonWebSocketUrl,
  buildRelayWebSocketUrl,
  CURRENT_RELAY_PROTOCOL_VERSION,
} from "@picompanion/protocol/daemon-endpoints";
import type {
  DirectHostConnectionProfile,
  HostConnectionKind,
  HostProfile,
  RelayHostConnectionProfile,
} from "./types.js";

export interface HostConnectionTarget {
  kind: HostConnectionKind;
  url: string;
}

export function buildDirectConnectionUrl(direct: DirectHostConnectionProfile): string {
  return buildDaemonWebSocketUrl(direct.endpoint, { useTls: direct.useTls });
}

export function buildRelayConnectionUrl(relay: RelayHostConnectionProfile): string {
  return buildRelayWebSocketUrl({
    endpoint: relay.endpoint,
    useTls: relay.useTls,
    serverId: relay.serverId,
    role: "client",
    version: CURRENT_RELAY_PROTOCOL_VERSION,
  });
}

export function buildConnectionUrlForKind(profile: HostProfile, kind: HostConnectionKind): string {
  if (kind === "direct") {
    if (!profile.direct) {
      throw new Error(`Host profile ${profile.id} has no direct connection configured`);
    }
    return buildDirectConnectionUrl(profile.direct);
  }
  if (!profile.relay) {
    throw new Error(`Host profile ${profile.id} has no relay connection configured`);
  }
  return buildRelayConnectionUrl(profile.relay);
}

/**
 * Returns the connection kinds configured on `profile`, in the order
 * they should be attempted: direct before relay when
 * `profile.preferDirect` is true (the default posture — plan.md §12.1
 * "may bootstrap from ... direct" — and this task's "probing prefers
 * direct and falls back to relay deterministically" acceptance
 * criterion), relay before direct otherwise. A kind with no configured
 * connection details is omitted, never attempted.
 */
export function resolveConnectionTargets(profile: HostProfile): HostConnectionTarget[] {
  const targets: HostConnectionTarget[] = [];
  const addDirect = () => {
    if (profile.direct) {
      targets.push({ kind: "direct", url: buildDirectConnectionUrl(profile.direct) });
    }
  };
  const addRelay = () => {
    if (profile.relay) {
      targets.push({ kind: "relay", url: buildRelayConnectionUrl(profile.relay) });
    }
  };
  if (profile.preferDirect) {
    addDirect();
    addRelay();
  } else {
    addRelay();
    addDirect();
  }
  return targets;
}

/** The connection kind `resolveConnectionTargets` would try first, or `null` if the profile has no configured connection at all. */
export function preferredConnectionKind(profile: HostProfile): HostConnectionKind | null {
  return resolveConnectionTargets(profile)[0]?.kind ?? null;
}

/** The other configured kind, or `null` if `profile` only configures `kind` (or neither). */
export function alternateConnectionKind(
  profile: HostProfile,
  kind: HostConnectionKind,
): HostConnectionKind | null {
  const other: HostConnectionKind = kind === "direct" ? "relay" : "direct";
  const targets = resolveConnectionTargets(profile);
  return targets.some((target) => target.kind === other) ? other : null;
}
