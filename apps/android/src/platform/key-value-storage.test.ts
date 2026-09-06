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

  it("delegates getItem to SecureStore.getItemAsync", () => {
    expect(readCode()).toMatch(/getItem\(key\)\s*\{\s*return SecureStore\.getItemAsync\(key\);/);
  });

  it("delegates setItem to SecureStore.setItemAsync and updates the key index", () => {
    expect(readCode()).toMatch(
      /setItem\(key, value\)\s*\{\s*await SecureStore\.setItemAsync\(key, value\);/,
    );
    expect(readCode()).toMatch(/writeIndex\(\[\.\.\.index, key\]\)/);
  });

  it("delegates removeItem to SecureStore.deleteItemAsync and prunes the key index", () => {
    expect(readCode()).toMatch(
      /removeItem\(key\)\s*\{\s*await SecureStore\.deleteItemAsync\(key\);/,
    );
    expect(readCode()).toMatch(/next = index\.filter\(\(existing\) => existing !== key\)/);
  });

  it("clear() deletes every indexed key plus the index itself", () => {
    expect(readCode()).toMatch(/index\.map\(\(key\) => SecureStore\.deleteItemAsync\(key\)\)/);
    expect(readCode()).toMatch(/await SecureStore\.deleteItemAsync\(INDEX_KEY\);/);
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
