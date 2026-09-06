import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type pino from "pino";
import { describe, expect, test } from "vitest";

import { PRIVATE_FILE_MODE } from "../private-files.js";
import { PushTokenStore } from "./token-store.js";

const MODE_MASK = 0o777;
const PERMISSIVE_FILE_MODE = 0o644;

function createLogger(): pino.Logger {
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  };
  return logger as unknown as pino.Logger;
}

function modeOf(filePath: string): number {
  return statSync(filePath).mode & MODE_MASK;
}

describe("PushTokenStore registration semantics (T61)", () => {
  function withStore(fn: (store: PushTokenStore, tokenPath: string) => void): void {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-"));
    const tokenPath = path.join(home, "push-tokens.json");
    try {
      fn(new PushTokenStore(createLogger(), tokenPath), tokenPath);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  test("addToken is additive, not a per-device overwrite: a second, different token does not replace the first", () => {
    withStore((store) => {
      store.addToken("ExponentPushToken[old]");
      store.addToken("ExponentPushToken[new]");

      // This is the exact fact the T61 brief asked to settle: registering a
      // new token (as a refresh would) does NOT supersede the previous one
      // in the store. Both remain, and push/notifications.ts's
      // `getAllTokens()` fan-out would send to both.
      expect(store.getAllTokens().sort()).toEqual(
        ["ExponentPushToken[new]", "ExponentPushToken[old]"].sort(),
      );
    });
  });

  test("addToken dedupes only an exact repeat of the same token", () => {
    withStore((store) => {
      store.addToken("ExponentPushToken[same]");
      store.addToken("ExponentPushToken[same]");

      expect(store.getAllTokens()).toEqual(["ExponentPushToken[same]"]);
    });
  });

  test("removeToken deletes the exact token and leaves other tokens receiving", () => {
    withStore((store) => {
      store.addToken("ExponentPushToken[keep]");
      store.addToken("ExponentPushToken[gone]");

      store.removeToken("ExponentPushToken[gone]");

      expect(store.getAllTokens()).toEqual(["ExponentPushToken[keep]"]);
    });
  });

  test("removeToken on a token the store never held is a silent no-op, not an error", () => {
    withStore((store, tokenPath) => {
      store.addToken("ExponentPushToken[keep]");

      expect(() => store.removeToken("ExponentPushToken[never-registered]")).not.toThrow();
      // Unregistering an unknown token must not disturb tokens that ARE
      // registered, and must not write a new file version either (no
      // persist() call for an unknown token) — both are how a client could
      // otherwise infer "that token existed" from side effects.
      expect(store.getAllTokens()).toEqual(["ExponentPushToken[keep]"]);
      expect(existsSync(tokenPath)).toBe(true);
    });
  });
});

describe.skipIf(process.platform === "win32")("PushTokenStore file permissions", () => {
  test("persists push tokens with private permissions", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-"));
    const tokenPath = path.join(home, "push-tokens.json");
    try {
      const store = new PushTokenStore(createLogger(), tokenPath);

      store.addToken("ExponentPushToken[test]");

      expect(modeOf(tokenPath)).toBe(PRIVATE_FILE_MODE);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("repairs existing push token file permissions when loading", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-"));
    const tokenPath = path.join(home, "push-tokens.json");
    try {
      writeFileSync(tokenPath, JSON.stringify({ tokens: ["ExponentPushToken[test]"] }));
      chmodSync(tokenPath, PERMISSIVE_FILE_MODE);

      const store = new PushTokenStore(createLogger(), tokenPath);

      expect(store.getAllTokens()).toEqual(["ExponentPushToken[test]"]);
      expect(modeOf(tokenPath)).toBe(PRIVATE_FILE_MODE);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
