import { describe, expect, it } from "vitest";

import {
  IDLE_REVOKE_DEVICE_STATE,
  beginConfirmedRevokeDevice,
  completeRevokeDevice,
  dismissRevokeRequest,
  failRevokeDevice,
  performRevokeDevice,
  requestRevokeDevice,
  type RevokeDeviceState,
} from "./revoke-device-model.js";
import {
  fetchTrustedDevices,
  type TrustedDeviceRecord,
  type TrustedDeviceRowSummary,
  type TrustedDevicesClient,
} from "./trusted-devices-model.js";

function summary(overrides: Partial<TrustedDeviceRowSummary> = {}): TrustedDeviceRowSummary {
  return {
    clientId: "clid_target_0001",
    isThisDevice: false,
    appVersionLabel: "1.2.3",
    lastSeenLabel: "5m ago",
    connected: true,
    ...overrides,
  };
}

describe("the confirmation state machine", () => {
  it("opens the dialog against the requested target and clears any prior error", () => {
    const dirty: RevokeDeviceState = {
      ...IDLE_REVOKE_DEVICE_STATE,
      error: { clientId: "clid_old", message: "boom" },
    };
    const next = requestRevokeDevice(dirty, summary());
    expect(next.target).toEqual(summary());
    expect(next.error).toBeNull();
  });

  it("dismissing clears the target and leaves everything else untouched", () => {
    const open = requestRevokeDevice(IDLE_REVOKE_DEVICE_STATE, summary());
    const dismissed = dismissRevokeRequest(open);
    expect(dismissed.target).toBeNull();
    expect(dismissed.phase).toBe("idle");
    expect(dismissed.pendingClientId).toBeNull();
  });

  it("dismissing an already-closed dialog is a no-op (identity-preserving)", () => {
    expect(dismissRevokeRequest(IDLE_REVOKE_DEVICE_STATE)).toBe(IDLE_REVOKE_DEVICE_STATE);
  });

  it("dismissRevokeRequest takes no client and no clientId — it cannot revoke anything by construction", () => {
    expect(dismissRevokeRequest.length).toBe(1);
  });

  it("confirming moves the target into pendingClientId and reports it to the caller", () => {
    const open = requestRevokeDevice(IDLE_REVOKE_DEVICE_STATE, summary());
    const begin = beginConfirmedRevokeDevice(open);
    expect(begin.clientId).toBe("clid_target_0001");
    expect(begin.state.target).toBeNull();
    expect(begin.state.phase).toBe("revoking");
    expect(begin.state.pendingClientId).toBe("clid_target_0001");
  });

  it("confirming with nothing open reports a null clientId and leaves state unchanged", () => {
    const begin = beginConfirmedRevokeDevice(IDLE_REVOKE_DEVICE_STATE);
    expect(begin.clientId).toBeNull();
    expect(begin.state).toBe(IDLE_REVOKE_DEVICE_STATE);
  });

  it("completing clears the pending marker for the matching clientId", () => {
    const begin = beginConfirmedRevokeDevice(
      requestRevokeDevice(IDLE_REVOKE_DEVICE_STATE, summary()),
    );
    const done = completeRevokeDevice(begin.state, "clid_target_0001");
    expect(done.phase).toBe("idle");
    expect(done.pendingClientId).toBeNull();
  });

  it("completing for a superseded/mismatched clientId is a no-op — a stale response can't clobber a newer attempt", () => {
    const begin = beginConfirmedRevokeDevice(
      requestRevokeDevice(IDLE_REVOKE_DEVICE_STATE, summary()),
    );
    const untouched = completeRevokeDevice(begin.state, "someone-elses-clientId");
    expect(untouched).toBe(begin.state);
  });

  it("failing records a device-scoped error and clears the pending marker", () => {
    const begin = beginConfirmedRevokeDevice(
      requestRevokeDevice(IDLE_REVOKE_DEVICE_STATE, summary()),
    );
    const failed = failRevokeDevice(begin.state, "clid_target_0001", "Device not found");
    expect(failed.phase).toBe("idle");
    expect(failed.pendingClientId).toBeNull();
    expect(failed.error).toEqual({ clientId: "clid_target_0001", message: "Device not found" });
  });

  it("failing for a superseded/mismatched clientId is a no-op", () => {
    const begin = beginConfirmedRevokeDevice(
      requestRevokeDevice(IDLE_REVOKE_DEVICE_STATE, summary()),
    );
    const untouched = failRevokeDevice(begin.state, "someone-elses-clientId", "irrelevant");
    expect(untouched).toBe(begin.state);
  });
});

