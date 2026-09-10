/**
 * T337 — reconnect the saved host profile on a cold start.
 *
 * `app/index.tsx` has redirected a cold start straight to the stored
 * profile's session list since T32S3, and `sessions-screen.tsx` has
 * restored the last-opened session since T32B3 — but nothing ever
 * reconnected the profile those two screens assume is live. Maestro run
 * 34470287372's `cold-start-restore` measured exactly that: after
 * `stopApp` + `launchApp`, the sessions screen rendered with the
 * connection store still `idle`, `refreshSessions()` rejected with "Not
 * connected to a daemon", the restore effect surfaced the same text in
 * the open-error banner, and the row the flow had just created never
 * came back. `host-profile-reconnect.ts`'s own header named this seam at
 * T66 ("no code anywhere calls `AppCore.connection.connect()`/
 * `adoptLifecycle()` automatically for *any* saved profile"), and
 * T32S14 closed only the user-driven half of it (`connection-shell.tsx`'s
 * "existing profile" submit). This module is the automatic half.
 *
 * It is deliberately the same three calls `connection-shell.tsx`'s
 * `handleReconnect` makes — `loadHostProfileSecrets`, `AppCore.
 * reconnectHostProfile` (T66's module, so a relay profile is pinned and a
 * pin mismatch is refused, never retried unpinned), then
 * `connection.adoptLifecycle(lifecycle, path, profile)` (so a direct
 * profile publishes `path: "direct"` and a real `daemonAddress`) — with
 * two guards that only an automatic caller needs:
 *
 * - it runs only while the store is still `idle`. A user who reaches the
 *   connect form and submits before the read above settles has already
 *   started an attempt of their own, and `adoptLifecycle` would tear that
 *   generation down.
 * - it re-checks that after its own attempt resolves, and disposes the
 *   lifecycle it just opened if anything else started meanwhile, rather
 *   than clobbering the newer generation.
 *
 * A failed attempt is returned, not thrown, and adopts nothing: the
 * sessions screen keeps rendering against an idle store, exactly as it did
 * before this module existed, and the next user action ("Create session")
 * surfaces the daemon-session-service's own "Not connected to a daemon".
 * The caller (`app/core-context.tsx`'s `AppCoreProvider`) fires this once
 * per process, after its cold-start profile read settles, and does not
 * block the router on it: a dead host must not turn the cold start into a
 * blank screen for a whole connect timeout.
 */
import type { AppCore } from "./core";
import {
  loadHostProfileSecrets,
  type HostProfileRecord,
} from "../features/connect/credential-store";

export type ColdStartReconnectDeps = Pick<
  AppCore,
  "connection" | "reconnectHostProfile" | "keyValueStorage" | "secureStorage"
>;

export type ColdStartReconnectOutcome =
  | { kind: "reconnected"; path: "direct" | "relay" }
  /** Another attempt had already started (`"already-started"`: before this one began; `"superseded"`: while it was in flight — the lifecycle it opened was disposed). */
  | { kind: "skipped"; reason: "already-started" | "superseded" }
  | { kind: "failed"; error: string; pinMismatch: boolean };

export async function reconnectColdStartProfile(
  deps: ColdStartReconnectDeps,
  profile: HostProfileRecord,
): Promise<ColdStartReconnectOutcome> {
  if (deps.connection.getSnapshot().phase !== "idle") {
    return { kind: "skipped", reason: "already-started" };
  }
  const secrets = await loadHostProfileSecrets(
    { plainStorage: deps.keyValueStorage, secureStorage: deps.secureStorage },
    profile.id,
  );
  const result = await deps.reconnectHostProfile(profile, secrets);
  if (!result.ok) {
    return { kind: "failed", error: result.error, pinMismatch: result.pinMismatch };
  }
  if (deps.connection.getSnapshot().phase !== "idle") {
    await result.lifecycle.dispose();
    return { kind: "skipped", reason: "superseded" };
  }
  await deps.connection.adoptLifecycle(result.lifecycle, result.path, profile);
  return { kind: "reconnected", path: result.path };
}
