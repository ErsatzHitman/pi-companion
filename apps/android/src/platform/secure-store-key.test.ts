import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { secureStorageKey } from "../features/connect/credential-store";
import { ONBOARDING_STORAGE_KEY } from "../features/connect/onboarding-model";
import { LAST_OPENED_SESSION_STORAGE_KEY } from "../features/sessions/sessions-model";
import { SETTINGS_STORAGE_KEY } from "../features/settings/settings-model";
import {
  SECURE_STORE_KEY_PATTERN,
  decodeSecureStoreKey,
  encodeSecureStoreKey,
  isValidSecureStoreKey,
} from "./secure-store-key";

/**
 * `secure-store-key.ts` — T331. Executed, not source-pinned: the module
 * is pure, so every case below runs the real encoder.
 *
 * The one thing a pure test cannot prove is that `SECURE_STORE_KEY_PATTERN`
 * is the SAME rule `expo-secure-store` enforces on device, so the first
 * case reads that package's real built source and pins the regex it
 * validates keys with. If a future SDK bump changes the alphabet, that
 * case fails first and names the drift.
 */

/** The exact key run 34454596535 rejected on every connect-form flow. */
const PROFILE_KEY_FROM_THE_RUN = "picompanion:host-profile:10.0.2.2:38251";

function readExpoSecureStoreSource(): string {
  return readFileSync(
    fileURLToPath(
      new URL("../../../../node_modules/expo-secure-store/build/SecureStore.js", import.meta.url),
    ),
    "utf8",
  );
}

describe("SECURE_STORE_KEY_PATTERN", () => {
  it("is the rule expo-secure-store itself validates keys with", () => {
    const source = readExpoSecureStoreSource();
    // `function ensureValidKey(key) { if (!isValid(key)) throw ... }` /
    // `function isValid(value) { return typeof value === 'string' && /^[\w.-]+$/.test(value); }`
    const match = source.match(/(\/\^\[[^\]]+\]\+\$\/)\.test\(/);
    expect(
      match,
      "expo-secure-store no longer validates keys with a single anchored regex",
    ).not.toBeNull();
    expect(match?.[1]).toBe(String(SECURE_STORE_KEY_PATTERN));
    expect(source).toMatch(/Invalid key provided to SecureStore/);
  });

  it("accepts the two dot-only keys that already worked on device, and rejects the three that never did", () => {
    expect(isValidSecureStoreKey(ONBOARDING_STORAGE_KEY)).toBe(true);
    expect(isValidSecureStoreKey(SETTINGS_STORAGE_KEY)).toBe(true);
    expect(isValidSecureStoreKey(PROFILE_KEY_FROM_THE_RUN)).toBe(false);
    expect(isValidSecureStoreKey(LAST_OPENED_SESSION_STORAGE_KEY)).toBe(false);
    expect(isValidSecureStoreKey(secureStorageKey("10.0.2.2:38251", "password"))).toBe(false);
  });
});

describe("encodeSecureStoreKey", () => {
  it("turns the exact key the run rejected into one inside the alphabet", () => {
    const encoded = encodeSecureStoreKey(PROFILE_KEY_FROM_THE_RUN);
    expect(encoded).toBe("picompanion_3Ahost-profile_3A10.0.2.2_3A38251");
    expect(isValidSecureStoreKey(encoded)).toBe(true);
  });

  it("encodes every real storage key the app writes into a valid one", () => {
    for (const key of [
      ONBOARDING_STORAGE_KEY,
      SETTINGS_STORAGE_KEY,
      PROFILE_KEY_FROM_THE_RUN,
      LAST_OPENED_SESSION_STORAGE_KEY,
      secureStorageKey("10.0.2.2:38251", "password"),
      secureStorageKey("[::1]:6768", "relayKey"),
      "picompanion:host-profile:relay-abc_123",
    ]) {
      expect(isValidSecureStoreKey(encodeSecureStoreKey(key)), key).toBe(true);
    }
  });

  it("leaves a key that is already in the alphabet and underscore-free untouched (existing installs keep their values)", () => {
    expect(encodeSecureStoreKey(ONBOARDING_STORAGE_KEY)).toBe(ONBOARDING_STORAGE_KEY);
    expect(encodeSecureStoreKey(SETTINGS_STORAGE_KEY)).toBe(SETTINGS_STORAGE_KEY);
    expect(encodeSecureStoreKey("abc.DEF-123")).toBe("abc.DEF-123");
  });

  it("escapes the underscore itself, so a literal `_3A` and an encoded `:` can never collide", () => {
    expect(encodeSecureStoreKey("a_3Ab")).toBe("a_5F3Ab");
    expect(encodeSecureStoreKey("a:b")).toBe("a_3Ab");
    expect(encodeSecureStoreKey("a_3Ab")).not.toBe(encodeSecureStoreKey("a:b"));
  });

  it("hex-escapes the characters encodeURIComponent leaves alone but SecureStore still rejects", () => {
    expect(encodeSecureStoreKey("!'()*~")).toBe("_21_27_28_29_2A_7E");
  });

  it("encodes non-ASCII as UTF-8 bytes and round-trips through decodeSecureStoreKey", () => {
    for (const key of [
      PROFILE_KEY_FROM_THE_RUN,
      LAST_OPENED_SESSION_STORAGE_KEY,
      "a_3Ab",
      "host/ünïcode:π",
      "emoji-🙂-key",
      "!'()*~",
      "",
    ]) {
      expect(decodeSecureStoreKey(encodeSecureStoreKey(key)), key).toBe(key);
    }
  });

  it("decodeSecureStoreKey refuses a string that is not an encoding (a bare underscore)", () => {
    expect(() => decodeSecureStoreKey("a_b")).toThrow(/Not a SecureStore-encoded key/);
    expect(() => decodeSecureStoreKey("trailing_")).toThrow(/Not a SecureStore-encoded key/);
  });
});
