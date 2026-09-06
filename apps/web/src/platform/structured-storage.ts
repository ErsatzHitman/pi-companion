import type { StructuredStorage, StructuredStorageListOptions } from "@picompanion/frontend-core";

/**
 * `StructuredStorage` backed by IndexedDB (plan.md §7.3).
 *
 * Records live in a single object store keyed by `"<collection>::<id>"` so
 * collections do not require schema migrations as new ones are added.
 */
export function createIndexedDbStructuredStorage(
  databaseName = "picompanion-structured-storage",
): StructuredStorage {
  const storeName = "records";
  let dbPromise: Promise<IDBDatabase> | null = null;

  const openDb = (): Promise<IDBDatabase> => {
    dbPromise ??= new Promise((resolve, reject) => {
      const request = window.indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to open IndexedDB database"));
    });
    return dbPromise;
  };

  const recordKey = (collection: string, id: string): string => `${collection}::${id}`;

  const runTransaction = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = run(tx.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  };

  return {
    async get<T>(collection: string, id: string) {
      const value = await runTransaction<T | undefined>("readonly", (store) =>
        store.get(recordKey(collection, id)),
      );
      return value ?? null;
    },
    async put<T>(collection: string, id: string, value: T) {
      await runTransaction("readwrite", (store) => store.put(value, recordKey(collection, id)));
    },
    async delete(collection: string, id: string) {
      await runTransaction("readwrite", (store) => store.delete(recordKey(collection, id)));
    },
    async list<T>(collection: string, options?: StructuredStorageListOptions) {
      const db = await openDb();
      return new Promise<T[]>((resolve, reject) => {
        const results: T[] = [];
        const idPrefix = `${collection}::${options?.idPrefix ?? ""}`;
        const request = db.transaction(storeName, "readonly").objectStore(storeName).openCursor();
        request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor failed"));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(results);
            return;
          }
          if (typeof cursor.key === "string" && cursor.key.startsWith(idPrefix)) {
            results.push(cursor.value as T);
            if (options?.limit !== undefined && results.length >= options.limit) {
              resolve(results);
              return;
            }
          }
          cursor.continue();
        };
      });
    },
    async clear(collection: string) {
      const db = await openDb();
      return new Promise<void>((resolve, reject) => {
        const idPrefix = `${collection}::`;
        const request = db.transaction(storeName, "readwrite").objectStore(storeName).openCursor();
        request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor failed"));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          if (typeof cursor.key === "string" && cursor.key.startsWith(idPrefix)) {
            cursor.delete();
          }
          cursor.continue();
        };
      });
    },
  };
}
