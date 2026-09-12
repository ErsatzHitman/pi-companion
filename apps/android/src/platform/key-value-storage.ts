import * as SecureStore from "expo-secure-store";

import type { KeyValueStorage } from "@picompanion/frontend-core";

import { encodeSecureStoreKey } from "./secure-store-key";

/**
 * `KeyValueStorage` backed by Expo SecureStore (T32S3, plan.md §7.3,
 * §12.1). `SessionsScreen`'s cold-start restore (T32B3) and open-session
 * persistence need a real, on-device-persistent `KeyValueStorage` — the
 * last-opened session id survives an app restart only if this is real,
 * not an in-memory fake.
 *
 * SecureStore is the only always-available persistence primitive this
 * app can use without adding a package: `expo-sqlite` is installed since
 * T390, but `@react-native-async-storage/async-storage` is not a
 * dependency of `apps/android`, and this module's own `clear()`/`keys(prefix)`
 * surface was built over SecureStore before the `expo-sqlite` install
 * landed. SecureStore is semantically
 * meant for secrets, not plain values, but its API (`getItemAsync`/
 * `setItemAsync`/`deleteItemAsync`) is a perfectly usable plain
 * key-value store, and this module is a distinct instance from
 * `./secure-storage.ts` (different keys, no shared state) — this file
 * exists so `KeyValueStorage`'s `clear()`/`keys(prefix)` methods, which
 * SecureStore itself has no enumeration API for, are implementable at
 * all: every `setItem`/`removeItem` call also updates a companion
 * `INDEX_KEY` entry listing every key this instance has ever written,
 * so `keys()`/`clear()` can enumerate without a native list call.
 *
 * A real, non-secret `KeyValueStorage` (AsyncStorage or an Expo SQLite
 * table) is the correct long-term replacement — SecureStore also has a
 * platform-imposed value-size ceiling (2048 bytes on Android) plain
 * storage would not — but adding that dependency is out of this task's
 * grant (no `npm install`); whichever task adds it can swap this
 * module's body without changing `KeyValueStorage`'s shape or any
 * caller.
 *
 * Like `./secure-storage.ts`, `expo-secure-store` reaches into
 * `react-native`, so this file cannot be imported under this
 * workspace's plain `vitest` setup (see `../../CLAUDE.md`'s "VITEST
 * LIMITATION" note) — `key-value-storage.test.ts` checks the file's
 * source text instead, the same pattern `secure-storage.test.ts` already
 * established.
 *
 * **T331: every caller key is encoded before it reaches SecureStore.**
 * SecureStore accepts only `[A-Za-z0-9._-]` in a key and throws on
 * anything else, and this adapter used to hand keys through verbatim --
 * so `credential-store.ts`'s `picompanion:host-profile:<endpoint>` (three
 * colons) rejected on the very first real connect, which is what left
 * every connect-form Maestro flow in run 34454596535 stuck on the connect
 * screen. `setItem`/`getItem`/`removeItem` now go through
 * `./secure-store-key.ts`'s `encodeSecureStoreKey` for the PHYSICAL key;
 * the companion index keeps the LOGICAL keys, so `keys(prefix)` still
 * filters on what callers wrote and `clear()` re-encodes each one to
 * delete it. `INDEX_KEY` itself is a private constant already inside the
 * alphabet and is used as-is.
 */
const INDEX_KEY = "__picompanion_kv_index__";

async function readIndex(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

async function writeIndex(keys: readonly string[]): Promise<void> {
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(keys));
}

export function createExpoKeyValueStorage(): KeyValueStorage {
  return {
    async getItem(key) {
      return SecureStore.getItemAsync(encodeSecureStoreKey(key));
    },
    async setItem(key, value) {
      await SecureStore.setItemAsync(encodeSecureStoreKey(key), value);
      const index = await readIndex();
      if (!index.includes(key)) {
        await writeIndex([...index, key]);
      }
    },
    async removeItem(key) {
      await SecureStore.deleteItemAsync(encodeSecureStoreKey(key));
      const index = await readIndex();
      const next = index.filter((existing) => existing !== key);
      if (next.length !== index.length) {
        await writeIndex(next);
      }
    },
    async clear() {
      const index = await readIndex();
      await Promise.all(index.map((key) => SecureStore.deleteItemAsync(encodeSecureStoreKey(key))));
      await SecureStore.deleteItemAsync(INDEX_KEY);
    },
    async keys(prefix) {
      const index = await readIndex();
      return prefix ? index.filter((key) => key.startsWith(prefix)) : index;
    },
  };
}
