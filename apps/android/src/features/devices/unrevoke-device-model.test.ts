import { describe, expect, it } from "vitest";

import type { TrustedDevicesClient } from "./trusted-devices-model.js";
import {
  beginUnrevokeDevice,
  completeUnrevokeDevice,
  failUnrevokeDevice,
  forgetRevokedDevice,
  IDLE_UNREVOKE_DEVICE_STATE,
  performUnrevokeDevice,
  rememberRevokedDevice,
  type UnrevokeDeviceState,
} from "./unrevoke-device-model.js";

describe("rememberRevokedDevice / forgetRevokedDevice", () => {
  it("remembers a revoked clientId for the Recently revoked section", () => {
    const next = rememberRevokedDevice(IDLE_UNREVOKE_DEVICE_STATE, "clid_target_0001");
    expect(next.revokedClientIds).toEqual(["clid_target_0001"]);
  });

  it("trims the clientId it remembers", () => {
    const next = rememberRevokedDevice(IDLE_UNREVOKE_DEVICE_STATE, "  clid_target_0001  ");
    expect(next.revokedClientIds).toEqual(["clid_target_0001"]);
  });

  it("never duplicates a clientId revoked twice", () => {
    const once = rememberRevokedDevice(IDLE_UNREVOKE_DEVICE_STATE, "clid_target_0001");
    const twice = rememberRevokedDevice(once, "clid_target_0001");
    expect(twice.revokedClientIds).toEqual(["clid_target_0001"]);
    expect(twice).toBe(once);
  });

  it("ignoring a blank clientId is a no-op (identity-preserving)", () => {
    expect(rememberRevokedDevice(IDLE_UNREVOKE_DEVICE_STATE, "   ")).toBe(
      IDLE_UNREVOKE_DEVICE_STATE,
    );
  });

  it("remembering leaves phase, pending marker, and error untouched", () => {
    const dirty: UnrevokeDeviceState = {
      ...IDLE_UNREVOKE_DEVICE_STATE,
      error: { clientId: "clid_old", message: "boom" },
    };
    const next = rememberRevokedDevice(dirty, "clid_new");
    expect(next.error).toEqual({ clientId: "clid_old", message: "boom" });
    expect(next.phase).toBe("idle");
    expect(next.pendingClientId).toBeNull();
  });

  it("forgetting removes exactly the named clientId", () => {
    const state: UnrevokeDeviceState = {
      ...IDLE_UNREVOKE_DEVICE_STATE,
      revokedClientIds: ["clid_a", "clid_b"],
    };
    const next = forgetRevokedDevice(state, "clid_a");
    expect(next.revokedClientIds).toEqual(["clid_b"]);
  });

  it("forgetting an unremembered clientId is a no-op (identity-preserving)", () => {
    expect(forgetRevokedDevice(IDLE_UNREVOKE_DEVICE_STATE, "clid_ghost")).toBe(
      IDLE_UNREVOKE_DEVICE_STATE,
    );
  });
});

describe("beginUnrevokeDevice", () => {
  it("marks the clientId pending and clears any prior error", () => {
    const dirty: UnrevokeDeviceState = {
      ...IDLE_UNREVOKE_DEVICE_STATE,
      error: { clientId: "clid_old", message: "boom" },
    };
    const begin = beginUnrevokeDevice(dirty, "clid_target_0001");
    expect(begin.clientId).toBe("clid_target_0001");
    expect(begin.state.phase).toBe("unrevoking");
    expect(begin.state.pendingClientId).toBe("clid_target_0001");
    expect(begin.state.error).toBeNull();
  });

  it("trims the clientId it reports and pends", () => {
    const begin = beginUnrevokeDevice(IDLE_UNREVOKE_DEVICE_STATE, "  clid_target_0001  ");
    expect(begin.clientId).toBe("clid_target_0001");
    expect(begin.state.pendingClientId).toBe("clid_target_0001");
  });

  it("a blank clientId reports null and leaves state unchanged", () => {
    const begin = beginUnrevokeDevice(IDLE_UNREVOKE_DEVICE_STATE, "   ");
    expect(begin.clientId).toBeNull();
    expect(begin.state).toBe(IDLE_UNREVOKE_DEVICE_STATE);
  });

  it("refuses a second attempt while one is already pending", () => {
    const first = beginUnrevokeDevice(IDLE_UNREVOKE_DEVICE_STATE, "clid_a");
    const second = beginUnrevokeDevice(first.state, "clid_b");
    expect(second.clientId).toBeNull();
    expect(second.state).toBe(first.state);
  });
});

