/**
 * Live daemon connection store — plan.md §7.1/§9.2, T32A1B.
 *
 * The one place `ConnectForm`'s submit and `use-connection-status.ts`'s
 * status display share the *live* `connection.DaemonClientLifecycle` a
 * successful `daemon-connect-attempt.ts` attempt produces. Kept
 * RN-free and framework-free (no React import), so it is unit-testable
 * against a fake `DaemonConnectAttempt` — like `connect-form-model.ts`
 * and `daemon-connect-attempt.ts`, no React Native import belongs here.
 *
 * Deliberately not a React Context and not a module-level singleton:
 * `ConnectForm` and the status strip are both rendered from
 * `connection-shell.tsx`, the only place that needs to share one
 * instance — it creates exactly one via `createDaemonConnectionStore`
 * (memoized for the component's lifetime) and passes it to both
 * `ConnectForm.onSubmit` (via `store.connect`) and
 * `useConnectionStatus(store)`. A plain object with `getSnapshot`/
 * `subscribe` (not a singleton) means a test can construct a fresh one
 * per case instead of resetting shared module state between tests.
 *
 * `phase` reuses `connection.DaemonClientLifecycleStatus` verbatim
 * (`"idle" | "connecting" | "connected" | "disconnected" | "disposed"`)
 * rather than inventing a parallel enum — before any attempt this store
 * is idle for the same reason a fresh `DaemonClientLifecycle` is idle,
 * and once an attempt adopts a lifecycle this store's `phase` is just
 * that lifecycle's own status, forwarded.
 *
 * `path` (T32A5, "Connection path is visible to the user") records
 * *how* the active (or most recently active) lifecycle was reached —
 * `"direct"` for one `connect()` opened itself, and for one
 * `adoptLifecycle()` was handed, whatever path that caller declares —
 * `"relay"` by default (the QR/pasted-offer pairing path), or the real
 * `"direct" | "relay"` T66's reconnect reports for a saved profile (see
 * `connection-shell.tsx`'s `handleReconnect`). This store never inspects the
 * lifecycle itself to infer this (it has no such introspection —
 * `daemon-connect-attempt.ts`'s module docstring notes
 * `DaemonClientLifecycle` exposes no URL/config getter); it is simply
 * which of this store's own two entry points the caller used, recorded
 * alongside the phase/error a caller already reads from one
 * `DaemonConnectionSnapshot`.
 *
 * `daemonAddress` (T32A7, "Carry the daemon host and port on
 * DaemonConnectionSnapshot") records the *direct* daemon's host, port,
 * `useTls`, and `isIpv6` — copied field-for-field from the
 * `ParsedConnectAddress` a caller already passed to `connect()`, never
 * re-derived by parsing a WebSocket URL. T32P2 (P5-W15) deliberately
 * refused to string-munge an HTTP origin out of a WS URL for exactly
 * this reason: a WSS URL can carry a path, a non-default port, or a
 * bracketed IPv6 literal, and regex-reconstructing an origin from it
 * silently produces a wrong one in each case. Carrying the same fields
 * `hosts.buildDirectConnectionUrl` was built from — rather than
 * inverting its output — means there is nothing to get wrong.
 * `buildDaemonHttpOrigin` below turns this into the `http(s)://host:port`
 * string `apps/android/src/features/files/file-browser-client.ts`'s
 * `buildFileDownloadUrl(origin, token)` expects, bracketing the host
 * itself exactly when `isIpv6` says to — never by sniffing the host
 * string for a colon.
 *
 * Populated on the `path: "direct"` side of a successful `connect()`
 * (copied from the caller's `ParsedConnectAddress`) **and**, since T73,
 * on a `path: "direct"` `adoptLifecycle()` call given a `sourceProfile`
 * — reconstructed from that saved profile's own `endpoint` by
 * `parseHostProfileEndpoint` below, the same "copy the fields, never
 * re-derive from a URL" posture. `null` in every other state — before
 * any attempt (`IDLE_SNAPSHOT`), while an attempt is in flight
 * (`"connecting"`), after a failed attempt (mirrors `path: null`
 * there), after a `path: "relay"` `adoptLifecycle()` (T32A4/T32A5's
 * relay/QR path: the relay's `endpoint` in
 * `hosts.RelayHostConnectionProfile` is the *relay's* host:port, not a
 * directly-reachable daemon HTTP origin — a relay tunnel proxies the
 * encrypted WebSocket only, so there is no HTTP origin to hand
 * `buildFileDownloadUrl` on this path; downloading a file over a
 * relay-paired connection is an unimplemented gap this store does not
 * paper over), after a `path: "direct"` `adoptLifecycle()` given no
 * `sourceProfile` or one whose `endpoint` fails to parse, and after
 * `dispose()`. It is set exactly once per generation, at the same
 * moment `path` becomes `"direct"`, and — like `path` — is *not*
 * cleared by a later status change on the same generation (a
 * `"disconnected"` from the lifecycle's own `subscribeStatus` stream
 * keeps the last-known `daemonAddress`, the same way it keeps
 * `path: "direct"`, because it is still the address of the connection
 * that dropped, not a stale one from a superseded generation — a
 * superseded generation is torn down first, which is what actually
 * clears it).
 *
 * Third acceptance criterion ("the host and port never reach a log"):
 * this module contains no `console.*` call and never places
 * `daemonAddress`'s fields into an error message or any other string —
 * `error` above stays the fixed, pre-classified copy from
 * `daemon-connection-error.ts`, never a string built from the address
 * being dialed.
 */
