/**
 * The key alphabet `expo-secure-store` accepts, and a reversible
 * encoding of any logical storage key into it — T331.
 *
 * `expo-secure-store`'s `ensureValidKey` (see `SecureStore.js` in that
 * package's `build/`) throws `Invalid key provided to SecureStore. Keys
 * must not be empty and contain only alphanumeric characters, ".", "-",
 * and "_".` for anything outside `SECURE_STORE_KEY_PATTERN`. Both of this
 * directory's storage adapters (`key-value-storage.ts`, the "plain"
 * `KeyValueStorage`, and `secure-storage.ts`, the `SecureStorage` for
 * credentials) are backed by that module, and until T331 both passed
 * every caller's key straight through. That was invisible to every unit
 * test (each adapter is source-pinned, not executed — see their own doc
 * comments) and fatal on a device: the first key any real connect writes
 * is `credential-store.ts`'s `picompanion:host-profile:<endpoint>`, whose
 * colons are outside the alphabet, so `saveHostProfile` rejected before
 * `connection-shell.tsx`'s `router.replace` ever ran, and every
 * connect-form Maestro flow in run 34454596535 stalled on the connect
 * screen reading "Connected via direct connection" with nowhere to go.
 * `sessions-model.ts`'s `sessions/last-opened-session-id` (a slash) and
 * `credential-store.ts`'s `picompanion:secure:host-profile:<id>:password`
 * (colons) would have failed the same way one step later. The two keys
 * that HAD worked on device — `picompanion.onboarding.v1` and
 * `picompanion.settings.v1` — are the two that happen to use only dots.
 *
 * `encodeSecureStoreKey` maps a logical key to one SecureStore accepts:
 * every code unit outside `[A-Za-z0-9.-]` becomes `_` plus two uppercase
 * hex digits of its UTF-8 bytes (`:` → `_3A`, `/` → `_2F`), and a
 * literal `_` is itself escaped (`_5F`) so the underscore is
 * unambiguously an escape lead — two distinct logical keys can never
 * share a physical one, and `decodeSecureStoreKey` inverts the mapping
 * exactly. A key already inside the alphabet AND free of underscores
 * encodes to itself, which is what keeps the two dot-only keys above
 * readable on an install that wrote them before T331.
 *
 * Pure (no `expo-secure-store` import) so it can be executed, not just
 * source-pinned, under this workspace's plain `vitest` — the same split
 * `keyboard-inset-model.ts`/`keyboard-inset.ts` use one directory over.
 */

/** Mirrors `expo-secure-store`'s own `ensureValidKey` test; `secure-store-key.test.ts` pins it against that package's real source. */
export const SECURE_STORE_KEY_PATTERN = /^[\w.-]+$/;

/** Code units that pass through unchanged. Deliberately excludes `_`, the escape lead. */
const PASSTHROUGH = /^[A-Za-z0-9.-]$/;

export function isValidSecureStoreKey(key: string): boolean {
  return SECURE_STORE_KEY_PATTERN.test(key);
}

/**
 * The SecureStore key for one logical key. Total: never throws, and the
 * result satisfies `isValidSecureStoreKey` for every non-empty input
 * (an empty key encodes to an empty string, which SecureStore itself
 * rejects — that refusal is left to it, as it was before T331).
 */
export function encodeSecureStoreKey(key: string): string {
  let out = "";
  for (const char of key) {
    if (PASSTHROUGH.test(char)) {
      out += char;
      continue;
    }
    // `encodeURIComponent` yields `%XX` per UTF-8 byte for everything it
    // escapes; the characters it leaves alone that SecureStore still
    // rejects (`!'()*~`) and the escape lead itself are hex-escaped by
    // hand below, so every non-passthrough character ends up as `_XX`.
    const escaped = encodeURIComponent(char);
    if (escaped.startsWith("%")) {
      out += escaped.replaceAll("%", "_");
    } else {
      for (const byte of new TextEncoder().encode(char)) {
        out += `_${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    }
  }
  return out;
}

/** Exact inverse of `encodeSecureStoreKey`. Throws on a string that is not a valid encoding (a stray `_` not followed by two hex digits). */
export function decodeSecureStoreKey(encoded: string): string {
  if (/_(?![0-9A-Fa-f]{2})/.test(encoded)) {
    throw new Error(`Not a SecureStore-encoded key: ${JSON.stringify(encoded)}`);
  }
  return decodeURIComponent(encoded.replaceAll("_", "%"));
}
