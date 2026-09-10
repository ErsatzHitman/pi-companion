import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import type { KeyValueStorage, SecureStorage } from "@picompanion/frontend-core";

import type { DaemonConnectionStore } from "../features/connect/daemon-connection-store";
import type { HostProfileRecord } from "../features/connect/credential-store";
import { secureStorageKey } from "../features/connect/credential-store";
import type {
  ReconnectHostProfile,
  ReconnectResult,
} from "../features/connect/host-profile-reconnect";
import { reconnectColdStartProfile, type ColdStartReconnectDeps } from "./cold-start-reconnect";

const PROFILE: HostProfileRecord = {
  id: "10.0.2.2:43023",
  label: "Cold start restore host",
  kind: "direct",
  endpoint: "10.0.2.2:43023",
  useTls: false,
  isIpv6: false,
};

function fakeLifecycle() {
  return { dispose: vi.fn(async () => {}) };
}

function makeDeps(options: {
  phases: string[];
  result: ReconnectResult | ((profile: HostProfileRecord) => Promise<ReconnectResult>);
  secrets?: Record<string, string>;
}) {
  const phases = [...options.phases];
  const adoptLifecycle = vi.fn(async () => {});
  const connection = {
    getSnapshot: () => ({
      phase: phases.length > 1 ? phases.shift() : phases[0],
      error: null,
      path: null,
      daemonAddress: null,
    }),
    adoptLifecycle,
  } as unknown as DaemonConnectionStore;
  const getSecret = vi.fn(async (key: string) => options.secrets?.[key] ?? null);
  const secureStorage = { getSecret } as unknown as SecureStorage;
  const keyValueStorage = {} as KeyValueStorage;
  const reconnectHostProfile = vi.fn<ReconnectHostProfile>(async (profile) =>
    typeof options.result === "function" ? options.result(profile) : options.result,
  );
  const deps: ColdStartReconnectDeps = {
    connection,
    reconnectHostProfile,
    keyValueStorage,
    secureStorage,
  };
  return { deps, adoptLifecycle, getSecret, reconnectHostProfile };
}

describe("reconnectColdStartProfile (T337)", () => {
  it("loads the profile's secrets, reconnects through AppCore.reconnectHostProfile, and adopts the lifecycle as the profile's own path", async () => {
    const lifecycle = fakeLifecycle();
    const { deps, adoptLifecycle, getSecret, reconnectHostProfile } = makeDeps({
      phases: ["idle"],
      result: { ok: true, lifecycle: lifecycle as never, path: "direct" },
      secrets: { [secureStorageKey(PROFILE.id, "password")]: "hunter2" },
    });

    const outcome = await reconnectColdStartProfile(deps, PROFILE);

    expect(outcome).toEqual({ kind: "reconnected", path: "direct" });
    expect(getSecret).toHaveBeenCalledWith(secureStorageKey(PROFILE.id, "password"));
    expect(reconnectHostProfile).toHaveBeenCalledWith(PROFILE, {
      password: "hunter2",
      relayKey: undefined,
    });
    expect(adoptLifecycle).toHaveBeenCalledWith(lifecycle, "direct", PROFILE);
    expect(lifecycle.dispose).not.toHaveBeenCalled();
  });

  it("publishes a relay profile as path relay, straight from ReconnectSuccess.path", async () => {
    const lifecycle = fakeLifecycle();
    const { deps, adoptLifecycle } = makeDeps({
      phases: ["idle"],
      result: { ok: true, lifecycle: lifecycle as never, path: "relay" },
    });
    const relayProfile: HostProfileRecord = { ...PROFILE, kind: "relay" };

    await expect(reconnectColdStartProfile(deps, relayProfile)).resolves.toEqual({
      kind: "reconnected",
      path: "relay",
    });
    expect(adoptLifecycle).toHaveBeenCalledWith(lifecycle, "relay", relayProfile);
  });

  it("returns the failure, adopts nothing, and never throws when the host cannot be reached", async () => {
    const { deps, adoptLifecycle } = makeDeps({
      phases: ["idle"],
      result: { ok: false, kind: "unreachable", error: "Could not reach", pinMismatch: false },
    });

    await expect(reconnectColdStartProfile(deps, PROFILE)).resolves.toEqual({
      kind: "failed",
      error: "Could not reach",
      pinMismatch: false,
    });
    expect(adoptLifecycle).not.toHaveBeenCalled();
  });

  it("carries a relay pin mismatch through as pinMismatch: true, distinct from unreachable", async () => {
    const { deps } = makeDeps({
      phases: ["idle"],
      result: { ok: false, kind: "wrong-daemon-key", error: "pin", pinMismatch: true },
    });

    await expect(reconnectColdStartProfile(deps, PROFILE)).resolves.toMatchObject({
      kind: "failed",
      pinMismatch: true,
    });
  });

  it("does nothing when another attempt has already started (store not idle), without even reading secrets", async () => {
    const { deps, getSecret, reconnectHostProfile, adoptLifecycle } = makeDeps({
      phases: ["connecting"],
      result: { ok: false, kind: "unknown", error: "unused", pinMismatch: false },
    });

    await expect(reconnectColdStartProfile(deps, PROFILE)).resolves.toEqual({
      kind: "skipped",
      reason: "already-started",
    });
    expect(getSecret).not.toHaveBeenCalled();
    expect(reconnectHostProfile).not.toHaveBeenCalled();
    expect(adoptLifecycle).not.toHaveBeenCalled();
  });

  it("disposes the lifecycle it opened, rather than adopting it, when a user-driven attempt started while it was in flight", async () => {
    const lifecycle = fakeLifecycle();
    // idle when checked first, connecting by the time the attempt resolves
    const { deps, adoptLifecycle } = makeDeps({
      phases: ["idle", "connecting"],
      result: { ok: true, lifecycle: lifecycle as never, path: "direct" },
    });

    await expect(reconnectColdStartProfile(deps, PROFILE)).resolves.toEqual({
      kind: "skipped",
      reason: "superseded",
    });
    expect(lifecycle.dispose).toHaveBeenCalledTimes(1);
    expect(adoptLifecycle).not.toHaveBeenCalled();
  });
});

describe("AppCoreProvider wires reconnectColdStartProfile once the cold-start read settles (T337)", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../app/core-context.tsx", import.meta.url)),
    "utf8",
  );

  it("imports the module and fires it from an effect keyed on the resolved cold-start profile", () => {
    expect(source).toMatch(
      /import \{ reconnectColdStartProfile \} from "\.\.\/app-shell\/cold-start-reconnect(?:\.js)?";/,
    );
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*const profile = coldStart\.profile;\s*if \(!coldStart\.resolved \|\| !profile\) return;\s*void reconnectColdStartProfile\(core, profile\);\s*\}, \[core, coldStart\.resolved, coldStart\.profile\]\);/,
    );
  });

  it("does not gate children on the reconnect: the only `return null` is still the profile-read gate", () => {
    const gates = source.match(/if \(!coldStart\.resolved\) \{\s*return null;\s*\}/g) ?? [];
    expect(gates).toHaveLength(1);
    expect(source).not.toMatch(/await reconnectColdStartProfile/);
  });
});
