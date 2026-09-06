import type { KeyValueStorage } from "@picompanion/frontend-core";

/**
 * `KeyValueStorage` backed by `window.localStorage` (plan.md §7.3).
 *
 * Keys are namespaced so this app never collides with anything else that
 * happens to share the origin's localStorage.
 */
export function createLocalStorageKeyValueStorage(namespace = "picompanion:kv:"): KeyValueStorage {
  const prefixed = (key: string) => `${namespace}${key}`;

  const listKeys = (subPrefix: string): string[] => {
    const full = prefixed(subPrefix);
    const result: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key !== null && key.startsWith(full)) {
        result.push(key);
      }
    }
    return result;
  };

  return {
    async getItem(key) {
      return window.localStorage.getItem(prefixed(key));
    },
    async setItem(key, value) {
      window.localStorage.setItem(prefixed(key), value);
    },
    async removeItem(key) {
      window.localStorage.removeItem(prefixed(key));
    },
    async clear() {
      for (const key of listKeys("")) {
        window.localStorage.removeItem(key);
      }
    },
    async keys(prefix) {
      return listKeys(prefix ?? "").map((key) => key.slice(namespace.length));
    },
  };
}
