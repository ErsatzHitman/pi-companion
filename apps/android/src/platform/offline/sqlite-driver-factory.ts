/**
 * Opens (or honestly fails to open) a `SqliteDriver` (`./sqlite-
 * driver.ts`) — T68, plan.md §7.1/§7.3/§12.5.
 *
 * `OfflineCacheOwner` (`./offline-cache-owner.ts`) never imports
 * `expo-sqlite` directly and never constructs a `SqliteDriver` itself;
 * it takes one of these factories injected, for the same reason
 * `./sqlite-driver.ts` defines a port instead of importing the package
 * (see that file's doc comment): the package is not installed, and this
 * task's grant does not permit `npm install`.
 *
 * `createUnavailableSqliteDriverFactory` below is this build's only
 * production factory today. Its `open()` always rejects — **no real
 * SQLite file is ever opened by this task** — so any `OfflineCacheOwner`
 * built with it lands in `OfflineCacheOwnerStatus`'s `"degraded"` state
 * rather than ever silently pretending to have a working cache.
 *
 * When a maintainer runs the exact command `./sqlite-driver.ts` names —
 * `npm install expo-sqlite@~16.0.10 --workspace=@picompanion/android` —
 * a real factory (e.g. `./expo-sqlite-driver-factory.ts`,
 * `export function createExpoSqliteDriverFactory(name: string):
 * SqliteDriverFactory` wrapping `expo-sqlite`'s `openDatabaseAsync` in
 * `open()`, and the resulting database's `closeAsync` as this port's
 * `closeAsync`) can implement `SqliteDriverFactory` without changing
 * `./offline-cache-owner.ts` at all — the production call site in
 * `app-shell/core.ts` (see `./offline-cache-owner.ts`'s doc comment for
 * the exact seam) would swap only which factory it passes.
 */
import type { SqliteDriver } from "./sqlite-driver.js";

/**
 * A scope's one-shot "open my backing driver" step, separated from
 * `SqliteDriver` itself so failing to *open* a database (file locked,
 * disk full, native module missing) is a distinct, named event from a
 * failure of an already-open driver's individual `execAsync`/`runAsync`
 * calls.
 */
export interface SqliteDriverFactory {
  /**
   * Resolves a ready `SqliteDriver`, or rejects with a real `Error`
   * describing why none is available. Called at most once per
   * `OfflineCacheOwner` (see that class's `open()` doc comment) — a
   * factory does not need to guard against being invoked twice itself.
   */
  open(): Promise<SqliteDriver>;
}

/**
 * This build's only production `SqliteDriverFactory`. `open()` always
 * rejects with this exact, named reason — never a generic error, never a
 * silently-resolved fake driver — so `OfflineCacheOwner.getStatus()`
 * reads `{ kind: "degraded", reason }` with a reason a support/diagnostic
 * surface could show verbatim. The rejection message names the install
 * command a maintainer needs, matching every other "not installed in
 * this build" adapter in this app (e.g.
 * `../notifications-platform.ts`'s `createUnavailableAndroidNotifications
 * Port`).
 */
export function createUnavailableSqliteDriverFactory(): SqliteDriverFactory {
  return {
    open(): Promise<SqliteDriver> {
      return Promise.reject(
        new Error(
          "expo-sqlite is not installed in this build (run `npm install expo-sqlite@~16.0.10 " +
            "--workspace=@picompanion/android` — see ./sqlite-driver.ts's doc comment). " +
            "OfflineCacheOwner is running in its degraded state; no real SQLite file was opened.",
        ),
      );
    },
  };
}
