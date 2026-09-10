import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T32S3 source-level check for `key-value-storage.ts`.
 *
 * `key-value-storage.ts` imports `expo-secure-store`, which reaches into
 * `react-native` and cannot be imported under this workspace's plain
 * `vitest` setup (see `../../CLAUDE.md`'s "VITEST LIMITATION" note and
 * `./secure-storage.test.ts`'s identical pattern, which this mirrors).
 * Comments are stripped before matching (`readCode()`, same helper as
 * `../features/transcript/transcript-accessibility.test.ts`) so a doc
 * comment that merely mentions a call can't satisfy an assertion in
 * place of the real one.
 */
function readCode(): string {
  const source = readFileSync(
    fileURLToPath(new URL("./key-value-storage.ts", import.meta.url)),
    "utf8",
  );
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("createExpoKeyValueStorage", () => {
  it("exports the factory function", () => {
    expect(readCode()).toMatch(/export function createExpoKeyValueStorage\(/);
  });

  // T331: the PHYSICAL key SecureStore sees is `encodeSecureStoreKey(key)`
  // (`./secure-store-key.ts`); the LOGICAL key is what the index records.
  // Run 34454596535 found the unencoded form rejecting `credential-store.ts`'s
  // colon-bearing profile key on the first real connect.
  it("T331: delegates getItem to SecureStore.getItemAsync under the encoded key", () => {
    expect(readCode()).toMatch(
      /getItem\(key\)\s*\{\s*return SecureStore\.getItemAsync\(encodeSecureStoreKey\(key\)\);/,
    );
  });

  it("T331: delegates setItem to SecureStore.setItemAsync under the encoded key and indexes the logical one", () => {
    expect(readCode()).toMatch(
      /setItem\(key, value\)\s*\{\s*await SecureStore\.setItemAsync\(encodeSecureStoreKey\(key\), value\);/,
    );
    expect(readCode()).toMatch(/writeIndex\(\[\.\.\.index, key\]\)/);
  });

  it("T331: delegates removeItem to SecureStore.deleteItemAsync under the encoded key and prunes the logical one", () => {
    expect(readCode()).toMatch(
      /removeItem\(key\)\s*\{\s*await SecureStore\.deleteItemAsync\(encodeSecureStoreKey\(key\)\);/,
    );
    expect(readCode()).toMatch(/next = index\.filter\(\(existing\) => existing !== key\)/);
  });

  it("T331: clear() deletes every indexed key (re-encoded) plus the index itself", () => {
    expect(readCode()).toMatch(
      /index\.map\(\(key\) => SecureStore\.deleteItemAsync\(encodeSecureStoreKey\(key\)\)\)/,
    );
    expect(readCode()).toMatch(/await SecureStore\.deleteItemAsync\(INDEX_KEY\);/);
  });

  it("T331: imports the encoder from the pure secure-store-key module, and never passes a raw caller key to SecureStore", () => {
    const code = readCode();
    expect(code).toMatch(/import \{ encodeSecureStoreKey \} from "\.\/secure-store-key";/);
    // Every SecureStore call that takes a caller key must wrap it; the only
    // bare identifier allowed is the module's own in-alphabet INDEX_KEY.
    const bareKeyCalls = code.match(/SecureStore\.\w+Async\(key\b/g) ?? [];
    expect(bareKeyCalls).toEqual([]);
  });

  it("keys(prefix) filters the index by prefix when given", () => {
    expect(readCode()).toMatch(
      /keys\(prefix\)\s*\{\s*const index = await readIndex\(\);\s*return prefix \? index\.filter\(\(key\) => key\.startsWith\(prefix\)\) : index;/,
    );
  });

  it("imports expo-secure-store as the SecureStore namespace", () => {
    expect(readCode()).toMatch(/import \* as SecureStore from "expo-secure-store";/);
  });
});
