/**
 * Bearer-token authentication and credential storage — plan.md
 * §7.1/§7.2/§12.1, T27A2.
 *
 * `attempt-host-connection.ts` (T27A1) only proves a direct target is
 * reachable at the TCP/WebSocket-upgrade level; a daemon guarded by a
 * password still completes that handshake and only rejects afterwards,
 * closing with code 4401 once the client has sent its hello (see
 * `packages/server/src/server/auth.ts`'s `paseo.bearer.<token>`
 * subprotocol handling). Proving a token is actually accepted therefore
 * requires a real connection generation through
 * `@picompanion/frontend-core`'s `connection.DaemonClientLifecycle` —
 * the same client `hosts.HostController.connectToProfile` uses — not
 * just the T27A1 probe.
 *
 * `createConnectAndAuthenticateAttempt` composes that reachability
 * probe with one such authenticated connection attempt, and — only once
 * both succeed — persists the resulting `hosts.HostProfile` (and its
 * token, if any) through `hosts.HostProfileStore`, which is itself
 * backed by this app's `StructuredStorage`/`SecureStorage` platform
 * adapters (`apps/web/src/platform`). Those adapters are IndexedDB- and
 * Web-Crypto-backed, so a saved profile and its token survive a page
 * reload; `forgetHostCredentials` is the inverse, used by the connect
 * feature's "logout" affordance.
 *
 * The token is only ever carried as `DaemonClientLifecycleConfig.password`
 * (an `Authorization` header and a `paseo.bearer.<token>` WebSocket
 * subprotocol, both set by `@picompanion/client`) — it is never appended
 * to the connection URL, matching plan.md §12.1's "private material
 * never enters a URL query".
 */
import { connection, hosts } from "@picompanion/frontend-core";
import type { Clock, SecureStorage, StructuredStorage } from "@picompanion/frontend-core";

import { createHostConnectAttempt } from "./attempt-host-connection.js";
import { DIRECT_UNREACHABLE_MESSAGE, describeDirectConnectionError } from "./connection-error.js";
import type { ConnectDraft } from "./validate-connect-form.js";

export interface ConnectAndAuthenticateOutcome {
  /** True only when the daemon was reachable and (if a token was entered) accepted it. */
  ok: boolean;
  reachable: boolean;
  authenticated: boolean;
  /** The persisted `HostProfile.id` once `ok`, so the connect feature's "logout" can find it again; `null` otherwise. */
  savedProfileId: string | null;
  /** A human-readable reason the attempt did not succeed; `null` when `ok`. */
  error: string | null;
}

export type ConnectAndAuthenticateAttempt = (
  draft: ConnectDraft,
) => Promise<ConnectAndAuthenticateOutcome>;

export interface CreateConnectAndAuthenticateOptions {
  clock: Clock;
  storage: StructuredStorage;
  secrets: SecureStorage;
  clientId: string;
  clientType?: "mobile" | "browser" | "cli" | "mcp";
  appVersion?: string;
  /** Overrides the default browser `WebSocket`-backed reachability probe; test-only. */
  probe?: hosts.HostProbeTransport;
  probeTimeoutMs?: number;
  /** Overrides the real `DaemonClient` construction used to verify authentication; test-only. */
  createDaemonClient?: connection.DaemonClientFactory;
}

const UNREACHABLE_ERROR = DIRECT_UNREACHABLE_MESSAGE;

/**
 * Builds a `ConnectAndAuthenticateAttempt`: probes reachability
 * (`attempt-host-connection.ts`), then — only if reachable — opens one
 * short-lived, disposable `DaemonClientLifecycle` generation carrying
 * `draft.password` to confirm the daemon accepts it. Persists the
 * profile and token (via `hosts.HostProfileStore`) only on full success,
 * so a wrong token is never written to storage.
 */
export function createConnectAndAuthenticateAttempt(
  options: CreateConnectAndAuthenticateOptions,
): ConnectAndAuthenticateAttempt {
  const probeAttempt = createHostConnectAttempt({
    clock: options.clock,
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    ...(options.probeTimeoutMs !== undefined ? { probeTimeoutMs: options.probeTimeoutMs } : {}),
  });
  const profiles = new hosts.HostProfileStore({
    storage: options.storage,
    secrets: options.secrets,
    clock: options.clock,
  });

  return async function connectAndAuthenticate(
    draft: ConnectDraft,
  ): Promise<ConnectAndAuthenticateOutcome> {
    const probeOutcome = await probeAttempt(draft);
    if (!probeOutcome.ok) {
      return {
        ok: false,
        reachable: false,
        authenticated: false,
        savedProfileId: null,
        error: UNREACHABLE_ERROR,
      };
    }

    const lifecycle = new connection.DaemonClientLifecycle({
      url: hosts.buildDirectConnectionUrl(draft.direct),
      clientId: options.clientId,
      ...(options.clientType !== undefined ? { clientType: options.clientType } : {}),
      ...(options.appVersion !== undefined ? { appVersion: options.appVersion } : {}),
      ...(draft.password !== undefined ? { password: draft.password } : {}),
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
          reachable: true,
          authenticated: false,
          savedProfileId: null,
          error: describeDirectConnectionError(rawMessage),
        };
      }
    } finally {
      await lifecycle.dispose();
    }

    const saved = await profiles.save(
      { label: draft.label, direct: draft.direct, preferDirect: draft.preferDirect },
      draft.password !== undefined ? { password: draft.password } : {},
    );

    return {
      ok: true,
      reachable: true,
      authenticated: true,
      savedProfileId: saved.id,
      error: null,
    };
  };
}

export interface ForgetHostCredentialsOptions {
  clock: Clock;
  storage: StructuredStorage;
  secrets: SecureStorage;
}

/** Clears a saved profile and its token (used by the connect feature's "logout"). */
export async function forgetHostCredentials(
  options: ForgetHostCredentialsOptions,
  profileId: string,
): Promise<void> {
  const profiles = new hosts.HostProfileStore({
    storage: options.storage,
    secrets: options.secrets,
    clock: options.clock,
  });
  await profiles.remove(profileId);
}
