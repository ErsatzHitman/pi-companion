import * as SecureStore from "expo-secure-store";

import type { SecureStorage } from "@picompanion/frontend-core";

import { encodeSecureStoreKey } from "./secure-store-key";

/**
 * `SecureStorage` backed by Expo SecureStore (plan.md §7.3, §12.1
 * "SecureStore for credentials and relay secrets"; T32A2).
 *
 * Deliberately as thin as `./lifecycle.ts`: four calls to
 * `expo-secure-store` and, since T331, one key encoding in front of the
 * three that take a key -- SecureStore accepts only `[A-Za-z0-9._-]` in
 * a key, and `credential-store.ts`'s `picompanion:secure:host-profile:
 * <id>:password` is not inside that alphabet; see `./secure-store-key.ts`
 * for the encoding and the run that found it. `expo-secure-store` reaches into
 * `react-native`, so — like `./lifecycle.ts` — this file cannot be
 * exercised under this workspace's plain `vitest` setup (see
 * `../../CLAUDE.md`'s "VITEST LIMITATION" note and `./lifecycle.ts`'s
 * doc comment); `secure-storage.test.ts` only checks the file's source
 * text for the four required calls and the encoding in front of them;
 * `secure-store-key.test.ts` executes the encoding itself. Reading this
 * file is the real proof of its own behaviour.
 *
 * Every judgement about *which* keys are secrets, what must never reach
 * plain storage or a log line, and the logout sweep lives in
 * `../features/connect/credential-store.ts`, which is fully unit
 * tested against an in-memory fake of the `SecureStorage` interface
 * this module implements.
 */
export function createExpoSecureStorage(): SecureStorage {
  return {
    async getSecret(key) {
      return SecureStore.getItemAsync(encodeSecureStoreKey(key));
    },
    async setSecret(key, value) {
      await SecureStore.setItemAsync(encodeSecureStoreKey(key), value);
    },
    async removeSecret(key) {
      await SecureStore.deleteItemAsync(encodeSecureStoreKey(key));
    },
    async isAvailable() {
      return SecureStore.isAvailableAsync();
    },
  };
}
