import { describe, expect, it } from "vitest";

import {
  LOADING_TRUSTED_DEVICES_SNAPSHOT,
  fetchTrustedDevices,
  formatLastSeen,
  sortTrustedDevices,
  summarizeTrustedDevice,
  type TrustedDeviceRecord,
  type TrustedDevicesClient,
} from "./trusted-devices-model.js";

const NOW = new Date("2026-09-09T12:00:00.000Z");

function record(overrides: Partial<TrustedDeviceRecord> = {}): TrustedDeviceRecord {
  return {
    clientId: "clid_fixture_0001",
    appVersion: "1.2.3",
    lastSeenAt: "2026-09-09T11:59:00.000Z",
    connected: true,
    ...overrides,
  };
}

describe("fetchTrustedDevices", () => {
  it("degrades to an unavailable, empty snapshot when the client has no listTrustedDevices — never throws", async () => {
    const client: TrustedDevicesClient = {};
    const snapshot = await fetchTrustedDevices(client);
    expect(snapshot).toEqual({ status: "unavailable", devices: [], error: null });
  });

  it("degrades the same way for a null/undefined client", async () => {
    expect(await fetchTrustedDevices(null)).toEqual({
      status: "unavailable",
      devices: [],
      error: null,
    });
    expect(await fetchTrustedDevices(undefined)).toEqual({
      status: "unavailable",
      devices: [],
      error: null,
    });
  });

  it("resolves loaded with the devices a real client returns", async () => {
    const devices = [record()];
    const client: TrustedDevicesClient = {
      listTrustedDevices: async () => ({ requestId: "r1", devices }),
    };
    const snapshot = await fetchTrustedDevices(client);
    expect(snapshot).toEqual({ status: "loaded", devices, error: null });
  });

  it("resolves an error snapshot, not a throw, when the client's call rejects", async () => {
    const client: TrustedDevicesClient = {
      listTrustedDevices: async () => {
        throw new Error("Not connected to a daemon");
      },
    };
    const snapshot = await fetchTrustedDevices(client);
    expect(snapshot).toEqual({ status: "error", devices: [], error: "Not connected to a daemon" });
  });

  it("stringifies a non-Error rejection rather than losing the reason", async () => {
    const client: TrustedDevicesClient = {
      listTrustedDevices: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "boom";
      },
    };
    const snapshot = await fetchTrustedDevices(client);
    expect(snapshot.status).toBe("error");
    expect(snapshot.error).toBe("boom");
  });
});

describe("LOADING_TRUSTED_DEVICES_SNAPSHOT", () => {
  it("is the loading status with no devices and no error", () => {
    expect(LOADING_TRUSTED_DEVICES_SNAPSHOT).toEqual({
      status: "loading",
      devices: [],
      error: null,
    });
  });
});

describe("summarizeTrustedDevice", () => {
  it("marks the row matching thisClientId", () => {
    const summary = summarizeTrustedDevice(record({ clientId: "picompanion-android" }), {
      thisClientId: "picompanion-android",
      now: NOW,
    });
    expect(summary.isThisDevice).toBe(true);
  });

  it("does not mark an unrelated device", () => {
    const summary = summarizeTrustedDevice(record({ clientId: "other-device" }), {
      thisClientId: "picompanion-android",
      now: NOW,
    });
    expect(summary.isThisDevice).toBe(false);
  });

  it("labels a null appVersion honestly rather than rendering the literal null", () => {
    const summary = summarizeTrustedDevice(record({ appVersion: null }), {
      thisClientId: "x",
      now: NOW,
    });
    expect(summary.appVersionLabel).toBe("Unknown version");
    expect(summary.appVersionLabel).not.toMatch(/null/);
  });

  it("carries connected through unchanged", () => {
    expect(
      summarizeTrustedDevice(record({ connected: false }), { thisClientId: "x", now: NOW })
        .connected,
    ).toBe(false);
    expect(
      summarizeTrustedDevice(record({ connected: true }), { thisClientId: "x", now: NOW })
        .connected,
    ).toBe(true);
  });

  it("never surfaces a field outside the allow-list — the acceptance box this feature exists for", () => {
    // A hostile record carrying something secret-shaped alongside the
    // real wire fields. The real wire schema never sends this — this
    // proves the PROJECTION itself, not the schema, is what protects the
    // screen: if `summarizeTrustedDevice` ever changed to spread `...device`
    // instead of naming its four fields, this is the test that would catch it.
    const hostile = {
      ...record(),
      token: "sk-should-never-render",
      password: "hunter2",
      privateKey: "-----BEGIN PRIVATE KEY-----",
    } as unknown as TrustedDeviceRecord;

    const summary = summarizeTrustedDevice(hostile, { thisClientId: "x", now: NOW });
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain("sk-should-never-render");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(Object.keys(summary).sort()).toEqual(
      ["appVersionLabel", "clientId", "connected", "isThisDevice", "lastSeenLabel"].sort(),
    );
  });
});

