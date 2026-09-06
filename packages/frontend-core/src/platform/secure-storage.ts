/**
 * Secure secret storage interface (plan.md §7.3).
 *
 * Backs host credentials, pairing tokens, and other secrets that must
 * never land in plain key-value storage. `apps/web` backs this with the
 * Web Crypto API; `apps/android` backs this with Expo SecureStore.
 */
export interface SecureStorage {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  removeSecret(key: string): Promise<void>;
  /** Whether secure storage is available on this platform/device right now. */
  isAvailable(): Promise<boolean>;
}