describe("completeUnrevokeDevice", () => {
  it("clears the pending marker and forgets the un-revoked clientId", () => {
    const remembered = rememberRevokedDevice(IDLE_UNREVOKE_DEVICE_STATE, "clid_target_0001");
    const begin = beginUnrevokeDevice(remembered, "clid_target_0001");
    const done = completeUnrevokeDevice(begin.state, "clid_target_0001");
    expect(done.phase).toBe("idle");
    expect(done.pendingClientId).toBeNull();
    expect(done.revokedClientIds).toEqual([]);
  });

  it("keeps every other remembered clientId", () => {
    let state = rememberRevokedDevice(IDLE_UNREVOKE_DEVICE_STATE, "clid_a");
    state = rememberRevokedDevice(state, "clid_b");
    const begin = beginUnrevokeDevice(state, "clid_a");
    const done = completeUnrevokeDevice(begin.state, "clid_a");
    expect(done.revokedClientIds).toEqual(["clid_b"]);
  });

  it("completing for a superseded/mismatched clientId is a no-op — a stale response can't clobber a newer attempt", () => {
    const begin = beginUnrevokeDevice(
      rememberRevokedDevice(IDLE_UNREVOKE_DEVICE_STATE, "clid_a"),
      "clid_a",
    );
    const untouched = completeUnrevokeDevice(begin.state, "someone-elses-clientId");
    expect(untouched).toBe(begin.state);
  });
});

describe("failUnrevokeDevice", () => {
  it("records a device-scoped error, clears pending, and keeps the row present for retry", () => {
    const begin = beginUnrevokeDevice(
      rememberRevokedDevice(IDLE_UNREVOKE_DEVICE_STATE, "clid_target_0001"),
      "clid_target_0001",
    );
    const failed = failUnrevokeDevice(begin.state, "clid_target_0001", "Invalid clientId");
    expect(failed.phase).toBe("idle");
    expect(failed.pendingClientId).toBeNull();
    expect(failed.error).toEqual({ clientId: "clid_target_0001", message: "Invalid clientId" });
    expect(failed.revokedClientIds).toEqual(["clid_target_0001"]);
  });

  it("failing for a superseded/mismatched clientId is a no-op", () => {
    const begin = beginUnrevokeDevice(
      rememberRevokedDevice(IDLE_UNREVOKE_DEVICE_STATE, "clid_a"),
      "clid_a",
    );
    const untouched = failUnrevokeDevice(begin.state, "someone-elses-clientId", "irrelevant");
    expect(untouched).toBe(begin.state);
  });
});

