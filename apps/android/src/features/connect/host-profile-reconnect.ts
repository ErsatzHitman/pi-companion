/**
 * Reconnecting a saved `HostProfileRecord` — T66 ("Make a relay-paired
 * profile reconnectable and give it a download path"), plan.md §7.1/
 * §12.1.
 *
 * `credential-store.ts` can save and restore a `HostProfileRecord` +
 * `HostProfileSecrets` pair for either connection `kind`, but restoring
 * the *record* was never the same as restoring the *connection* —
 * `connection-shell-model.ts`'s own doc comment named this exact gap
 * for the relay path: a saved relay profile carried no E2EE pin, so
 * nothing could ever pin a `DaemonClientLifecycle` back to it after a
 * cold start. This module is the missing translation from "a restored
 * `(HostProfileRecord, HostProfileSecrets)` pair" to "a live connection
 * attempt" — mirroring `daemon-connect-attempt.ts` (the direct path)
 * and `apply-connection-offer.ts` (the relay path) so closely that most
 * of this file is those two modules' own `DaemonClientLifecycle`
 * construction, branched on `profile.kind` instead of on which UI
 * surface produced the attempt. It does not replace either — a fresh
 * `ConnectForm` submission and a fresh QR pairing still go through their
 * existing modules unchanged; this one is specifically for *reconnecting
 * something already saved*.
 *
 * (CORRECTED at T337: the section below narrates the seam as it stood at
 * T66, and is kept as that record. T32S14 gave this module its
 * user-driven caller -- `connection-shell.tsx`'s "existing profile"
 * submit -- and T337 its automatic one: `app-shell/cold-start-reconnect.
 * ts`'s `reconnectColdStartProfile`, fired by `app/core-context.tsx`'s
 * `AppCoreProvider` once its cold-start profile read settles, after
 * Maestro run 34470287372 measured a relaunch landing on an idle store.)
 *
 * ## Where this plugs in (and the seam this task files)
 *
 * Nothing in `apps/android/src/app/` or `app-shell/` calls this module
 * yet — `app/core-context.tsx`'s `AppCoreProvider` currently only reads
 * `listHostProfiles()` to pick a cold-start *redirect target*
 * (`app/index.tsx`'s `useColdStartProfile()`), never a live connection;
 * no code anywhere calls `AppCore.connection.connect()`/
 * `adoptLifecycle()` automatically for *any* saved profile, direct or
 * relay. That wiring belongs to `app/core-context.tsx` and
 * `app-shell/core.ts`, both T32S13's grant this wave (unowned here) —
 * see this task's report for the exact seam filed there. What this
 * module proves, without touching either file, is the *decision and
 * transport* half: given a restored profile and its secrets, does a
 * reconnect attempt actually reach a connected `DaemonClientLifecycle`,
 * and does a pin that no longer matches land in a distinct, named state
 * rather than either a silent failure or a silent fallback to an
 * unpinned connection. `host-profile-reconnect.test.ts`'s "restores a
 * relay profile from storage and reaches a connected state" proves the
 * former end-to-end (`saveHostProfile` → `listHostProfiles`/
 * `loadHostProfileSecrets` → `createReconnectHostProfile`), against the
 * same injected `connection.DaemonClientFactory` seam
 * `apply-connection-offer.test.ts` already uses — no socket, no
 * emulator.
 *
 * ## The pin-mismatch discrimination (T66's security-relevant criterion)
 *
 * A relay profile's `daemonPublicKeyB64` no longer matching the daemon
 * actually behind the relay is the exact signal of a substituted
 * daemon — it must never be indistinguishable from "cannot reach the
 * host", and it must never be papered over by silently retrying without
 * the pin (this module has no code path that omits `e2ee` for a `kind:
 * "relay"` profile — pinning is not optional here the way it is on a
 * fresh QR pairing's happy path, because there is no un-pinned relay
 * connection to fall back to). `classifyConnectionError` (`daemon-
 * connection-error.ts`) already recognizes the relay encrypted
 * channel's `"Decryption failed"` close reason as `"wrong-daemon-key"`,
 * distinct from `"unreachable"`/`"unknown"` — this module surfaces that
 * distinction as `ReconnectFailure.pinMismatch`, a boolean a caller can
 * branch on without re-deriving it from `kind`. A relay profile with no
 * saved pin at all (secure storage cleared out from under a plain
 * record, say) is classified the same way — `"wrong-daemon-key"`,
 * `pinMismatch: true` — *without even attempting a connection*, because
 * there is nothing to pin against and no honest way to connect without
 * pinning.
 */
