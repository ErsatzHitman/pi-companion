/**
 * Live daemon connection attempt — plan.md §7.1/§12.1, T32A1B ("Wire the
 * Android connect form to a live DaemonClientLifecycle").
 *
 * Turns a validated `ParsedConnectAddress` (`connect-form-model.ts`)
 * into a real connection attempt through
 * `@picompanion/frontend-core`'s `connection.DaemonClientLifecycle` —
 * the same class T19A already ships and fixture-tests
 * (`daemon-client-lifecycle.fixture.test.ts`). This module never talks
 * to `@picompanion/client` directly, and never imports React, React
 * Native, Expo, DOM types, or browser globals — it stays unit-testable
 * against a scripted fake WebSocket (see
 * `daemon-connect-attempt.fixture.test.ts`), exactly like `apps/web`'s
 * `authenticate-host.ts`.
 *
 * On success it hands back the *live* `DaemonClientLifecycle` — Android
 * has no `HostController`/probe-then-persist two-step yet (that is
 * `apps/web`'s T27A1/T27A2 split; nothing analogous has landed here),
 * so the lifecycle this module opens *is* the app's connection, not a
 * disposable reachability probe. The caller (`use-connection-status.ts`
 * / `connection-shell.tsx`) owns disposing a previous generation before
 * replacing it and disposing the current one on unmount.
 *
 * On failure it disposes the short-lived lifecycle itself (nothing is
 * left connecting in the background after a failed attempt) and
 * classifies the raw rejection through `daemon-connection-error.ts`, so
 * a refused/timed-out daemon, an incorrect password, and a stale
 * relay-pinned key never collapse into one generic "couldn't connect"
 * string.
 */
import { connection, hosts } from "@picompanion/frontend-core";

import type { ParsedConnectAddress } from "./connect-form-model.js";
import {
  classifyConnectionError,
  describeDirectConnectionError,
  type ConnectionErrorKind,
} from "./daemon-connection-error.js";

export interface DaemonConnectAttemptOptions {
  clientId: string;
  clientType?: "mobile" | "browser" | "cli" | "mcp";
  appVersion?: string;
  connectTimeoutMs?: number;
  /** Injectable, RN-free socket layer — test/DI seam, mirrors `DaemonClientLifecycleConfig["webSocketFactory"]`. Defaults to `@picompanion/client`'s own `globalThis.WebSocket`-backed factory (React Native's global `WebSocket`, on-device). */
  webSocketFactory?: connection.DaemonClientLifecycleConfig["webSocketFactory"];
  /** Test/DI seam that bypasses the socket layer entirely; overrides `webSocketFactory` when supplied. */
  createDaemonClient?: connection.DaemonClientFactory;
}

export interface ConnectAttemptSuccess {
  ok: true;
  /** The live, still-connected lifecycle for this connection generation. Caller owns its disposal. */
  lifecycle: connection.DaemonClientLifecycle;
}

export interface ConnectAttemptFailure {
  ok: false;
  kind: ConnectionErrorKind;
  /** Fixed, human-readable copy for the connect form's error banner — see `daemon-connection-error.ts`. */
  error: string;
}

export type ConnectAttemptResult = ConnectAttemptSuccess | ConnectAttemptFailure;

export type DaemonConnectAttempt = (
  address: ParsedConnectAddress,
  password?: string,
) => Promise<ConnectAttemptResult>;

/**
 * Builds a `DaemonConnectAttempt` bound to one set of client identity
 * options, reused across submissions. Each call opens a *fresh*
 * `DaemonClientLifecycle` generation (T32A1B does not reconnect a prior
 * generation on retry — a distinct address or password is a distinct
 * attempt).
 */
export function createDaemonConnectAttempt(
  options: DaemonConnectAttemptOptions,
): DaemonConnectAttempt {
  return async function attemptDaemonConnection(
    address: ParsedConnectAddress,
    password?: string,
  ): Promise<ConnectAttemptResult> {
    const lifecycle = new connection.DaemonClientLifecycle({
      url: hosts.buildDirectConnectionUrl({ endpoint: address.endpoint, useTls: address.useTls }),
      clientId: options.clientId,
      clientType: options.clientType ?? "mobile",
      ...(options.appVersion !== undefined ? { appVersion: options.appVersion } : {}),
      ...(options.connectTimeoutMs !== undefined
        ? { connectTimeoutMs: options.connectTimeoutMs }
        : {}),
      ...(password !== undefined ? { password } : {}),
      ...(options.webSocketFactory !== undefined
        ? { webSocketFactory: options.webSocketFactory }
        : {}),
      ...(options.createDaemonClient !== undefined
        ? { createDaemonClient: options.createDaemonClient }
        : {}),
      // T32A1B does not reconnect-on-drop itself — that is the
      // `connection.ResumeController` seam T32B3 wires up once Android
      // has a live connection to feed it (see `app/core.ts`'s
      // `attachResumeSignals` docstring). A failed *initial* attempt
      // must reject cleanly, not retry silently in the background.
      reconnect: { enabled: false },
    });

    try {
      await lifecycle.connect();
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      await lifecycle.dispose();
      return {
        ok: false,
        kind: classifyConnectionError(rawMessage),
        error: describeDirectConnectionError(rawMessage),
      };
    }

    return { ok: true, lifecycle };
  };
}
