/**
 * Key-value and structured storage interfaces (plan.md §7.3).
 *
 * These are contracts only. `frontend-core` never implements storage
 * itself: `apps/web` backs `KeyValueStorage`/`StructuredStorage` with
 * IndexedDB, `apps/android` backs them with Expo SQLite. Nothing in this
 * file may import a concrete storage engine.
 */

/**
 * Simple async string key-value storage, used for small local durable
 * state such as the last opened session id or UI preferences.
 */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Removes every key owned by this storage instance. */
  clear(): Promise<void>;
  /** Lists keys, optionally filtered by prefix. */
  keys(prefix?: string): Promise<string[]>;
}

/** Options for listing records from a `StructuredStorage` collection. */
export interface StructuredStorageListOptions {
  /** Only return records whose id starts with this prefix. */
  idPrefix?: string;
  /** Maximum number of records to return. */
  limit?: number;
}

/**
 * Structured storage for larger or queryable local records (host
 * profiles, drafts, outbox entries, cached timeline pages). Records are
 * grouped into named collections and addressed by id within a
 * collection; the implementation decides how collections map onto the
 * underlying engine (object stores, tables, and so on).
 */
export interface StructuredStorage {
  get<T>(collection: string, id: string): Promise<T | null>;
  put<T>(collection: string, id: string, value: T): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
  list<T>(collection: string, options?: StructuredStorageListOptions): Promise<T[]>;
  /** Removes every record in a collection. */
  clear(collection: string): Promise<void>;
}
