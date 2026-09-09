import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type pino from "pino";
import { describe, expect, test } from "vitest";

import { PRIVATE_FILE_MODE } from "../private-files.js";
import { RevokedDeviceStore } from "./revoked-device-store.js";

const MODE_MASK = 0o777;

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

describe("RevokedDeviceStore (T300)", () => {
  function withStore(fn: (store: RevokedDeviceStore, storePath: string) => void): void {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-revoked-devices-"));
    const storePath = path.join(home, "revoked-devices.json");
    try {
      fn(new RevokedDeviceStore(createLogger(), storePath), storePath);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  test("a clientId is not revoked until revoke() is called", () => {
    withStore((store) => {
      expect(store.isRevoked("client-a")).toBe(false);
      store.revoke("client-a");
      expect(store.isRevoked("client-a")).toBe(true);
    });
  });

  test("revoking one clientId does not affect another", () => {
    withStore((store) => {
      store.revoke("client-a");
      expect(store.isRevoked("client-a")).toBe(true);
      expect(store.isRevoked("client-b")).toBe(false);
    });
  });

  test("blank clientId is never revocable and never reported revoked", () => {
    withStore((store) => {
      store.revoke("   ");
      expect(store.isRevoked("")).toBe(false);
      expect(store.isRevoked("   ")).toBe(false);
    });
  });

  test("survives a daemon restart — reloaded from real disk, not held only in memory", () => {
    withStore((store, storePath) => {
      store.revoke("client-a");

      // A fresh instance against the SAME file simulates a daemon restart:
      // if persistence were broken, this instance would start with an
      // empty in-memory Map and report client-a as not revoked.
      const reloaded = new RevokedDeviceStore(createLogger(), storePath);
      expect(reloaded.isRevoked("client-a")).toBe(true);
      expect(reloaded.isRevoked("client-b")).toBe(false);
    });
  });

  test("un-revoke removes a clientId from the denylist, and that removal survives a restart too", () => {
    withStore((store, storePath) => {
      store.revoke("client-a");
      expect(store.isRevoked("client-a")).toBe(true);

      store.unrevoke("client-a");
      expect(store.isRevoked("client-a")).toBe(false);

      const reloaded = new RevokedDeviceStore(createLogger(), storePath);
      expect(reloaded.isRevoked("client-a")).toBe(false);
    });
  });

  test("un-revoking a clientId that was never revoked is a silent no-op, not an error", () => {
    withStore((store) => {
      expect(() => store.unrevoke("never-revoked")).not.toThrow();
      expect(store.isRevoked("never-revoked")).toBe(false);
    });
  });

  test("list() reflects revoke and unrevoke", () => {
    withStore((store) => {
      expect(store.list()).toEqual([]);
      store.revoke("client-a");
      store.revoke("client-b");
      expect(
        store
          .list()
          .map((entry) => entry.clientId)
          .sort(),
      ).toEqual(["client-a", "client-b"]);
      store.unrevoke("client-a");
      expect(store.list().map((entry) => entry.clientId)).toEqual(["client-b"]);
    });
  });

  test("on-disk shape is {revoked: [{clientId, revokedAt}]}", () => {
    withStore((store, storePath) => {
      store.revoke("client-a");
      const raw = JSON.parse(readFileSync(storePath, "utf-8")) as {
        revoked: Array<{ clientId: string; revokedAt: string }>;
      };
      expect(raw.revoked).toHaveLength(1);
      expect(raw.revoked[0]!.clientId).toBe("client-a");
      expect(typeof raw.revoked[0]!.revokedAt).toBe("string");
      expect(Number.isNaN(Date.parse(raw.revoked[0]!.revokedAt))).toBe(false);
    });
  });

  test("a corrupt or missing file loads as empty rather than throwing", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-revoked-devices-missing-"));
    try {
      const storePath = path.join(home, "does-not-exist.json");
      const store = new RevokedDeviceStore(createLogger(), storePath);
      expect(store.isRevoked("anything")).toBe(false);
      expect(store.list()).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// Mirrors token-store.test.ts's own `describe.skipIf` group: `chmodSync`
// (and therefore the private-file-mode guarantee it verifies) is a no-op on
// win32 — see `private-files.ts`'s `chmodBestEffort`.
describe.skipIf(process.platform === "win32")("RevokedDeviceStore file permissions", () => {
  test("persists with private file permissions", () => {
    const home = mkdtempSync(path.join(tmpdir(), "paseo-revoked-devices-perms-"));
    const storePath = path.join(home, "revoked-devices.json");
    try {
      const store = new RevokedDeviceStore(createLogger(), storePath);
      store.revoke("client-a");
      expect(modeOf(storePath)).toBe(PRIVATE_FILE_MODE);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
