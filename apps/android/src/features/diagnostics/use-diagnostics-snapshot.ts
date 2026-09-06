/**
 * Live diagnostics data source (T42A3) — Android's counterpart to
 * `apps/web/src/features/diagnostics/use-diagnostics-snapshot.ts`.
 *
 * Kept RN-free (imports only `react`, never `react-native`) so its
 * refresh logic is inspectable without a device — like every other
 * `use-*.ts` hook in this tree that wraps a plain store
 * (`features/connect/use-connection-status.ts` is the direct precedent:
 * no colocated test file either, because there is nothing here beyond
 * "subscribe, set state" for a render pass to get wrong that
 * `diagnostics-model.test.ts`'s pure-function tests do not already
 * cover; RN screens in this tree are proven by source-text contract
 * tests instead — see `DiagnosticsScreen.test.ts`).
 *
 * Takes STRUCTURAL sources rather than importing `features/connect`'s
 * concrete `DaemonConnectionStore`/`credential-store.ts` types — this
 * feature directory stays decoupled from its siblings, the same
 * "no feature imports another feature directly; composition happens one
 * level up" convention `app-shell/core.ts` already establishes for every
 * other cross-feature wire-up in this app. A real `DaemonConnectionStore`
 * and the real `DaemonClient` `connection.getActiveLifecycle()
 * ?.getDaemonClient()` returns both satisfy the interfaces below as-is
 * (width subtyping) — see `DiagnosticsDaemonClient`'s own doc comment for
 * the one member (`on`) that needs the same narrow-cast
 * `app-shell/core.ts`'s `AgentStreamCapableClient` already performs for
 * an identical reason.
 *
 * **Wired to the live `DaemonConnectionStore` in production** by
 * `app/h/[serverId]/diagnostics.tsx`, which passes `core.connection`
 * straight in as the `connectionSource` and re-reads
 * `getActiveLifecycle()?.getDaemonClient()` on every call. That route
 * performs exactly the `on` narrow-cast this docstring predicted.
 *
 * CORRECTED (P7-W7 merge gate): this said **"Not wired to a live store
 * anywhere in production yet — no route under `apps/android/src/app/`
 * mounts `DiagnosticsScreen` at all"**. True as written by T42A3, whose
 * `Owns` grant excluded `app/`; false from the moment the gate mounted
 * the route.
 */
import { useEffect, useMemo, useState } from "react";

import type { ServerInfoStatusPayload } from "@picompanion/protocol/messages";

import {
  buildDiagnosticsSnapshot,
  type DiagnosticsConnectionSnapshot,
  type DiagnosticsHostProfile,
  type DiagnosticsSection,
} from "./diagnostics-model.js";

/** Structural subset of `DaemonConnectionStore` (`features/connect/daemon-connection-store.ts`) this hook needs. */
export interface DiagnosticsConnectionSource {
  getSnapshot(): DiagnosticsConnectionSnapshot;
  subscribe(listener: (snapshot: DiagnosticsConnectionSnapshot) => void): () => void;
}

export interface DiagnosticsStatusMessage {
  type: "status";
  payload: { status: string } & Record<string, unknown>;
}

/**
 * Narrow shape this hook needs from a live daemon client. `connection.
 * DaemonClientLike` (`@picompanion/frontend-core`) declares
 * `getLastServerInfoMessage()` but not `on()` — the same gap
 * `app-shell/core.ts`'s own `AgentStreamCapableClient` documents and
 * casts around for the identical reason: the real, production
 * `@picompanion/client` `DaemonClient` instance
 * `connection.getActiveLifecycle()?.getDaemonClient()` returns always
 * has `on()`, so a caller wiring this hook for real casts through
 * `unknown` the same way, never a fabricated stub.
 */
export interface DiagnosticsDaemonClient {
  getLastServerInfoMessage(): ServerInfoStatusPayload | null;
  on(type: "status", handler: (message: DiagnosticsStatusMessage) => void): () => void;
}

export interface UseDiagnosticsSnapshotOptions {
  appVersion: string;
  clientId: string;
  connectionSource: DiagnosticsConnectionSource;
  /** The `HostProfileRecord` in use; `null` before any profile is selected/loaded. Not itself subscribed here — same "read once, handed down" shape `useColdStartProfile()` already uses for the one Android-wide profile read that exists today. */
  profile: DiagnosticsHostProfile | null;
  /** Re-read on every `connectionSource` publish (a reconnect swaps in a new client instance) and on every live `"status"` event whose `payload.status === "server_info"` from whatever client is current at that moment — mirrors web's hook's refresh signal exactly (`DaemonClient` re-emits `server_info` after every reconnect). `null` when no client is live. */
  getDaemonClient: () => DiagnosticsDaemonClient | null;
}

/** With no live client at all (`getDaemonClient()` returning `null`, disconnected or never connected), `serverInfo` stays `null` and `buildDiagnosticsSnapshot` renders every daemon-sourced field as truthfully unavailable — the "the screen works while disconnected" acceptance criterion. */
export function useDiagnosticsSnapshot(
  options: UseDiagnosticsSnapshotOptions,
): DiagnosticsSection[] {
  const { appVersion, clientId, connectionSource, profile, getDaemonClient } = options;
  const [connection, setConnection] = useState<DiagnosticsConnectionSnapshot>(() =>
    connectionSource.getSnapshot(),
  );
  const [serverInfo, setServerInfo] = useState<ServerInfoStatusPayload | null>(
    () => getDaemonClient()?.getLastServerInfoMessage() ?? null,
  );

  useEffect(() => connectionSource.subscribe(setConnection), [connectionSource]);

  useEffect(() => {
    const client = getDaemonClient();
    setServerInfo(client?.getLastServerInfoMessage() ?? null);
    if (!client) return undefined;
    return client.on("status", (message) => {
      if (message.payload.status !== "server_info") return;
      setServerInfo(client.getLastServerInfoMessage());
    });
    // Re-runs whenever `connection` changes — a reconnect (or the first
    // successful connect) is exactly when `getDaemonClient()` starts
    // returning a different instance, so re-subscribing on every
    // `connection` publish is what keeps this from watching a torn-down
    // client. `getDaemonClient` itself is a stable closure by convention
    // (every real caller wraps a `useMemo`/module-level accessor, never a
    // fresh function per render), so it is listed but not expected to
    // change on its own.
  }, [connection, getDaemonClient]);

  return useMemo(
    () => buildDiagnosticsSnapshot({ appVersion, clientId, connection, profile, serverInfo }),
    [appVersion, clientId, connection, profile, serverInfo],
  );
}
