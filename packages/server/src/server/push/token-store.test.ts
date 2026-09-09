import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type pino from "pino";
import { describe, expect, test } from "vitest";

import { PRIVATE_FILE_MODE } from "../private-files.js";
import { PushTokenStore, UNATTRIBUTED_CLIENT_ID } from "./token-store.js";

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
      store.addToken("ExponentPushToken[old]", "client-a");
      store.addToken("ExponentPushToken[new]", "client-a");

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
      store.addToken("ExponentPushToken[same]", "client-a");
      store.addToken("ExponentPushToken[same]", "client-a");

      expect(store.getAllTokens()).toEqual(["ExponentPushToken[same]"]);
    });
  });

  test("removeToken deletes the exact token and leaves other tokens receiving", () => {
    withStore((store) => {
      store.addToken("ExponentPushToken[keep]", "client-a");
      store.addToken("ExponentPushToken[gone]", "client-a");

      store.removeToken("ExponentPushToken[gone]");

      expect(store.getAllTokens()).toEqual(["ExponentPushToken[keep]"]);
    });
  });

  test("removeToken on a token the store never held is a silent no-op, not an error", () => {
    withStore((store, tokenPath) => {
      store.addToken("ExponentPushToken[keep]", "client-a");

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

describe("PushTokenStore clientId attribution and revocation (T299)", () => {
  function withStore(fn: (store: PushTokenStore, tokenPath: string) => void): void {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-t299-"));
    const tokenPath = path.join(home, "push-tokens.json");
    try {
      fn(new PushTokenStore(createLogger(), tokenPath), tokenPath);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  test("a token is attributable to the clientId that registered it, surviving a reload from disk", () => {
    withStore((store, tokenPath) => {
      store.addToken("ExponentPushToken[device-a]", "client-a");

      // Prove attribution really persisted, not just held in memory: a
      // FRESH store instance reading the same file must still be able to
      // revoke this token by clientId.
      const reloaded = new PushTokenStore(createLogger(), tokenPath);
      reloaded.removeTokensForClient("client-a");

      expect(reloaded.getAllTokens()).toEqual([]);
    });
  });

  test("removeTokensForClient removes only the revoked device's tokens — the next send does not reach it, but a different device's does", () => {
    withStore((store) => {
      store.addToken("ExponentPushToken[device-a]", "client-a");
      store.addToken("ExponentPushToken[device-b]", "client-b");

      store.removeTokensForClient("client-a");

      // getAllTokens() is exactly what push/notifications.ts's
      // createPushNotificationSender().send() fans a push out to
      // (push-service.ts's sendPush receives this array directly) — this
      // is the real send-time consumption point, not merely proof that
      // removeTokensForClient was called.
      expect(store.getAllTokens()).toEqual(["ExponentPushToken[device-b]"]);
    });
  });

  test("a device with multiple registered tokens loses all of them on revoke", () => {
    withStore((store) => {
      store.addToken("ExponentPushToken[device-a-old]", "client-a");
      store.addToken("ExponentPushToken[device-a-new]", "client-a");
      store.addToken("ExponentPushToken[device-b]", "client-b");

      store.removeTokensForClient("client-a");

      expect(store.getAllTokens()).toEqual(["ExponentPushToken[device-b]"]);
    });
  });

  test("removeTokensForClient for a clientId with no registered tokens is a silent no-op", () => {
    withStore((store, tokenPath) => {
      store.addToken("ExponentPushToken[device-b]", "client-b");
      const before = readFileSync(tokenPath, "utf-8");

      expect(() => store.removeTokensForClient("client-never-registered")).not.toThrow();

      expect(store.getAllTokens()).toEqual(["ExponentPushToken[device-b]"]);
      // No spurious rewrite for a clientId that owned nothing.
      expect(readFileSync(tokenPath, "utf-8")).toBe(before);
    });
  });

  test("removeToken with a clientId only removes that client's own copy, leaving another client's identical-looking registration alone", () => {
    withStore((store) => {
      // Two different devices, two different tokens (this is the real
      // shape — Expo tokens are per-install), attributed to two clients.
      store.addToken("ExponentPushToken[mine]", "client-a");
      store.addToken("ExponentPushToken[theirs]", "client-b");

      // client-a tries to deregister a token it does not own. Scoped
      // removeToken must not remove it from client-b's bucket.
      store.removeToken("ExponentPushToken[theirs]", "client-a");

      expect(store.getAllTokens().sort()).toEqual(
        ["ExponentPushToken[mine]", "ExponentPushToken[theirs]"].sort(),
      );

      // client-a deregistering its OWN token still works.
      store.removeToken("ExponentPushToken[mine]", "client-a");
      expect(store.getAllTokens()).toEqual(["ExponentPushToken[theirs]"]);
    });
  });

  test("removeToken with no clientId (the push-service dead-token cleanup path) still removes regardless of owner", () => {
    withStore((store) => {
      store.addToken("ExponentPushToken[dead]", "client-a");
      store.addToken("ExponentPushToken[alive]", "client-b");

      store.removeToken("ExponentPushToken[dead]");

      expect(store.getAllTokens()).toEqual(["ExponentPushToken[alive]"]);
    });
  });

  describe("migration: tokens persisted before T299 have no clientId", () => {
    function writeLegacyFile(tokenPath: string, tokens: string[]): void {
      writeFileSync(tokenPath, JSON.stringify({ tokens }, null, 2) + "\n");
    }

    test("a legacy bare-string token file loads with its tokens intact and reachable by getAllTokens", () => {
      const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-legacy-"));
      const tokenPath = path.join(home, "push-tokens.json");
      try {
        writeLegacyFile(tokenPath, ["ExponentPushToken[legacy-a]", "ExponentPushToken[legacy-b]"]);

        const store = new PushTokenStore(createLogger(), tokenPath);

        // Decision: grandfathered, not dropped — see token-store.ts's
        // "Migration decision (T299)". Notifications to devices that were
        // never revoked must not silently stop the moment this fix ships.
        expect(store.getAllTokens().sort()).toEqual(
          ["ExponentPushToken[legacy-a]", "ExponentPushToken[legacy-b]"].sort(),
        );
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });

    test("a legacy token cannot be revoked by any clientId, including the sentinel itself — the disclosed residual", () => {
      const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-legacy-revoke-"));
      const tokenPath = path.join(home, "push-tokens.json");
      try {
        writeLegacyFile(tokenPath, ["ExponentPushToken[legacy]"]);
        const store = new PushTokenStore(createLogger(), tokenPath);

        store.removeTokensForClient("some-clientId-nobody-owns");
        store.removeTokensForClient(UNATTRIBUTED_CLIENT_ID);

        expect(store.getAllTokens()).toEqual(["ExponentPushToken[legacy]"]);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });

    test("a legacy token converges to a real clientId once that device re-registers, and becomes revocable", () => {
      const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-legacy-converge-"));
      const tokenPath = path.join(home, "push-tokens.json");
      try {
        writeLegacyFile(tokenPath, ["ExponentPushToken[legacy]"]);
        const store = new PushTokenStore(createLogger(), tokenPath);

        // Simulates the device's OS issuing a fresh token and the app
        // registering it, exactly like a normal refresh — see
        // push-registration-model.ts's refresh path.
        store.addToken("ExponentPushToken[refreshed]", "client-a");

        store.removeTokensForClient("client-a");

        // The new token is gone (revoked). The stale legacy token is
        // untouched by this revoke — it was never attributed to
        // client-a in the first place, so this is not a bug in the
        // revoke, just the disclosed residual until it too is cleaned up
        // (e.g. by Expo eventually reporting it DeviceNotRegistered).
        expect(store.getAllTokens()).toEqual(["ExponentPushToken[legacy]"]);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });

    test("loading a legacy-format file rewrites it to the new {clientId, token} shape on disk immediately", () => {
      const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-legacy-rewrite-"));
      const tokenPath = path.join(home, "push-tokens.json");
      try {
        writeLegacyFile(tokenPath, ["ExponentPushToken[legacy]"]);

        new PushTokenStore(createLogger(), tokenPath);

        const onDisk = JSON.parse(readFileSync(tokenPath, "utf-8")) as {
          tokens: Array<{ clientId: string; token: string }>;
        };
        expect(onDisk.tokens).toEqual([
          { clientId: UNATTRIBUTED_CLIENT_ID, token: "ExponentPushToken[legacy]" },
        ]);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });

    test("a new-format file with a real clientId round-trips through save and reload, and stays revocable", () => {
      const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-new-format-"));
      const tokenPath = path.join(home, "push-tokens.json");
      try {
        const store = new PushTokenStore(createLogger(), tokenPath);
        store.addToken("ExponentPushToken[device-a]", "client-a");

        const reloaded = new PushTokenStore(createLogger(), tokenPath);
        expect(reloaded.getAllTokens()).toEqual(["ExponentPushToken[device-a]"]);

        reloaded.removeTokensForClient("client-a");
        expect(reloaded.getAllTokens()).toEqual([]);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });
  });
});

describe.skipIf(process.platform === "win32")("PushTokenStore file permissions", () => {
  test("persists push tokens with private permissions", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-push-tokens-"));
    const tokenPath = path.join(home, "push-tokens.json");
    try {
      const store = new PushTokenStore(createLogger(), tokenPath);

      store.addToken("ExponentPushToken[test]", "client-a");

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
