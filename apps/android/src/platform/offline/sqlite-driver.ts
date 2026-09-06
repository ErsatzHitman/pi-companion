/**
 * The SQLite driver port `SqliteStructuredStorage` (`./sqlite-structured-
 * storage.ts`) is built against (T37A, plan.md §7.3/§12.5).
 *
 * `expo-sqlite` is not an installed dependency of `apps/android` today
 * (`apps/android/package.json` has no `expo-sqlite` entry, and
 * `node_modules/expo-sqlite` does not exist) and this task's grant does
 * not permit `npm install` (see this repo's root `CLAUDE.md`). So this
 * file defines a narrow port shaped after `expo-sqlite`'s real
 * `SQLiteDatabase` async API (`execAsync`/`runAsync`/`getAllAsync`/
 * `getFirstAsync`, all promise-returning, all parameterized with `?`
 * placeholders) rather than importing the package directly. Every rule
 * this task owns is proven against `./in-memory-sqlite-driver.ts`, an
 * in-memory implementation of exactly this port.
 *
 * When a maintainer runs
 * `npm install expo-sqlite@~16.0.10 --workspace=@picompanion/android`
 * (the version `apps/android/node_modules/expo/bundledNativeModules.json`
 * pins for the installed Expo SDK, confirmed by this task by reading
 * that file — `"expo-sqlite": "~16.0.10"`), a small adapter — e.g.
 * `./expo-sqlite-driver.ts`, `export function createExpoSqliteDriver():
 * SqliteDriver` wrapping `expo-sqlite`'s `openDatabaseAsync` — can
 * implement `SqliteDriver` without changing this file, without
 * changing `./sqlite-structured-storage.ts`, and without changing
 * anything in `@picompanion/frontend-core`. That adapter is not part of
 * this task: nothing in this repository imports `expo-sqlite` today.
 *
 * T68 (P5-W20) added the optional `closeAsync` member below (a
 * lifecycle-disposal hook this port did not need until something
 * actually owned that lifecycle — see `./offline-cache-owner.ts`) and
 * `./sqlite-driver-factory.ts`'s `SqliteDriverFactory`, the injected
 * "open (or fail to open) a driver" seam `OfflineCacheOwner` is built
 * against instead of importing `expo-sqlite` directly, for the same
 * reason this file's own port exists.
 */

/** The result shape of a write statement (`INSERT`/`UPDATE`/`DELETE`). */
export interface SqliteRunResult {
  /** Number of rows the statement affected. */
  changes: number;
}

/**
 * A minimal async SQLite driver: run a statement with no result rows,
 * run a write statement, or read rows back. Mirrors `expo-sqlite`'s
 * `SQLiteDatabase` method names and signatures closely enough that a
 * real adapter over `expo-sqlite` is a thin wrapper, not a rewrite.
 */
export interface SqliteDriver {
  /** Runs a statement that returns no rows and takes no parameters (schema DDL). */
  execAsync(sql: string): Promise<void>;
  /** Runs a parameterized write statement (`INSERT`/`UPDATE`/`DELETE`). */
  runAsync(sql: string, params: readonly unknown[]): Promise<SqliteRunResult>;
  /** Runs a parameterized read statement, returning every matching row. */
  getAllAsync<Row>(sql: string, params: readonly unknown[]): Promise<Row[]>;
  /** Runs a parameterized read statement, returning the first matching row or `null`. */
  getFirstAsync<Row>(sql: string, params: readonly unknown[]): Promise<Row | null>;
  /**
   * Closes the underlying database connection/file handle, if the
   * implementation holds one open (T68, P5-W20 — `OfflineCacheOwner`'s
   * lifecycle disposal). Optional because `SqliteDriver` predates this
   * member and every driver double built against the interface before
   * T68 remains valid without implementing it; a driver that omits it is
   * simply treated as having nothing to close. Mirrors `expo-sqlite`'s
   * real `SQLiteDatabase.closeAsync()`.
   */
  closeAsync?(): Promise<void>;
}
