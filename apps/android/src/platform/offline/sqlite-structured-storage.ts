/**
 * `StructuredStorage` (`@picompanion/frontend-core`'s
 * `platform/storage.ts`) backed by a `SqliteDriver` (`./sqlite-
 * driver.ts`) — T37A, plan.md §7.3/§12.5 ("Android stores ordinary data
 * in Expo SQLite").
 *
 * This is the only place in this task's grant that touches the SQLite
 * driver directly. Everything above it — `@picompanion/frontend-core`'s
 * `offline.OfflineCache`, and any future domain code — talks only to
 * the `StructuredStorage` interface, never to `SqliteDriver` or a raw
 * SQL string. That is the "written through the platform interface, not
 * directly" acceptance criterion: `offline-cache.test.ts` proves it by
 * constructing `OfflineCache` over this class and never calling this
 * class's own methods, or the driver's, from the "session" side of that
 * test.
 *
 * All rows for every collection live in one physical table
 * (`offline_cache_rows`), keyed by `(collection, row_id)`; the
 * `StructuredStorage` `collection` argument is a plain column, not a
 * separate SQL table, so no schema migration is needed when a new
 * collection name is introduced.
 *
 * ## Bound policy ("cache size is bounded")
 *
 * Each `collection` independently holds at most `maxRowsPerCollection`
 * rows (default {@link DEFAULT_MAX_ROWS_PER_COLLECTION}). Every `put`
 * that pushes a collection over the bound evicts the least-recently-
 * written rows in that collection first (ties broken by row id), until
 * the collection is back at the bound — except a row whose id the
 * caller has marked protected via the `isProtected` constructor option
 * (T37A's grant), which is never evicted. `apps/android`'s eventual
 * caller (T32S4 or later; see `./index.ts`) is expected to pass
 * `isProtected: (_, id) => id === <the session id currently open>` so
 * the transcript on screen right now can never be evicted out from
 * under the user.
 *
 * If more rows than `maxRowsPerCollection` are protected at once, the
 * collection can exceed the bound (eviction only ever removes
 * unprotected rows) — an intentionally narrow case, since at most one
 * or two sessions are ever open at a time; `sqlite-structured-
 * storage.test.ts`'s "does not evict a protected id even when it is the
 * oldest row" case proves this is deliberate, not a bug.
 *
 * ## Secret exclusion
 *
 * `put` refuses (throws, before ever calling the driver) any value
 * whose own or nested enumerable keys look like a secret field
 * (password, token, relay/daemon/private key, bearer/authorization —
 * see `@picompanion/frontend-core`'s `security.isSecretShapedKey`). This
 * is a deliberately blunt,
 * defense-in-depth backstop: the real control is architectural (nothing
 * in this codebase's offline-cache callers ever has a secret to hand
 * this class — daemon passwords and relay keys go through
 * `../secure-storage.ts` only, per `../../features/connect/credential-
 * store.ts`'s header). `sqlite-structured-storage.test.ts` proves the
 * guard fires for shapes plausible for this cache (a session summary
 * carrying a stray `password`/`daemonKey` field) and does not fire for
 * ordinary cached session data.
 */
import {
  security,
  type StructuredStorage,
  type StructuredStorageListOptions,
} from "@picompanion/frontend-core";

import type { SqliteDriver } from "./sqlite-driver.js";

const TABLE = "offline_cache_rows";

