/**
 * Connection domain — plan.md §6/§7.1/§12.1.
 *
 * Owns `DaemonClient` construction and lifecycle, the hello exchange,
 * and enabling server feature gates exactly once per connection
 * (T19A — "Implement DaemonClient lifecycle and feature gates").
 *
 * Host profiles, connection probing, reconnect policy, and
 * direct-versus-relay selection build on top of this in `hosts/`
 * (T19B); do not add that logic here.
 *
 * `ResumeController` (T46A2) decides *when* a caller must run an
 * authoritative reconciliation — a host-supplied resume signal (app
 * foregrounded, network back online), or a bounded periodic check while a
 * run is active — without owning the reconciliation itself; see
 * `./resume-controller.ts`.
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */

export { PI_COMPANION_CLIENT_CAPABILITIES } from "./client-capabilities.js";
export type { ClientCapability } from "./client-capabilities.js";

export {
  EMPTY_FEATURE_GATE_SNAPSHOT,
  deriveFeatureGateSnapshot,
  isFeatureEnabled,
} from "./feature-gates.js";
export type {
  FeatureGateSnapshot,
  ServerCapabilities,
  ServerFeatureFlags,
  ServerFeatureId,
} from "./feature-gates.js";

export { DaemonClientLifecycle } from "./daemon-client-lifecycle.js";
export type {
  DaemonClientFactory,
  DaemonClientLifecycleConfig,
  DaemonClientLifecycleStatus,
  DaemonClientLifecycleStatusListener,
  DaemonClientLike,
  DaemonEventHandler,
  FeatureGateListener,
} from "./daemon-client-lifecycle.js";

export { ResumeController } from "./resume-controller.js";
export type {
  ResumeControllerConfig,
  ResumeReconcile,
  ResumeTrigger,
} from "./resume-controller.js";
