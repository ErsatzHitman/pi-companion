/**
 * Server feature gates — plan.md §7.1/§12.1.
 *
 * The daemon advertises per-feature flags on `server_info` (the response
 * to hello). `DaemonClientLifecycle` turns that raw payload into a
 * frozen `FeatureGateSnapshot` exactly once per connection (see
 * `daemon-client-lifecycle.ts`), so the rest of `frontend-core` never
 * re-derives or re-toggles gates ad hoc from raw daemon events.
 *
 * Deliberately depends on `@picompanion/protocol`'s `ServerInfoStatusPayload`
 * type only (never a value/schema import), so the feature id list has one
 * source of truth and this module still type-checks without React, DOM,
 * or any runtime dependency.
 */
import type { ServerInfoStatusPayload } from "@picompanion/protocol/messages";

/** Every feature id the daemon may advertise under `server_info.features`. */
export type ServerFeatureId = keyof NonNullable<ServerInfoStatusPayload["features"]>;

export type ServerFeatureFlags = Partial<Record<ServerFeatureId, boolean>>;

export type ServerCapabilities = NonNullable<ServerInfoStatusPayload["capabilities"]>;

/**
 * The result of one connection's hello/capability negotiation.
 *
 * `negotiated` is false until the first `server_info` for the current
 * connection generation has been observed; every other field is a
 * placeholder until then. Once negotiated, this snapshot is frozen and
 * does not change again for the lifetime of that connection generation
 * — see `DaemonClientLifecycle.maybeNegotiateFeatureGates`.
 */
export interface FeatureGateSnapshot {
  negotiated: boolean;
  serverId: string | null;
  hostname: string | null;
  version: string | null;
  desktopManaged: boolean;
  features: ServerFeatureFlags;
  capabilities: ServerCapabilities | undefined;
}

export const EMPTY_FEATURE_GATE_SNAPSHOT: FeatureGateSnapshot = Object.freeze({
  negotiated: false,
  serverId: null,
  hostname: null,
  version: null,
  desktopManaged: false,
  features: Object.freeze({}),
  capabilities: undefined,
});

/** Builds a frozen `FeatureGateSnapshot` from a validated `server_info` payload. */
export function deriveFeatureGateSnapshot(
  serverInfo: ServerInfoStatusPayload,
): FeatureGateSnapshot {
  return Object.freeze({
    negotiated: true,
    serverId: serverInfo.serverId,
    hostname: serverInfo.hostname ?? null,
    version: serverInfo.version ?? null,
    desktopManaged: serverInfo.desktopManaged ?? false,
    features: Object.freeze({ ...(serverInfo.features ?? {}) }),
    capabilities: serverInfo.capabilities,
  });
}

/** A feature is enabled only when the daemon explicitly advertised `true`; absent or `false` both mean disabled. */
export function isFeatureEnabled(
  snapshot: FeatureGateSnapshot,
  featureId: ServerFeatureId,
): boolean {
  return snapshot.features[featureId] === true;
}
