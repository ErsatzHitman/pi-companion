/**
 * Connection attempt wiring — plan.md §7.1/§12.1, T27A1.
 *
 * Turns a validated `ConnectDraft` (`validate-connect-form.ts`) into a
 * real "connection attempt through core": it builds an in-memory
 * `hosts.HostProfile` and asks `@picompanion/frontend-core`'s
 * `hosts.ConnectionProber` whether the profile's direct target is
 * reachable, using this app's `browser-probe-transport.ts`. Every
 * attempt (reachable or not) is core's own `HostProbeAttempt` record,
 * not a UI-invented approximation of one.
 *
 * Deliberately stops at "is this reachable" and does not persist the
 * profile (`HostProfileStore`) or open an authenticated
 * `DaemonClientLifecycle` (`HostController.connectToProfile`):
 * persistence and bearer-token auth are T27A2's scope.
 */
import { hosts } from "@picompanion/frontend-core";
import type { Clock } from "@picompanion/frontend-core";

import { createBrowserHostProbeTransport } from "./browser-probe-transport.js";
import type { ConnectDraft } from "./validate-connect-form.js";

export interface ConnectAttemptOutcome {
  ok: boolean;
  selectedKind: hosts.HostConnectionKind | null;
  attempts: hosts.HostProbeAttempt[];
}

export type HostConnectAttempt = (draft: ConnectDraft) => Promise<ConnectAttemptOutcome>;

export interface CreateHostConnectAttemptOptions {
  clock: Clock;
  /** Overrides the default browser `WebSocket`-backed probe transport; test-only. */
  probe?: hosts.HostProbeTransport;
  probeTimeoutMs?: number;
}

/** Builds a `HostConnectAttempt` bound to one `ConnectionProber` instance, reused across submissions. */
export function createHostConnectAttempt(
  options: CreateHostConnectAttemptOptions,
): HostConnectAttempt {
  const prober = new hosts.ConnectionProber({
    clock: options.clock,
    probe: options.probe ?? createBrowserHostProbeTransport(),
    ...(options.probeTimeoutMs !== undefined ? { timeoutMs: options.probeTimeoutMs } : {}),
  });

  return async function attemptHostConnection(draft: ConnectDraft): Promise<ConnectAttemptOutcome> {
    const now = options.clock.now();
    const profile: hosts.HostProfile = {
      id: "connect-form-draft",
      label: draft.label,
      direct: draft.direct,
      preferDirect: draft.preferDirect,
      createdAt: now,
      updatedAt: now,
      lastConnectedAt: null,
      lastConnectionKind: null,
    };

    const selection = await prober.selectConnection(profile);
    return {
      ok: selection.selectedKind !== null,
      selectedKind: selection.selectedKind,
      attempts: selection.attempts,
    };
  };
}
