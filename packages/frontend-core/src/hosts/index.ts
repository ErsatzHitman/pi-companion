/**
 * Hosts domain — plan.md §6/§7.1, T19B ("Implement host registry,
 * probing, and relay selection").
 *
 * Owns host profiles (`types.ts`, `host-profile-store.ts`), building a
 * profile from pairing input (`pairing.ts`), turning a profile into
 * WebSocket URLs in direct-preferred/relay-fallback order
 * (`connection-url.ts`), probing which of those is reachable right now
 * (`connection-prober.ts`), the reconnect/relay-switch backoff decision
 * (`reconnect-policy.ts`), and the orchestrator that ties all of the
 * above to the T19A `DaemonClientLifecycle` (`host-controller.ts`).
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */

export type {
  DirectHostConnectionProfile,
  HostConnectionKind,
  HostProfile,
  HostProfileDraft,
  RelayHostConnectionProfile,
} from "./types.js";
export { hasDirectConnection, hasRelayConnection } from "./types.js";

export {
  alternateConnectionKind,
  buildConnectionUrlForKind,
  buildDirectConnectionUrl,
  buildRelayConnectionUrl,
  preferredConnectionKind,
  resolveConnectionTargets,
} from "./connection-url.js";
export type { HostConnectionTarget } from "./connection-url.js";

export {
  hostProfileDraftFromConnectionOffer,
  hostProfileDraftFromDirectConnection,
} from "./pairing.js";
export type {
  HostProfileDraftFromDirectConnectionResult,
  HostProfileDraftOverrides,
} from "./pairing.js";

export { HostProfileStore } from "./host-profile-store.js";
export type { HostProfileStoreConfig } from "./host-profile-store.js";

export { ConnectionProber } from "./connection-prober.js";
export type {
  ConnectionProberConfig,
  HostProbeAttempt,
  HostProbeOutcome,
  HostProbeSelection,
  HostProbeTransport,
} from "./connection-prober.js";

export { ReconnectPolicy } from "./reconnect-policy.js";
export type { ReconnectDecision, ReconnectPolicyConfig } from "./reconnect-policy.js";

export { HostController } from "./host-controller.js";
export type {
  HostConnectResult,
  HostControllerConfig,
  HostControllerConnectionInfo,
  HostControllerConnectionInfoListener,
  HostControllerConnectionStatus,
  HostControllerLifecycleLike,
  HostLifecycleFactory,
} from "./host-controller.js";