import { connection, hosts } from "@picompanion/frontend-core";

import type { HostProfileRecord, HostProfileSecrets } from "./credential-store.js";
import {
  classifyConnectionError,
  describeDirectConnectionError,
  describeRelayConnectionError,
  type ConnectionErrorKind,
} from "./daemon-connection-error.js";

export interface ReconnectHostProfileOptions {
  clientId: string;
  clientType?: "mobile" | "browser" | "cli" | "mcp";
  appVersion?: string;
  connectTimeoutMs?: number;
  /** Injectable, RN-free socket layer — test/DI seam, mirrors `daemon-connect-attempt.ts`'s `webSocketFactory`. Ignored for a `kind: "relay"` reconnect's transport choice the same way it is elsewhere; kept for parity with the direct path. */
  webSocketFactory?: connection.DaemonClientLifecycleConfig["webSocketFactory"];
  /** Test/DI seam that bypasses the socket layer entirely; overrides `webSocketFactory` when supplied. The seam every test in `host-profile-reconnect.test.ts` uses — no real socket. */
  createDaemonClient?: connection.DaemonClientFactory;
}

export interface ReconnectSuccess {
  ok: true;
  /** The live, still-connected lifecycle for this reconnect attempt. Caller owns its disposal, exactly like `daemon-connect-attempt.ts`'s `ConnectAttemptSuccess`. */
  lifecycle: connection.DaemonClientLifecycle;
  /** Echoes `profile.kind` — a caller wiring this into `DaemonConnectionStore` publishes it as `path`, matching `connect()`/`adoptLifecycle()`'s existing "direct"/"relay" vocabulary (`daemon-connection-store.ts`). */
  path: "direct" | "relay";
}

export interface ReconnectFailure {
  ok: false;
  kind: ConnectionErrorKind;
  /** Fixed, human-readable copy — `describeDirectConnectionError`/`describeRelayConnectionError`'s existing vocabulary for every kind but the missing-pin case, which gets its own copy below. */
  error: string;
  /**
   * `true` exactly when this failure means the saved E2EE pin no longer
   * matches (or was never available to check) — the substituted-daemon
   * signal this task's fourth acceptance criterion names. `false` for
   * every other failure, including a merely unreachable relay/daemon —
   * see the module doc's "pin-mismatch discrimination" section. A
   * caller must never treat this the same as `kind === "unreachable"`.
   */
  pinMismatch: boolean;
}

export type ReconnectResult = ReconnectSuccess | ReconnectFailure;

export type ReconnectHostProfile = (
  profile: HostProfileRecord,
  secrets: HostProfileSecrets,
) => Promise<ReconnectResult>;

/**
 * Distinct from `WRONG_DAEMON_KEY_MESSAGE` (`daemon-connection-error.ts`,
 * written for a *fresh pairing link*): this copy is for a *previously
 * saved* profile a user never re-pasted anything for, so "ask for a new
 * pairing link" is the wrong instruction — there is no link in view to
 * ask about.
 */
export const RELAY_PIN_MISMATCH_MESSAGE =
  "This saved connection's security key no longer matches the daemon behind the relay. It won't be reconnected automatically — remove it and pair again to be sure you're talking to the right daemon.";

/** A `kind: "relay"` profile whose secure-storage pin is missing (cleared, or never written) — refused before any connection attempt, never silently connected unpinned. */
export const RELAY_PIN_MISSING_MESSAGE =
  "This saved connection is missing the security key it needs to reconnect safely. Remove it and pair again.";