/** Exported so `./in-memory-sqlite-driver.ts` can recognize exactly the statements this class issues. */
export const OFFLINE_CACHE_SQL = {
  createTable: `CREATE TABLE IF NOT EXISTS ${TABLE} (collection TEXT NOT NULL, row_id TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (collection, row_id))`,
  createIndex: `CREATE INDEX IF NOT EXISTS idx_${TABLE}_updated_at ON ${TABLE} (collection, updated_at)`,
  upsert: `INSERT INTO ${TABLE} (collection, row_id, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (collection, row_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  get: `SELECT value FROM ${TABLE} WHERE collection = ? AND row_id = ?`,
  deleteOne: `DELETE FROM ${TABLE} WHERE collection = ? AND row_id = ?`,
  deleteCollection: `DELETE FROM ${TABLE} WHERE collection = ?`,
  listCollection: `SELECT row_id, value FROM ${TABLE} WHERE collection = ? ORDER BY row_id ASC`,
  countCollection: `SELECT COUNT(*) as count FROM ${TABLE} WHERE collection = ?`,
  oldestFirst: `SELECT row_id, updated_at FROM ${TABLE} WHERE collection = ? ORDER BY updated_at ASC, row_id ASC`,
} as const;

interface ValueRow {
  value: string;
}
interface RowIdValueRow {
  row_id: string;
  value: string;
}
interface CountRow {
  count: number;
}
interface RowIdUpdatedAtRow {
  row_id: string;
  updated_at: number;
}

/** Default per-collection row bound; see this module's doc comment. */
export const DEFAULT_MAX_ROWS_PER_COLLECTION = 200;

/**
 * Field-name detection is centralized in `@picompanion/frontend-core`'s
 * `security` domain (T60A) — `security.isSecretShapedKey` is matched
 * case-insensitively, as a *substring* of the key, against every own
 * key of every plain object nested in a value passed to `put`,
 * including array elements. (Before T60A this module matched key names
 * *exactly*, which let a realistic field name that merely *contains* a
 * secret-shaped word — `accessToken`, `refreshToken`, `relayPassword`,
 * `sessionCookie` — through undetected; see `security/secret-shape.ts`'s
 * doc comment for that history.) This function still only inspects key
 * names, not value shapes — `tool-call-row-model.ts` is the one call
 * site that also redacts by value shape; unifying *detection* did not
 * require unifying which checks each site runs.
 */
function assertNotSecretShaped(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNotSecretShaped(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (security.isSecretShapedKey(key)) {
      throw new Error(
        `SqliteStructuredStorage.put refused a value with a secret-shaped field "${key}" at ${path}.${key} — secrets belong in SecureStorage (see ../secure-storage.ts), never in the plain offline cache.`,
      );
    }
    assertNotSecretShaped(nested, `${path}.${key}`);
  }
}

export interface SqliteStructuredStorageOptions {
  driver: SqliteDriver;
  /** Per-collection row bound; see this module's doc comment. Defaults to {@link DEFAULT_MAX_ROWS_PER_COLLECTION}. */
  maxRowsPerCollection?: number;
  /** Rows this predicate returns `true` for are never evicted by the bound policy. Defaults to protecting nothing. */
  isProtected?: (collection: string, id: string) => boolean;
  /** Clock for the internal LRU eviction timestamp only — unrelated to `OfflineCache`'s own `cachedAt`/`stale` bookkeeping. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * `StructuredStorage` implementation over a `SqliteDriver`. See this
 * module's doc comment for the bound and secret-exclusion policies.
 */
export class SqliteStructuredStorage implements StructuredStorage {
  private readonly driver: SqliteDriver;
  private readonly maxRowsPerCollection: number;
  private readonly isProtectedId: (collection: string, id: string) => boolean;
  private readonly now: () => number;
  private schemaReady: Promise<void> | null = null;

  constructor(options: SqliteStructuredStorageOptions) {
    this.driver = options.driver;
    this.maxRowsPerCollection = options.maxRowsPerCollection ?? DEFAULT_MAX_ROWS_PER_COLLECTION;
    this.isProtectedId = options.isProtected ?? (() => false);
    this.now = options.now ?? (() => Date.now());
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.driver.execAsync(OFFLINE_CACHE_SQL.createTable);
        await this.driver.execAsync(OFFLINE_CACHE_SQL.createIndex);
      })();
    }
    await this.schemaReady;
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    await this.ensureSchema();
    const row = await this.driver.getFirstAsync<ValueRow>(OFFLINE_CACHE_SQL.get, [collection, id]);
    return row ? (JSON.parse(row.value) as T) : null;
  }

  async put<T>(collection: string, id: string, value: T): Promise<void> {
    assertNotSecretShaped(value, "$");
    await this.ensureSchema();
    await this.driver.runAsync(OFFLINE_CACHE_SQL.upsert, [
      collection,
      id,
      JSON.stringify(value),
      this.now(),
    ]);
    await this.evictIfOverBound(collection);
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.ensureSchema();
    await this.driver.runAsync(OFFLINE_CACHE_SQL.deleteOne, [collection, id]);
  }

  async list<T>(collection: string, options?: StructuredStorageListOptions): Promise<T[]> {
    await this.ensureSchema();
    const rows = await this.driver.getAllAsync<RowIdValueRow>(OFFLINE_CACHE_SQL.listCollection, [
      collection,
    ]);
    const prefix = options?.idPrefix;
    const filtered = prefix ? rows.filter((row) => row.row_id.startsWith(prefix)) : rows;
    const limited = options?.limit !== undefined ? filtered.slice(0, options.limit) : filtered;
    return limited.map((row) => JSON.parse(row.value) as T);
  }

  async clear(collection: string): Promise<void> {
    await this.ensureSchema();
    await this.driver.runAsync(OFFLINE_CACHE_SQL.deleteCollection, [collection]);
  }

  private async evictIfOverBound(collection: string): Promise<void> {
    const countRow = await this.driver.getFirstAsync<CountRow>(OFFLINE_CACHE_SQL.countCollection, [
      collection,
    ]);
    const count = countRow?.count ?? 0;
    const over = count - this.maxRowsPerCollection;
    if (over <= 0) {
      return;
    }
    const oldest = await this.driver.getAllAsync<RowIdUpdatedAtRow>(OFFLINE_CACHE_SQL.oldestFirst, [
      collection,
    ]);
    let evicted = 0;
    for (const row of oldest) {
      if (evicted >= over) {
        break;
      }
      if (this.isProtectedId(collection, row.row_id)) {
        continue;
      }
      await this.driver.runAsync(OFFLINE_CACHE_SQL.deleteOne, [collection, row.row_id]);
      evicted += 1;
    }
  }
}
