/**
 * Pi Companion's declared client capability set — plan.md §7.1/§12.1.
 *
 * `@picompanion/client`'s `DaemonClient` already sends a small hardcoded
 * subset of capabilities on every hello (see its `sendHelloMessage`).
 * This module is the single place Pi Companion declares the *full*
 * capability set it supports, so every hello — on every connection, for
 * every platform (`apps/web`, `apps/android`) — advertises the same
 * fixed set. `DaemonClientLifecycle` merges this over `DaemonClient`'s
 * own defaults exactly once, at construction time, never per message.
 *
 * Kept in sync with the recorded fixture at
 * `@picompanion/protocol/fixtures/daemon-ws/hello-capability-negotiation`.
 */
import { CLIENT_CAPS, type ClientCapability } from "@picompanion/protocol/client-capabilities";

/**
 * Capabilities outside the ported `CLIENT_CAPS` registry that the
 * recorded hello fixture still declares (explicit `false` opt-outs).
 * Kept as plain string keys — not part of `@picompanion/protocol`'s
 * typed `ClientCapability` union — since Pi Companion does not yet
 * implement voice or push notifications (plan.md §7.1 lists them as
 * future platform interfaces, not yet wired to a hello capability).
 */
const UNTYPED_CLIENT_CAPABILITY_OPT_OUTS: Record<string, boolean> = {
  voice: false,
  pushNotifications: false,
};

/**
 * The full set of hello capabilities Pi Companion declares on every
 * connection. `DaemonClientLifecycle` spreads any caller-supplied
 * override on top of this (see `DaemonClientLifecycleConfig.capabilities`),
 * which exists for tests, not for per-connection variation.
 *
 * Deliberately matches the capability set recorded in the T06B fixture
 * (`@picompanion/protocol/fixtures/daemon-ws/hello-capability-negotiation`)
 * exactly, key-for-key — see `client-capabilities.test.ts`. In particular
 * this does *not* yet declare `piUiPayloadV2`: that capability changes
 * the shape of Pi UI element payloads the daemon sends, and turning it on
 * is T21B/T21C's decision (Pi UI element state and the extension action
 * controller), not this connection-lifecycle task's.
 */
export const PI_COMPANION_CLIENT_CAPABILITIES: Record<string, boolean> = {
  ...UNTYPED_CLIENT_CAPABILITY_OPT_OUTS,
  [CLIENT_CAPS.selectiveAgentTimeline]: true,
  [CLIENT_CAPS.reasoningMergeEnum]: true,
  [CLIENT_CAPS.customModeIcons]: true,
  [CLIENT_CAPS.terminalReflowableSnapshot]: true,
  [CLIENT_CAPS.providerSubagents]: true,
  [CLIENT_CAPS.projectUpdates]: true,
  [CLIENT_CAPS.compactProviderSnapshots]: true,
  [CLIENT_CAPS.piUiBridge]: true,
};

export type { ClientCapability };
