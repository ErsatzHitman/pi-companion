/**
 * In-memory `SqliteDriver` (`./sqlite-driver.ts`) test double — T37A.
 *
 * Recognizes exactly the fixed statement vocabulary
 * `SqliteStructuredStorage` (`./sqlite-structured-storage.ts`) issues,
 * matched by identity against `OFFLINE_CACHE_SQL`'s exported constants
 * (not by parsing SQL), and throws on anything else — so if
 * `SqliteStructuredStorage`'s SQL text ever drifts, every test using
 * this double fails loudly rather than silently returning wrong rows.
 * This is a fake for `SqliteStructuredStorage`'s own fixed queries, not
 * a general SQLite engine.
 *
 * Two instances constructed over the same shared `rows` array (the
 * `backing` constructor parameter) simulate an app restart, exactly
 * like `@picompanion/frontend-core`'s
 * `offline/test-doubles.ts#InMemoryStructuredStorage`: state written
 * before "restart" is still readable after.
 *
 * T68 (P5-W20) added `closeAsync` so `OfflineCacheOwner`'s disposal path
 * (`./offline-cache-owner.ts`) has something real to prove against: it
 * flips `closed` to `true` and every subsequent call on this instance
 * throws, so a test can assert both that `closeAsync` actually arrived
 * (not just that some internal flag flipped) and that nothing reaches a
 * "closed" driver afterward.
 */
import { OFFLINE_CACHE_SQL } from "./sqlite-structured-storage.js";
import type { SqliteDriver, SqliteRunResult } from "./sqlite-driver.js";

interface StoredRow {
  collection: string;
  row_id: string;
  value: string;
  updated_at: number;
}

export class InMemorySqliteDriver implements SqliteDriver {
  private closed = false;

  constructor(private readonly backing: StoredRow[] = []) {}

  /** Test/inspection surface: total row count across every collection. */
  get totalRowCount(): number {
    return this.backing.length;
  }

  /** Test/inspection surface: whether `closeAsync` has run — see this module's doc comment. */
  get isClosed(): boolean {
    return this.closed;
  }

  private assertOpen(method: string): void {
    if (this.closed) {
      throw new Error(
        `InMemorySqliteDriver.${method}: called after closeAsync() — this driver is closed.`,
      );
    }
  }

  async closeAsync(): Promise<void> {
    this.closed = true;
  }

  async execAsync(sql: string): Promise<void> {
    this.assertOpen("execAsync");
    if (sql !== OFFLINE_CACHE_SQL.createTable && sql !== OFFLINE_CACHE_SQL.createIndex) {
      throw new Error(`InMemorySqliteDriver.execAsync: unrecognized statement:\n${sql}`);
    }
  }

  async runAsync(sql: string, params: readonly unknown[]): Promise<SqliteRunResult> {
    this.assertOpen("runAsync");
    if (sql === OFFLINE_CACHE_SQL.upsert) {
      const [collection, rowId, value, updatedAt] = params as [string, string, string, number];
      const existing = this.backing.find(
        (row) => row.collection === collection && row.row_id === rowId,
      );
      if (existing) {
        existing.value = value;
        existing.updated_at = updatedAt;
      } else {
        this.backing.push({ collection, row_id: rowId, value, updated_at: updatedAt });
      }
      return { changes: 1 };
    }
    if (sql === OFFLINE_CACHE_SQL.deleteOne) {
      const [collection, rowId] = params as [string, string];
      const before = this.backing.length;
      const remaining = this.backing.filter(
        (row) => !(row.collection === collection && row.row_id === rowId),
      );
      this.backing.length = 0;
      this.backing.push(...remaining);
      return { changes: before - this.backing.length };
    }
    if (sql === OFFLINE_CACHE_SQL.deleteCollection) {
      const [collection] = params as [string];
      const before = this.backing.length;
      const remaining = this.backing.filter((row) => row.collection !== collection);
      this.backing.length = 0;
      this.backing.push(...remaining);
      return { changes: before - this.backing.length };
    }
    throw new Error(`InMemorySqliteDriver.runAsync: unrecognized statement:\n${sql}`);
  }

  async getAllAsync<Row>(sql: string, params: readonly unknown[]): Promise<Row[]> {
    this.assertOpen("getAllAsync");
    if (sql === OFFLINE_CACHE_SQL.listCollection) {
      const [collection] = params as [string];
      return this.backing
        .filter((row) => row.collection === collection)
        .sort((a, b) => a.row_id.localeCompare(b.row_id))
        .map((row) => ({ row_id: row.row_id, value: row.value })) as Row[];
    }
    if (sql === OFFLINE_CACHE_SQL.oldestFirst) {
      const [collection] = params as [string];
      return this.backing
        .filter((row) => row.collection === collection)
        .sort((a, b) => a.updated_at - b.updated_at || a.row_id.localeCompare(b.row_id))
        .map((row) => ({ row_id: row.row_id, updated_at: row.updated_at })) as Row[];
    }
    throw new Error(`InMemorySqliteDriver.getAllAsync: unrecognized statement:\n${sql}`);
  }

  async getFirstAsync<Row>(sql: string, params: readonly unknown[]): Promise<Row | null> {
    this.assertOpen("getFirstAsync");
    if (sql === OFFLINE_CACHE_SQL.get) {
      const [collection, rowId] = params as [string, string];
      const row = this.backing.find(
        (candidate) => candidate.collection === collection && candidate.row_id === rowId,
      );
      return row ? ({ value: row.value } as Row) : null;
    }
    if (sql === OFFLINE_CACHE_SQL.countCollection) {
      const [collection] = params as [string];
      const count = this.backing.filter((row) => row.collection === collection).length;
      return { count } as Row;
    }
    throw new Error(`InMemorySqliteDriver.getFirstAsync: unrecognized statement:\n${sql}`);
  }
}