describe("performUnrevokeDevice", () => {
  it("degrades to unavailable when the client has no unrevokeTrustedDevice — never throws", async () => {
    const client: TrustedDevicesClient = {};
    expect(await performUnrevokeDevice(client, "clid_x")).toEqual({
      status: "unavailable",
      error: null,
    });
  });

  it("degrades the same way for a null/undefined client", async () => {
    expect(await performUnrevokeDevice(null, "clid_x")).toEqual({
      status: "unavailable",
      error: null,
    });
    expect(await performUnrevokeDevice(undefined, "clid_x")).toEqual({
      status: "unavailable",
      error: null,
    });
  });

  it("resolves success when the daemon reports success:true", async () => {
    const client: TrustedDevicesClient = {
      unrevokeTrustedDevice: async (clientId) => ({
        requestId: "r1",
        clientId,
        success: true,
        error: null,
      }),
    };
    expect(await performUnrevokeDevice(client, "clid_x")).toEqual({
      status: "success",
      error: null,
    });
  });

  it("resolves a named error when the daemon reports success:false", async () => {
    const client: TrustedDevicesClient = {
      unrevokeTrustedDevice: async (clientId) => ({
        requestId: "r1",
        clientId,
        success: false,
        error: "Invalid clientId",
      }),
    };
    expect(await performUnrevokeDevice(client, "clid_x")).toEqual({
      status: "error",
      error: "Invalid clientId",
    });
  });

  it("falls back to a named message when the daemon reports success:false with no error string", async () => {
    const client: TrustedDevicesClient = {
      unrevokeTrustedDevice: async (clientId) => ({
        requestId: "r1",
        clientId,
        success: false,
        error: null,
      }),
    };
    const outcome = await performUnrevokeDevice(client, "clid_x");
    expect(outcome.status).toBe("error");
    expect(outcome.error).toBeTruthy();
  });

  it("resolves an error, not a throw, when the client's call rejects", async () => {
    const client: TrustedDevicesClient = {
      unrevokeTrustedDevice: async () => {
        throw new Error("Not connected to a daemon");
      },
    };
    expect(await performUnrevokeDevice(client, "clid_x")).toEqual({
      status: "error",
      error: "Not connected to a daemon",
    });
  });

  it("stringifies a non-Error throw rather than crashing", async () => {
    const client: TrustedDevicesClient = {
      unrevokeTrustedDevice: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "wire failure";
      },
    };
    const outcome = await performUnrevokeDevice(client, "clid_x");
    expect(outcome.status).toBe("error");
    expect(outcome.error).toBe("wire failure");
  });
});

describe("the client-reachable round trip: revoke, remember, un-revoke", () => {
  /**
   * A fake that behaves like the real daemon's denylist
   * (`packages/server/src/server/devices/revoked-device-store.ts`,
   * written by `handleTrustedDeviceRevokeRequest` and cleared by
   * `handleTrustedDeviceUnrevokeRequest`) as seen through this client's
   * two methods — enough to prove the CLIENT-reachable half of "a revoked
   * device can come back": un-revoking a remembered `clientId` succeeds
   * and drops it from the remembered list.
   */
  function createFakeDaemon(): TrustedDevicesClient & { isRevoked(clientId: string): boolean } {
    const revoked = new Set<string>();
    return {
      isRevoked: (clientId) => revoked.has(clientId),
      revokeTrustedDevice: async (clientId) => {
        revoked.add(clientId);
        return { requestId: "revoke", clientId, success: true, error: null };
      },
      unrevokeTrustedDevice: async (clientId) => {
        revoked.delete(clientId);
        return { requestId: "unrevoke", clientId, success: true, error: null };
      },
    };
  }

  it("a revoke followed by an un-revoke clears both the daemon denylist and the remembered row", async () => {
    const client = createFakeDaemon();

    await client.revokeTrustedDevice!("clid_target_0001");
    expect(client.isRevoked("clid_target_0001")).toBe(true);
    let state = rememberRevokedDevice(IDLE_UNREVOKE_DEVICE_STATE, "clid_target_0001");

    const begin = beginUnrevokeDevice(state, "clid_target_0001");
    expect(begin.clientId).toBe("clid_target_0001");
    const outcome = await performUnrevokeDevice(client, begin.clientId!);
    expect(outcome).toEqual({ status: "success", error: null });

    state = completeUnrevokeDevice(begin.state, "clid_target_0001");
    expect(client.isRevoked("clid_target_0001")).toBe(false);
    expect(state.revokedClientIds).toEqual([]);
  });
});
