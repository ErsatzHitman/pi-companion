import { describe, expect, it } from "vitest";

import type { KeyValueStorage, LogFields, Logger, SecureStorage } from "@picompanion/frontend-core";

import {
  clearAllHostProfiles,
  clearHostProfile,
  listHostProfiles,
  loadHostProfileSecrets,
  redactHostProfileForLogging,
  saveHostProfile,
  secureStorageKey,
  type CredentialStoreDeps,
  type HostProfileRecord,
} from "./credential-store";

const SECRET_PASSWORD = "correct-horse-battery-staple";
const SECRET_RELAY_KEY = "relay-priv-b64:kX9mQ2vN7pR4wS8t";

function createFakeSecureStorage(
  available = true,
): SecureStorage & { dump(): Record<string, string> } {
  const store = new Map<string, string>();
  return {
    async getSecret(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    async setSecret(key, value) {
      store.set(key, value);
    },
    async removeSecret(key) {
      store.delete(key);
    },
    async isAvailable() {
      return available;
    },
    dump() {
      return Object.fromEntries(store);
    },
  };
}

function createFakePlainStorage(): KeyValueStorage & { dump(): Record<string, string> } {
  const store = new Map<string, string>();
  return {
    async getItem(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    async setItem(key, value) {
      store.set(key, value);
    },
    async removeItem(key) {
      store.delete(key);
    },
    async clear() {
      store.clear();
    },
    async keys(prefix) {
      const all = [...store.keys()];
      return prefix ? all.filter((key) => key.startsWith(prefix)) : all;
    },
    dump() {
      return Object.fromEntries(store);
    },
  };
}

interface RecordedLog {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  fields: LogFields | undefined;
}

function createFakeLogger(): Logger & { calls: RecordedLog[] } {
  const calls: RecordedLog[] = [];
  const logger: Logger = {
    debug(message, fields) {
      calls.push({ level: "debug", message, fields });
    },
    info(message, fields) {
      calls.push({ level: "info", message, fields });
    },
    warn(message, fields) {
      calls.push({ level: "warn", message, fields });
    },
    error(message, fields) {
      calls.push({ level: "error", message, fields });
    },
    child() {
      return logger;
    },
  };
  return Object.assign(logger, { calls });
}

function buildDeps(overrides: Partial<CredentialStoreDeps> = {}): {
  deps: CredentialStoreDeps;
  secureStorage: ReturnType<typeof createFakeSecureStorage>;
  plainStorage: ReturnType<typeof createFakePlainStorage>;
  logger: ReturnType<typeof createFakeLogger>;
} {
  const secureStorage = createFakeSecureStorage();
  const plainStorage = createFakePlainStorage();
  const logger = createFakeLogger();
  return {
    deps: { secureStorage, plainStorage, logger, ...overrides },
    secureStorage,
    plainStorage,
    logger,
  };
}

const PROFILE: HostProfileRecord = {
  id: "profile-1",
  label: "Workshop Pi",
  kind: "direct",
  endpoint: "192.168.1.10:6767",
  useTls: false,
  isIpv6: false,
};

const RELAY_PROFILE: HostProfileRecord = {
  id: "relay-server-1",
  label: "Studio relay",
  kind: "relay",
  endpoint: "relay.paseo.sh:443",
  useTls: true,
  isIpv6: false,
};

describe("saveHostProfile / secret isolation", () => {
  it("writes the profile to the plain sink and both secrets to the secure sink, under distinct keys", async () => {
    const { deps, secureStorage, plainStorage } = buildDeps();

    await saveHostProfile(deps, PROFILE, { password: SECRET_PASSWORD, relayKey: SECRET_RELAY_KEY });

    expect(JSON.parse(plainStorage.dump()["picompanion:host-profile:profile-1"]!)).toEqual(PROFILE);
    const secureDump = secureStorage.dump();
    expect(secureDump[secureStorageKey("profile-1", "password")]).toBe(SECRET_PASSWORD);
    expect(secureDump[secureStorageKey("profile-1", "relayKey")]).toBe(SECRET_RELAY_KEY);
  });

  it("never lets either secret substring reach the plain sink", async () => {
    const { deps, plainStorage } = buildDeps();

    await saveHostProfile(deps, PROFILE, { password: SECRET_PASSWORD, relayKey: SECRET_RELAY_KEY });

    const plainBlob = JSON.stringify(plainStorage.dump());
    expect(plainBlob).not.toContain(SECRET_PASSWORD);
    expect(plainBlob).not.toContain(SECRET_RELAY_KEY);
  });

  it("never lets either secret substring reach the logger", async () => {
    const { deps, logger } = buildDeps();

    await saveHostProfile(deps, PROFILE, { password: SECRET_PASSWORD, relayKey: SECRET_RELAY_KEY });

    expect(logger.calls.length).toBeGreaterThan(0);
    const logBlob = JSON.stringify(logger.calls);
    expect(logBlob).not.toContain(SECRET_PASSWORD);
    expect(logBlob).not.toContain(SECRET_RELAY_KEY);
    // and the log line does say a password/relay key were present, so the redaction
    // isn't simply omitting the fact — it's specifically omitting the value.
    expect(logBlob).toContain('"hasPassword":true');
    expect(logBlob).toContain('"hasRelayKey":true');
  });

  it("saves a profile with no secrets without touching secureStorage", async () => {
    const { deps, secureStorage } = buildDeps();

    await saveHostProfile(deps, PROFILE, {});

    expect(secureStorage.dump()).toEqual({});
  });

  it("throws before writing anything when secrets are given but secureStorage is unavailable", async () => {
    const { deps, plainStorage, secureStorage } = buildDeps({
      secureStorage: createFakeSecureStorage(false),
    });

    await expect(saveHostProfile(deps, PROFILE, { password: SECRET_PASSWORD })).rejects.toThrow(
      /not available/,
    );
    expect(plainStorage.dump()).toEqual({});
    expect(secureStorage.dump()).toEqual({});
  });
});

describe("redactHostProfileForLogging", () => {
  it("never includes a secret's value, only whether it is present", () => {
    const loggable = redactHostProfileForLogging(PROFILE, {
      password: SECRET_PASSWORD,
      relayKey: SECRET_RELAY_KEY,
    });

    const blob = JSON.stringify(loggable);
    expect(blob).not.toContain(SECRET_PASSWORD);
    expect(blob).not.toContain(SECRET_RELAY_KEY);
    expect(loggable).toMatchObject({
      id: PROFILE.id,
      label: PROFILE.label,
      endpoint: PROFILE.endpoint,
      hasPassword: true,
      hasRelayKey: true,
    });
  });

  it("reports false for a secret that was never supplied", () => {
    const loggable = redactHostProfileForLogging(PROFILE, { password: SECRET_PASSWORD });
    expect(loggable.hasPassword).toBe(true);
    expect(loggable.hasRelayKey).toBe(false);
  });

  it("defaults to no secrets at all when none are passed", () => {
    const loggable = redactHostProfileForLogging(PROFILE);
    expect(loggable.hasPassword).toBe(false);
    expect(loggable.hasRelayKey).toBe(false);
  });
});

describe("loadHostProfileSecrets", () => {
  it("round-trips whatever was saved", async () => {
    const { deps } = buildDeps();
    await saveHostProfile(deps, PROFILE, { password: SECRET_PASSWORD, relayKey: SECRET_RELAY_KEY });

    await expect(loadHostProfileSecrets(deps, PROFILE.id)).resolves.toEqual({
      password: SECRET_PASSWORD,
      relayKey: SECRET_RELAY_KEY,
    });
  });

  it("reports undefined for a secret that was never saved", async () => {
    const { deps } = buildDeps();
    await saveHostProfile(deps, PROFILE, { password: SECRET_PASSWORD });

    await expect(loadHostProfileSecrets(deps, PROFILE.id)).resolves.toEqual({
      password: SECRET_PASSWORD,
      relayKey: undefined,
    });
  });

  it("reports both undefined for an unknown profile id", async () => {
    const { deps } = buildDeps();
    await expect(loadHostProfileSecrets(deps, "never-saved")).resolves.toEqual({
      password: undefined,
      relayKey: undefined,
    });
  });
});

describe("listHostProfiles", () => {
  it("lists saved profiles' non-secret records only", async () => {
    const { deps } = buildDeps();
    const second: HostProfileRecord = { ...PROFILE, id: "profile-2", label: "Office Pi" };
    await saveHostProfile(deps, PROFILE, { password: SECRET_PASSWORD });
    await saveHostProfile(deps, second, { relayKey: SECRET_RELAY_KEY });

    const listed = await listHostProfiles(deps);
    expect(listed).toHaveLength(2);
    expect(listed).toEqual(expect.arrayContaining([PROFILE, second]));
    expect(JSON.stringify(listed)).not.toContain(SECRET_PASSWORD);
    expect(JSON.stringify(listed)).not.toContain(SECRET_RELAY_KEY);
  });

  it("returns an empty list when nothing has been saved", async () => {
    const { deps } = buildDeps();
    await expect(listHostProfiles(deps)).resolves.toEqual([]);
  });
});

describe("clearHostProfile (per-profile logout sweep)", () => {
  it("removes the plain record and both secrets, and a subsequent read reports nothing", async () => {
    const { deps, plainStorage } = buildDeps();
    await saveHostProfile(deps, PROFILE, { password: SECRET_PASSWORD, relayKey: SECRET_RELAY_KEY });

    await clearHostProfile(deps, PROFILE.id);

    expect(plainStorage.dump()).toEqual({});
    await expect(loadHostProfileSecrets(deps, PROFILE.id)).resolves.toEqual({
      password: undefined,
      relayKey: undefined,
    });
    await expect(listHostProfiles(deps)).resolves.toEqual([]);
  });

  it("is a no-op, not an error, for a profile that only ever had one secret", async () => {
    const { deps } = buildDeps();
    await saveHostProfile(deps, PROFILE, { password: SECRET_PASSWORD });

    await expect(clearHostProfile(deps, PROFILE.id)).resolves.toBeUndefined();
  });
});

describe("clearAllHostProfiles (full logout sweep)", () => {
  it("clears every saved profile's plain record and both secrets", async () => {
    const { deps, plainStorage, secureStorage } = buildDeps();
    const second: HostProfileRecord = { ...PROFILE, id: "profile-2", label: "Office Pi" };
    await saveHostProfile(deps, PROFILE, { password: SECRET_PASSWORD, relayKey: SECRET_RELAY_KEY });
    await saveHostProfile(deps, second, { password: "second-password" });

    await clearAllHostProfiles(deps);

    expect(plainStorage.dump()).toEqual({});
    expect(secureStorage.dump()).toEqual({});
    await expect(listHostProfiles(deps)).resolves.toEqual([]);
  });

  it("leaves nothing to clear when no profiles were ever saved", async () => {
    const { deps, plainStorage, secureStorage } = buildDeps();
    await clearAllHostProfiles(deps);
    expect(plainStorage.dump()).toEqual({});
    expect(secureStorage.dump()).toEqual({});
  });
});

describe("T66: a relay profile's E2EE pin (relayKey) never leaves SecureStorage", () => {
  it('saves the relay pin only to the secure sink, and `kind: "relay"` round-trips through the plain sink', async () => {
    const { deps, plainStorage, secureStorage } = buildDeps();
    const RELAY_PIN = "daemon-pub-b64:qN4vK9mR2wS8tX1p";

    await saveHostProfile(deps, RELAY_PROFILE, { relayKey: RELAY_PIN });

    const savedPlain = JSON.parse(
      plainStorage.dump()["picompanion:host-profile:relay-server-1"]!,
    ) as HostProfileRecord;
    expect(savedPlain).toEqual(RELAY_PROFILE);
    expect(savedPlain.kind).toBe("relay");
    expect(JSON.stringify(plainStorage.dump())).not.toContain(RELAY_PIN);

    expect(secureStorage.dump()[secureStorageKey("relay-server-1", "relayKey")]).toBe(RELAY_PIN);
  });

  it("a restored relay profile's pin round-trips exactly through loadHostProfileSecrets, never through listHostProfiles", async () => {
    const { deps } = buildDeps();
    const RELAY_PIN = "daemon-pub-b64:qN4vK9mR2wS8tX1p";
    await saveHostProfile(deps, RELAY_PROFILE, { relayKey: RELAY_PIN });

    const restored = await listHostProfiles(deps);
    expect(restored).toEqual([RELAY_PROFILE]);
    expect(JSON.stringify(restored)).not.toContain(RELAY_PIN);

    await expect(loadHostProfileSecrets(deps, RELAY_PROFILE.id)).resolves.toEqual({
      password: undefined,
      relayKey: RELAY_PIN,
    });
  });
});

describe("secureStorageKey", () => {
  it("produces a distinct key per profile id and per secret kind", () => {
    const keys = new Set([
      secureStorageKey("a", "password"),
      secureStorageKey("a", "relayKey"),
      secureStorageKey("b", "password"),
      secureStorageKey("b", "relayKey"),
    ]);
    expect(keys.size).toBe(4);
  });

  it("never collides with the plain-storage key for the same id", async () => {
    const { deps, plainStorage, secureStorage } = buildDeps();
    await saveHostProfile(deps, PROFILE, { password: SECRET_PASSWORD });

    const plainKeys = Object.keys(plainStorage.dump());
    const secureKeys = Object.keys(secureStorage.dump());
    for (const key of secureKeys) {
      expect(plainKeys).not.toContain(key);
    }
  });
});