import type { connection } from "@picompanion/frontend-core";

import type { ParsedConnectAddress } from "./connect-form-model.js";
import type { ConnectAttemptResult, DaemonConnectAttempt } from "./daemon-connect-attempt.js";

export type DaemonConnectionPhase = connection.DaemonClientLifecycleStatus;

/** How the active (or most recently active) lifecycle was reached — see the module docstring's "`path`" paragraph. `null` before any attempt has ever succeeded. */
export type DaemonConnectionPath = "direct" | "relay" | null;

/** A direct daemon's host/port, copied verbatim from `ParsedConnectAddress` — see the module docstring's "`daemonAddress`" paragraph. Never reconstructed from a WebSocket URL. */
export interface DaemonConnectionAddress {
  host: string;
  port: number;
  useTls: boolean;
  /** Whether `host` is a bare IPv6 literal (no brackets) — matches `ParsedConnectAddress.isIpv6`. `buildDaemonHttpOrigin` uses this to decide whether to bracket `host`, rather than sniffing it for a colon. */
  isIpv6: boolean;
}

export interface DaemonConnectionSnapshot {
  phase: DaemonConnectionPhase;
  /** The most recent failed attempt's human-readable reason (`daemon-connection-error.ts`'s copy); cleared the moment a new attempt starts or one succeeds. */
  error: string | null;
  /** `"direct"`/`"relay"` once a `connect()`/`adoptLifecycle()` call has succeeded; `null` before that, and reset to `null` on `dispose()`. Not cleared by a later *failed* attempt — see `connect()`'s doc comment. */
  path: DaemonConnectionPath;
  /** The connected daemon's host/port — see the module docstring's "`daemonAddress`" paragraph. Non-`null` only when `path === "direct"`. */
  daemonAddress: DaemonConnectionAddress | null;
}

const IDLE_SNAPSHOT: DaemonConnectionSnapshot = {
  phase: "idle",
  error: null,
  path: null,
  daemonAddress: null,
};

/**
 * Turns a `DaemonConnectionAddress` into the `http(s)://host:port` origin
 * `buildFileDownloadUrl(origin, token)`
 * (`apps/android/src/features/files/file-browser-client.ts`) expects —
 * bracketing an IPv6 host from `isIpv6`, never by inspecting `host` for
 * a colon. Pure and framework-free; takes no snapshot, so a caller
 * checks `daemonAddress !== null` first.
 */
export function buildDaemonHttpOrigin(address: DaemonConnectionAddress): string {
  const scheme = address.useTls ? "https" : "http";
  const host = address.isIpv6 ? `[${address.host}]` : address.host;
  return `${scheme}://${host}:${address.port}`;
}

/**
 * The subset of a saved `HostProfileRecord`
 * (`credential-store.ts`) `adoptLifecycle` needs to reconstruct
 * `daemonAddress` on a `path: "direct"` reconnect (T73) — deliberately
 * not `HostProfileRecord` itself, so this store never imports
 * `credential-store.ts` and stays usable from any caller that happens
 * to have these three fields (structural typing: a real
 * `HostProfileRecord` satisfies this without a cast, since it carries
 * `id`/`label`/`kind` in addition).
 */
