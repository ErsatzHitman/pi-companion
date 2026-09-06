import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T32A2 source-level check for `secure-storage.ts`.
 *
 * `secure-storage.ts` imports `expo-secure-store`, which reaches into
 * `react-native` and cannot be imported under this workspace's plain
 * `vitest` setup (see `../../CLAUDE.md`'s "VITEST LIMITATION" note and
 * `./lifecycle.ts`'s doc comment, which the same limitation applies
 * to). This asserts the adapter's source text delegates every
 * `SecureStorage` method to its real `expo-secure-store` counterpart,
 * which is what a runtime call-through test would otherwise check.
 *
 * Comments are stripped before matching — see `../features/transcript/
 * transcript-accessibility.test.ts`'s `readCode()` — so a doc comment
 * that merely *mentions* a method name can't satisfy the assertion in
 * place of the real call.
 */
function readCode(): string {
  const source = readFileSync(
    fileURLToPath(new URL("./secure-storage.ts", import.meta.url)),
    "utf8",
  );
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("createExpoSecureStorage", () => {
  it("exports the factory function", () => {
    expect(readCode()).toMatch(/export function createExpoSecureStorage\(/);
  });

  it("delegates getSecret to SecureStore.getItemAsync", () => {
    expect(readCode()).toMatch(/getSecret\(key\)\s*\{\s*return SecureStore\.getItemAsync\(key\);/);
  });

  it("delegates setSecret to SecureStore.setItemAsync", () => {
    expect(readCode()).toMatch(
      /setSecret\(key, value\)\s*\{\s*await SecureStore\.setItemAsync\(key, value\);/,
    );
  });

  it("delegates removeSecret to SecureStore.deleteItemAsync", () => {
    expect(readCode()).toMatch(
      /removeSecret\(key\)\s*\{\s*await SecureStore\.deleteItemAsync\(key\);/,
    );
  });

  it("delegates isAvailable to SecureStore.isAvailableAsync", () => {
    expect(readCode()).toMatch(/isAvailable\(\)\s*\{\s*return SecureStore\.isAvailableAsync\(\);/);
  });

  it("imports expo-secure-store as the SecureStore namespace", () => {
    expect(readCode()).toMatch(/import \* as SecureStore from "expo-secure-store";/);
  });
});