describe("performRevokeDevice", () => {
  it("degrades to unavailable when the client has no revokeTrustedDevice — never throws", async () => {
    const client: TrustedDevicesClient = {};
    expect(await performRevokeDevice(client, "clid_x")).toEqual({
      status: "unavailable",
      error: null,
    });
  });

  it("degrades the same way for a null/undefined client", async () => {
    expect(await performRevokeDevice(null, "clid_x")).toEqual({
      status: "unavailable",
      error: null,
    });
    expect(await performRevokeDevice(undefined, "clid_x")).toEqual({
      status: "unavailable",
      error: null,
    });
  });

  it("resolves success when the daemon reports success:true", async () => {
    const client: TrustedDevicesClient = {
      revokeTrustedDevice: async (clientId) => ({
        requestId: "r1",
        clientId,
        success: true,
        error: null,
      }),
    };
    expect(await performRevokeDevice(client, "clid_x")).toEqual({
      status: "success",
      error: null,
    });
  });

  it("resolves a named error when the daemon reports success:false (e.g. 'Cannot revoke current device')", async () => {
    const client: TrustedDevicesClient = {
      revokeTrustedDevice: async (clientId) => ({
        requestId: "r1",
        clientId,
        success: false,
        error: "Cannot revoke current device",
      }),
    };
    expect(await performRevokeDevice(client, "clid_x")).toEqual({
      status: "error",
      error: "Cannot revoke current device",
    });
  });

  it("falls back to a named message when the daemon reports success:false with no error string", async () => {
    const client: TrustedDevicesClient = {
      revokeTrustedDevice: async (clientId) => ({
        requestId: "r1",
        clientId,
        success: false,
        error: null,
      }),
    };
    const outcome = await performRevokeDevice(client, "clid_x");
    expect(outcome.status).toBe("error");
    expect(outcome.error).toBeTruthy();
  });

  it("resolves an error, not a throw, when the client's call rejects", async () => {
    const client: TrustedDevicesClient = {
      revokeTrustedDevice: async () => {
        throw new Error("Not connected to a daemon");
      },
    };
    expect(await performRevokeDevice(client, "clid_x")).toEqual({
      status: "error",
      error: "Not connected to a daemon",
    });
  });

  it("stringifies a non-Error throw rather than crashing", async () => {
    const client: TrustedDevicesClient = {
      revokeTrustedDevice: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "wire failure";
      },
    };
    const outcome = await performRevokeDevice(client, "clid_x");
    expect(outcome.status).toBe("error");
    expect(outcome.error).toBe("wire failure");
  });
});

describe("the client-reachable round trip: revoke then re-list", () => {
  /**
   * A fake that behaves like the real daemon's in-memory device map
   * (`packages/server/src/server/websocket-server.ts`'s
   * `externalSessionsByKey`, mutated by `handleTrustedDeviceRevokeRequest`)
   * — enough to prove the CLIENT-reachable half of "revoking a device
   * removes it": a revoked device stops appearing in a subsequent
   * `listTrustedDevices` call. This fake does NOT, and cannot honestly,
   * model push-token delivery — see `revoke-device-model.ts`'s header
   * "One disclosed gap" section (`CORRECTED (T299)`) for why that half
   * was, and in one residual case still is, outside what this package
   * can prove or fake around.
   */
  function createFakeDaemon(initial: TrustedDeviceRecord[]): TrustedDevicesClient {
    let devices = [...initial];
    return {
      listTrustedDevices: async () => ({ requestId: "list", devices }),
      revokeTrustedDevice: async (clientId) => {
        const existed = devices.some((device) => device.clientId === clientId);
        devices = devices.filter((device) => device.clientId !== clientId);
        return {
          requestId: "revoke",
          clientId,
          success: existed,
          error: existed ? null : "Device not found",
        };
      },
    };
  }

  it("a successful revoke removes the device from the very next fetch", async () => {
    const client = createFakeDaemon([
      {
        clientId: "clid_keep",
        appVersion: "1.0",
        lastSeenAt: "2026-09-09T11:00:00.000Z",
        connected: true,
      },
      {
        clientId: "clid_target_0001",
        appVersion: "1.0",
        lastSeenAt: "2026-09-09T11:00:00.000Z",
        connected: true,
      },
    ]);

    const before = await fetchTrustedDevices(client);
    expect(before.devices.map((device) => device.clientId)).toEqual([
      "clid_keep",
      "clid_target_0001",
    ]);

    const outcome = await performRevokeDevice(client, "clid_target_0001");
    expect(outcome).toEqual({ status: "success", error: null });

    const after = await fetchTrustedDevices(client);
    expect(after.devices.map((device) => device.clientId)).toEqual(["clid_keep"]);
  });

  it("revoking a clientId that is no longer present resolves a named error, not a throw", async () => {
    const client = createFakeDaemon([]);
    const outcome = await performRevokeDevice(client, "clid_ghost");
    expect(outcome).toEqual({ status: "error", error: "Device not found" });
  });
});
