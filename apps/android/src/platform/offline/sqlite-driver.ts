/**
 * The SQLite driver port `SqliteStructuredStorage` (`./sqlite-structured-
 * storage.ts`) is built against (T37A, plan.md §7.3/§12.5).
 *
 * `expo-sqlite` is an installed dependency of `apps/android` since T390
 * (`apps/android/package.json` declares `"expo-sqlite": "~16.0.10"`, the
 * version `apps/android/node_modules/expo/bundledNativeModules.json`
 * pins for the installed Expo SDK). This file still defines a narrow
 * port shaped after `expo-sqlite`'s real `SQLiteDatabase` async API
 * (`execAsync`/`runAsync`/`getAllAsync`/`getFirstAsync`, all
 * promise-returning, all parameterized with `?` placeholders) rather
 * than importing the package directly, so every rule this task owns
 * remains provable against `./in-memory-sqlite-driver.ts` and other
 * RN-free doubles. The real adapter over `expo-sqlite` lives in
 * `./expo-sqlite-driver-factory.ts` (`createExpoSqliteDriverFactory`),
 * implementing `SqliteDriverFactory` without changing this file,
 * `./sqlite-structured-storage.ts`, or anything in
 * `@picompanion/frontend-core`.
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
