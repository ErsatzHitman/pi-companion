/**
 * The real, `expo-sqlite`-backed `SqliteDriverFactory` (T390,
 * plan.md §7.1/§7.3/§12.5).
 *
 * Deliberately a separate file from `./sqlite-driver-factory.ts`, which
 * declares the factory contract and `createUnavailableSqliteDriverFactory`
 * and stays completely `react-native`-free. This file's default bindings
 * reach `expo-sqlite`, whose own native entry (`build/ExpoSQLite.js`)
 * calls `requireNativeModule("ExpoSQLite")` at module-evaluation time —
 * exactly the "RN/native-module-in-vitest limitation" this repository's
 * `CLAUDE.md` catalogues. Two consequences shape this file:
 *
 *  - The bindings are injectable (`ExpoSqliteBindings`, defaulting to
 *    `DEFAULT_BINDINGS`), so `./expo-sqlite-driver-factory.test.ts` can
 *    prove this adapter's own forwarding logic against a plain fake
 *    with no native module present.
 *  - `DEFAULT_BINDINGS.openDatabaseAsync` performs the `expo-sqlite`
 *    import *inside* the call (a dynamic `import()`), never at this
 *    module's top level. Every composition-root test that constructs
 *    `AppCore` (which now passes this factory in production) therefore
 *    keeps evaluating without a native `ExpoSQLite` module linked, and
 *    an unavailable native module surfaces as the same honest
 *    `{ kind: "degraded" }` answer `./offline-cache-owner.ts` already
 *    defines — not as a module-evaluation crash at import time.
 *
 * ## One database name per factory, chosen by the caller
 *
 * `createExpoSqliteDriverFactory(databaseName)` takes the file name
 * explicitly rather than hardcoding one. `expo-sqlite`'s own
 * `openDatabaseAsync` caches an open connection per name and hands the
 * *same* `SQLiteDatabase` instance back to a second caller with the same
 * name; because `OfflineCacheOwner.dispose()` closes whatever driver it
 * opened, two owners sharing one name would mean one owner's disposal
 * closing the other's live connection. `app-shell/core.ts` therefore
 * passes a distinct name per owner — see that file's
 * `APP_CORE_OFFLINE_DATABASE`/`APP_CORE_TURN_OUTBOX_DATABASE`.
 *
 * The schema itself is not created here: `SqliteStructuredStorage`'s
 * constructor runs `OFFLINE_CACHE_SQL.createTable`/`createIndex` through
 * `execAsync`, so this factory only has to open a connection and hand it
 * over.
 */
import type { SqliteDriver, SqliteRunResult } from "./sqlite-driver.js";
import type { SqliteDriverFactory } from "./sqlite-driver-factory.js";

/**
 * The subset of an open `expo-sqlite` `SQLiteDatabase` this adapter
 * needs — structurally typed (rather than importing the package's own
 * type) so a test can supply a plain object, and so this file's only
 * runtime dependency on `expo-sqlite` stays inside
 * `DEFAULT_BINDINGS.openDatabaseAsync` below.
 *
 * `runAsync`'s result is narrowed to the one field `SqliteRunResult`
 * declares (`changes`); the real method also returns `lastInsertRowId`,
 * which this app's storage layer never reads.
 */
export interface ExpoSqliteDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: readonly unknown[]): Promise<SqliteRunResult>;
  getAllAsync<Row>(source: string, params: readonly unknown[]): Promise<Row[]>;
  getFirstAsync<Row>(source: string, params: readonly unknown[]): Promise<Row | null>;
  closeAsync(): Promise<void>;
}

/** The one native operation this factory needs from `expo-sqlite`, injectable for tests — see this module's doc comment. */
export interface ExpoSqliteBindings {
  openDatabaseAsync(databaseName: string): Promise<ExpoSqliteDatabase>;
}

/**
 * The real bindings. `openDatabaseAsync` is imported dynamically, never
 * at this module's top level — see this module's doc comment for why
 * that is what keeps every `AppCore`-importing vitest file working
 * without a native `ExpoSQLite` module linked. The cast is required
 * because `expo-sqlite`'s own `runAsync`/`getAllAsync` overloads accept
 * `SQLiteBindParams` (array-or-object) while this port always passes the
 * plain array the storage layer builds; the runtime shape is identical
 * for an array argument.
 */
const DEFAULT_BINDINGS: ExpoSqliteBindings = {
  async openDatabaseAsync(databaseName: string): Promise<ExpoSqliteDatabase> {
    const { openDatabaseAsync } = await import("expo-sqlite");
    return (await openDatabaseAsync(databaseName)) as unknown as ExpoSqliteDatabase;
  },
};

function wrapDatabase(database: ExpoSqliteDatabase): SqliteDriver {
  return {
    execAsync: (sql) => database.execAsync(sql),
    runAsync: (sql, params) => database.runAsync(sql, params),
    getAllAsync: (sql, params) => database.getAllAsync(sql, params),
    getFirstAsync: (sql, params) => database.getFirstAsync(sql, params),
    closeAsync: () => database.closeAsync(),
  };
}

/**
 * Opens `databaseName` through `expo-sqlite` and exposes it as a
 * `SqliteDriver`. `open()` resolves a ready driver, or rejects with a
 * real `Error` naming both the database and the underlying reason —
 * `OfflineCacheOwner`/`TurnOutboxOwner` turn that rejection into their
 * named `"degraded"` status rather than an unhandled rejection.
 */
export function createExpoSqliteDriverFactory(
  databaseName: string,
  bindings: ExpoSqliteBindings = DEFAULT_BINDINGS,
): SqliteDriverFactory {
  return {
    async open(): Promise<SqliteDriver> {
      try {
        return wrapDatabase(await bindings.openDatabaseAsync(databaseName));
      } catch (error) {
        throw new Error(
          `expo-sqlite could not open "${databaseName}": ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    },
  };
}
