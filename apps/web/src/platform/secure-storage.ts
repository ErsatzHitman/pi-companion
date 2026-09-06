import type { SecureStorage } from "@picompanion/frontend-core";

/**
 * `SecureStorage` backed by the Web Crypto API (plan.md §7.3).
 *
 * The browser has no OS keychain, so this encrypts secrets at rest with a
 * non-extractable AES-GCM key kept in IndexedDB (never readable as raw key
 * material, even from this page's own script) and stores the ciphertext in
 * `localStorage`. This raises the bar above plain `localStorage` but is not
 * equivalent to a native secure enclave; callers should still treat
 * long-lived high-value secrets (for example relay private keys) as
 * platform-appropriate for a browser context.
 */
export function createWebCryptoSecureStorage(namespace = "picompanion:secure:"): SecureStorage {
  const keyDbName = "picompanion-secure-storage-key";
  const keyStoreName = "keys";
  const keyRecordId = "aes-gcm-key";
  let keyPromise: Promise<CryptoKey> | null = null;

  const available = (): boolean =>
    typeof window !== "undefined" &&
    typeof window.crypto?.subtle !== "undefined" &&
    typeof window.indexedDB !== "undefined";

  const openKeyDb = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const request = window.indexedDB.open(keyDbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(keyStoreName)) {
          request.result.createObjectStore(keyStoreName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to open secure-storage key database"));
    });

  const loadOrCreateKey = async (): Promise<CryptoKey> => {
    const db = await openKeyDb();
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const request = db
        .transaction(keyStoreName, "readonly")
        .objectStore(keyStoreName)
        .get(keyRecordId);
      request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to read secure-storage key"));
    });
    if (existing) return existing;

    const key = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(keyStoreName, "readwrite")
        .objectStore(keyStoreName)
        .put(key, keyRecordId);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to persist secure-storage key"));
    });
    return key;
  };

  const getKey = (): Promise<CryptoKey> => {
    keyPromise ??= loadOrCreateKey();
    return keyPromise;
  };

  const storageKey = (key: string) => `${namespace}${key}`;

  return {
    async isAvailable() {
      return available();
    },
    async getSecret(key) {
      if (!available()) return null;
      const raw = window.localStorage.getItem(storageKey(key));
      if (raw === null) return null;
      const [ivB64, cipherB64] = raw.split(".");
      if (!ivB64 || !cipherB64) return null;
      const iv = base64ToBytes(ivB64);
      const cipher = base64ToBytes(cipherB64);
      const cryptoKey = await getKey();
      const plainBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        cryptoKey,
        cipher,
      );
      return new TextDecoder().decode(plainBuffer);
    },
    async setSecret(key, value) {
      if (!available()) {
        throw new Error("SecureStorage is not available in this browser context");
      }
      const cryptoKey = await getKey();
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const cipher = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        cryptoKey,
        new TextEncoder().encode(value),
      );
      window.localStorage.setItem(
        storageKey(key),
        `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`,
      );
    },
    async removeSecret(key) {
      window.localStorage.removeItem(storageKey(key));
    },
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
