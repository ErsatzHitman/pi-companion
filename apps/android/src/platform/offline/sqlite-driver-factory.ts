/**
 * Opens (or honestly fails to open) a `SqliteDriver` (`./sqlite-
 * driver.ts`) — T68, plan.md §7.1/§7.3/§12.5.
 *
 * `OfflineCacheOwner` (`./offline-cache-owner.ts`) never imports
 * `expo-sqlite` directly and never constructs a `SqliteDriver` itself;
 * it takes one of these factories injected, for the same reason
 * `./sqlite-driver.ts` defines a port instead of importing the package
 * (see that file's doc comment).
 *
 * `createUnavailableSqliteDriverFactory` below is the honest
 * factory for a build with no native `ExpoSQLite` module linked (and
 * the factory tests/fakes use). Its `open()` always rejects — **no
 * real SQLite file is ever opened by it** — so an `OfflineCacheOwner`
 * built with it lands in `OfflineCacheOwnerStatus`'s `"degraded"` state
 * rather than ever silently pretending to have a working cache.
 *
 * Production has a real factory since T390:
 * `./expo-sqlite-driver-factory.ts`'s `createExpoSqliteDriverFactory`
 * wraps `expo-sqlite`'s `openDatabaseAsync` in `open()` and the
 * resulting database's `closeAsync` as this port's `closeAsync`, and
 * `app-shell/core.ts` passes it at both mount sites. Nothing in
 * `./offline-cache-owner.ts` changed for that swap — only which factory
 * the call site passes.
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
 * The honest `SqliteDriverFactory` for a build with no native
 * `ExpoSQLite` module linked. `open()` always rejects with this exact,
 * named reason — never a generic error, never a silently-resolved fake
 * driver — so `OfflineCacheOwner.getStatus()` reads
 * `{ kind: "degraded", reason }` with a reason a support/diagnostic
 * surface could show verbatim. The rejection message names the package
 * a maintainer would need, matching every other "not installed in this
 * build" adapter in this app.
 */
export function createUnavailableSqliteDriverFactory(): SqliteDriverFactory {
  return {
    open(): Promise<SqliteDriver> {
      return Promise.reject(
        new Error(
          "expo-sqlite's native ExpoSQLite module is not available in this build. " +
            "OfflineCacheOwner is running in its degraded state; no real SQLite file was opened.",
        ),
      );
    },
  };
}