export interface DaemonConnectionSourceProfile {
  /** `host:port`, or `[host]:port` for an IPv6 host — matches `HostProfileRecord.endpoint`'s own shape, itself matching `ParsedConnectAddress.endpoint`'s construction in `connect-form-model.ts`. */
  endpoint: string;
  useTls: boolean;
  isIpv6: boolean;
}

const IPV6_ENDPOINT_PATTERN = /^\[([^\]]+)\]:(\d+)$/;
const HOST_ENDPOINT_PATTERN = /^([^:\s]+):(\d+)$/;

/**
 * Reconstructs a `DaemonConnectionAddress` from a
 * `DaemonConnectionSourceProfile`'s `endpoint` (T73) — the exact
 * inverse of `connect-form-model.ts`'s `ParsedConnectAddress.endpoint`
 * construction (`` `${host}:${port}` `` or `` `[${host}]:${port}` ``
 * for IPv6), never a fresh WS-URL re-derivation (see this module's
 * docstring for why that is deliberately refused).
 *
 * Returns `null` — never a partially-populated or garbage address, and
 * never a throw — for anything that does not match that exact shape: a
 * non-IPv6 endpoint that is missing a port or carries brackets, an IPv6
 * endpoint with no brackets or a malformed one, an empty host, a
 * non-numeric port, or a port outside 1-65535. A caller (`adoptLifecycle`
 * below) treats `null` here exactly like the relay path already treats
 * "no direct HTTP origin exists at all" — the pre-existing, already-
 * handled state every reader of `daemonAddress` (`buildDaemonHttpOrigin`'s
 * callers) treats as "nothing to offer", never as a crash or a
 * silently-wrong host/port reaching a download URL or a probe.
 */
export function parseHostProfileEndpoint(
  profile: DaemonConnectionSourceProfile,
): DaemonConnectionAddress | null {
  const pattern = profile.isIpv6 ? IPV6_ENDPOINT_PATTERN : HOST_ENDPOINT_PATTERN;
  const match = pattern.exec(profile.endpoint);
  if (!match) return null;

  const host = match[1]!.trim();
  if (!host) return null;

  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  return { host, port, useTls: profile.useTls, isIpv6: profile.isIpv6 };
}

export type DaemonConnectionSnapshotListener = (snapshot: DaemonConnectionSnapshot) => void;

export interface DaemonConnectionStore {
  getSnapshot(): DaemonConnectionSnapshot;
  subscribe(listener: DaemonConnectionSnapshotListener): () => void;
  /** The live lifecycle from the most recent successful attempt, or `null` before one has ever succeeded (or after `dispose()`). */
  getActiveLifecycle(): connection.DaemonClientLifecycle | null;
  /**
   * Runs one connect attempt. Tears down and disposes any prior
   * generation first (a second submit always replaces the first, it
   * never runs two connections at once), publishes `"connecting"`
   * immediately, then — on success — adopts the new lifecycle, publishes
   * `path: "direct"` (T32A5), and starts forwarding its own status
   * changes; on failure, publishes the classified error and returns to
   * `"idle"` with `path: null`.
   */
  connect(address: ParsedConnectAddress, password?: string): Promise<ConnectAttemptResult>;
  /**
   * Adopts an already-connected lifecycle obtained through some other
   * successful attempt (T32A4: `apply-connection-offer.ts`'s QR/relay
   * pairing path) — the same teardown-the-prior-generation-then-adopt
   * bookkeeping `connect()` runs after a successful `DaemonConnectAttempt`,
   * but for a lifecycle that is already connected rather than one this
   * store opens itself. Publishes the adopted lifecycle's current
   * status immediately (`subscribeStatus` calls its listener with the
   * current status on subscribe) with the caller's `path` (T32A5) and
   * forwards every status change after that the same way. A caller that
   * already has a live `connection.DaemonClientLifecycle` — a scanned
   * offer that just paired — uses this instead of `connect()`, which
   * would otherwise run a second, redundant `DaemonConnectAttempt`.
   *
   * `path` says which kind of connection the adopted lifecycle actually
   * is, and defaults to `"relay"` so every pre-existing caller (the
   * QR/pasted-offer pairing path, which is always relay) is unchanged.
   * Added at the P5-W20 merge gate: T66's `ReconnectSuccess` already
   * carries a real `"direct" | "relay"` for exactly this purpose ("a
   * caller wiring this into `DaemonConnectionStore` publishes it as
   * `path`", its own doc comment), and T32S14's `deriveReconnectOutcome`
   * already threads it to the UI — but `connection-shell.tsx` had no
   * parameter to hand it to, so a reconnected **direct** profile was
   * published as `path: "relay"` and every screen reading the snapshot
   * said "Connected via relay" about a direct connection.
   *
   * `sourceProfile` (T73, found at the P5-W20 merge gate immediately
   * after the fix above landed): the saved `HostProfileRecord`'s own
   * `endpoint`/`useTls`/`isIpv6` (or any equivalently-shaped value — this
   * store takes only those three fields, never the whole storage-shaped
   * type, to stay decoupled from `credential-store.ts`), used to
   * reconstruct `daemonAddress` on this call's `path: "direct"` branch
   * only — see `parseHostProfileEndpoint` below. Ignored on the
   * `"relay"` branch (a relay tunnel still has no directly-reachable
   * daemon HTTP origin — see the module docstring's `daemonAddress`
   * paragraph) and when omitted, so every existing QR/pasted-offer
   * caller that passes nothing is unchanged.
   */
  adoptLifecycle(
    newLifecycle: connection.DaemonClientLifecycle,
    path?: DaemonConnectionPath,
    sourceProfile?: DaemonConnectionSourceProfile,
  ): Promise<void>;
  /** Disposes the active lifecycle (if any) and resets to idle. Call on unmount. */
  dispose(): Promise<void>;
}