describe("sortTrustedDevices", () => {
  it("puts this device first regardless of connection/recency", () => {
    const mine = record({
      clientId: "mine",
      connected: false,
      lastSeenAt: "2020-01-01T00:00:00.000Z",
    });
    const other = record({
      clientId: "other",
      connected: true,
      lastSeenAt: "2026-09-09T11:59:59.000Z",
    });
    const sorted = sortTrustedDevices([other, mine], "mine");
    expect(sorted.map((d) => d.clientId)).toEqual(["mine", "other"]);
  });

  it("puts connected devices ahead of disconnected ones (excluding this device)", () => {
    const a = record({ clientId: "a", connected: false });
    const b = record({ clientId: "b", connected: true });
    const sorted = sortTrustedDevices([a, b], "someone-else");
    expect(sorted.map((d) => d.clientId)).toEqual(["b", "a"]);
  });

  it("orders same-connectedness devices by most-recently-seen first", () => {
    const older = record({ clientId: "older", lastSeenAt: "2026-01-01T00:00:00.000Z" });
    const newer = record({ clientId: "newer", lastSeenAt: "2026-09-01T00:00:00.000Z" });
    const sorted = sortTrustedDevices([older, newer], "someone-else");
    expect(sorted.map((d) => d.clientId)).toEqual(["newer", "older"]);
  });

  it("never mutates the input array", () => {
    const input = [record({ clientId: "a" }), record({ clientId: "b" })];
    const original = [...input];
    sortTrustedDevices(input, "z");
    expect(input).toEqual(original);
  });
});

describe("formatLastSeen", () => {
  it("renders sub-minute gaps as Just now", () => {
    expect(formatLastSeen("2026-09-09T11:59:30.000Z", NOW)).toBe("Just now");
  });

  it("renders a small clock-skew future timestamp as Just now, not a negative duration", () => {
    expect(formatLastSeen("2026-09-09T12:00:05.000Z", NOW)).toBe("Just now");
  });

  it("renders minutes", () => {
    expect(formatLastSeen("2026-09-09T11:45:00.000Z", NOW)).toBe("15m ago");
  });

  it("renders hours", () => {
    expect(formatLastSeen("2026-09-09T09:00:00.000Z", NOW)).toBe("3h ago");
  });

  it("renders days", () => {
    expect(formatLastSeen("2026-09-05T12:00:00.000Z", NOW)).toBe("4d ago");
  });

  it("falls back to a locale date beyond 30 days", () => {
    const result = formatLastSeen("2026-01-01T12:00:00.000Z", NOW);
    expect(result).not.toMatch(/ago$/);
    expect(result).not.toBe("Unknown");
  });

  it("renders Unknown for an unparseable timestamp, never NaN or a throw", () => {
    expect(formatLastSeen("not-a-date", NOW)).toBe("Unknown");
    expect(formatLastSeen("", NOW)).toBe("Unknown");
  });
});