function buildLifecycleConfig(
  url: string,
  options: ReconnectHostProfileOptions,
  password: string | undefined,
  e2ee: connection.DaemonClientLifecycleConfig["e2ee"],
): connection.DaemonClientLifecycleConfig {
  return {
    url,
    clientId: options.clientId,
    clientType: options.clientType ?? "mobile",
    ...(options.appVersion !== undefined ? { appVersion: options.appVersion } : {}),
    ...(options.connectTimeoutMs !== undefined
      ? { connectTimeoutMs: options.connectTimeoutMs }
      : {}),
    ...(password !== undefined ? { password } : {}),
    ...(e2ee !== undefined ? { e2ee } : {}),
    ...(options.webSocketFactory !== undefined
      ? { webSocketFactory: options.webSocketFactory }
      : {}),
    ...(options.createDaemonClient !== undefined
      ? { createDaemonClient: options.createDaemonClient }
      : {}),
    // A reconnect attempt either succeeds or reports a named failure —
    // it never retries silently in the background, the same posture
    // `daemon-connect-attempt.ts` and `apply-connection-offer.ts` both
    // already take for an initial attempt.
    reconnect: { enabled: false },
  };
}

async function runAttempt(
  config: connection.DaemonClientLifecycleConfig,
  describeError: (rawMessage: string | undefined | null) => string,
  path: "direct" | "relay",
): Promise<ReconnectResult> {
  const lifecycle = new connection.DaemonClientLifecycle(config);
  try {
    await lifecycle.connect();
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    await lifecycle.dispose();
    const classified = classifyConnectionError(rawMessage);
    return {
      ok: false,
      kind: classified,
      error:
        path === "relay" && classified === "wrong-daemon-key"
          ? RELAY_PIN_MISMATCH_MESSAGE
          : describeError(rawMessage),
      pinMismatch: path === "relay" && classified === "wrong-daemon-key",
    };
  }
  return { ok: true, lifecycle, path };
}

/**
 * Builds a `ReconnectHostProfile` bound to one set of client identity
 * options, reused across restored profiles (T66). Branches on
 * `profile.kind`:
 *
 * - `"direct"`: rebuilds `hosts.DirectHostConnectionProfile` from
 *   `profile.endpoint`/`useTls` and attempts an un-pinned connection,
 *   carrying `secrets.password` if saved — byte-for-byte the same
 *   `DaemonClientLifecycle` shape `daemon-connect-attempt.ts` builds.
 * - `"relay"`: rebuilds `hosts.RelayHostConnectionProfile` from
 *   `profile.endpoint`/`useTls`/`id` (the relay's own `serverId` — see
 *   `connection-shell-model.ts`'s `buildRelayHostProfile`) and
 *   `secrets.relayKey` (the saved `daemonPublicKeyB64`), then attempts
 *   an E2EE-pinned connection carrying `secrets.password` if saved —
 *   the same shape `apply-connection-offer.ts` builds from a freshly
 *   parsed offer. Refuses immediately, with no connection attempt, when
 *   `secrets.relayKey` is missing (see `RELAY_PIN_MISSING_MESSAGE`).
 */
export function createReconnectHostProfile(
  options: ReconnectHostProfileOptions,
): ReconnectHostProfile {
  return async function reconnectHostProfile(profile, secrets): Promise<ReconnectResult> {
    if (profile.kind === "relay") {
      if (!secrets.relayKey) {
        return {
          ok: false,
          kind: "wrong-daemon-key",
          error: RELAY_PIN_MISSING_MESSAGE,
          pinMismatch: true,
        };
      }
      const relay: hosts.RelayHostConnectionProfile = {
        endpoint: profile.endpoint,
        useTls: profile.useTls,
        serverId: profile.id,
        daemonPublicKeyB64: secrets.relayKey,
      };
      const config = buildLifecycleConfig(
        hosts.buildRelayConnectionUrl(relay),
        options,
        secrets.password,
        {
          enabled: true,
          daemonPublicKeyB64: relay.daemonPublicKeyB64,
        },
      );
      return runAttempt(config, describeRelayConnectionError, "relay");
    }

    const direct: hosts.DirectHostConnectionProfile = {
      endpoint: profile.endpoint,
      useTls: profile.useTls,
    };
    const config = buildLifecycleConfig(
      hosts.buildDirectConnectionUrl(direct),
      options,
      secrets.password,
      undefined,
    );
    return runAttempt(config, describeDirectConnectionError, "direct");
  };
}