export function createDaemonConnectionStore(attempt: DaemonConnectAttempt): DaemonConnectionStore {
  let lifecycle: connection.DaemonClientLifecycle | null = null;
  let lifecycleUnsubscribe: (() => void) | null = null;
  let snapshot: DaemonConnectionSnapshot = IDLE_SNAPSHOT;
  const listeners = new Set<DaemonConnectionSnapshotListener>();

  function publish(next: DaemonConnectionSnapshot): void {
    snapshot = next;
    for (const listener of listeners) {
      listener(next);
    }
  }

  async function teardownActiveLifecycle(): Promise<void> {
    lifecycleUnsubscribe?.();
    lifecycleUnsubscribe = null;
    const previous = lifecycle;
    lifecycle = null;
    if (previous) {
      await previous.dispose();
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getActiveLifecycle: () => lifecycle,
    async connect(address, password) {
      await teardownActiveLifecycle();
      publish({ phase: "connecting", error: null, path: null, daemonAddress: null });

      const result = await attempt(address, password);
      if (!result.ok) {
        publish({ phase: "idle", error: result.error, path: null, daemonAddress: null });
        return result;
      }

      // Copied field-for-field from the address the caller passed in —
      // never re-derived from the lifecycle or its WebSocket URL. See
      // the module docstring's "`daemonAddress`" paragraph.
      const daemonAddress: DaemonConnectionAddress = {
        host: address.host,
        port: address.port,
        useTls: address.useTls,
        isIpv6: address.isIpv6,
      };

      lifecycle = result.lifecycle;
      lifecycleUnsubscribe = result.lifecycle.subscribeStatus((status) => {
        publish({ phase: status, error: null, path: "direct", daemonAddress });
      });
      return result;
    },
    async adoptLifecycle(newLifecycle, path = "relay", sourceProfile) {
      await teardownActiveLifecycle();
      // T73 (closed the gap the P5-W20 merge gate filed here): `daemonAddress`
      // stays `null` on the relay path — a relay tunnel has no direct
      // daemon HTTP origin at all (the module docstring's "`daemonAddress`"
      // paragraph) — but is reconstructed from the caller's own
      // `sourceProfile.endpoint` on a `path: "direct"` reconnect, exactly
      // parallel to `connect()`'s own "copied field-for-field, never
      // re-derived from a WS URL" posture above. A malformed/unparseable
      // stored endpoint (or no `sourceProfile` at all) lands in the same
      // already-handled `null` state every reader of `daemonAddress`
      // treats as "nothing to offer" — never a throw, never a
      // partially-populated address reaching a download URL or a probe.
      const daemonAddress: DaemonConnectionAddress | null =
        path === "direct" && sourceProfile ? parseHostProfileEndpoint(sourceProfile) : null;
      lifecycle = newLifecycle;
      lifecycleUnsubscribe = newLifecycle.subscribeStatus((status) => {
        publish({ phase: status, error: null, path, daemonAddress });
      });
    },
    async dispose() {
      await teardownActiveLifecycle();
      publish(IDLE_SNAPSHOT);
    },
  };
}
