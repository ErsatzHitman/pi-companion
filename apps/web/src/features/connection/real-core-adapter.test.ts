import { describe, expect, it } from "vitest";

import type { hosts } from "@picompanion/frontend-core";

import { createRealCoreAdapter, toDaemonConnectionState } from "./real-core-adapter.js";

function info(
  status: hosts.HostControllerConnectionStatus,
  profileId: string | null = null,
): hosts.HostControllerConnectionInfo {
  return { status, profileId, kind: null };
}

describe("toDaemonConnectionState", () => {
  it("reads connected only for a live connection", () => {
    expect(toDaemonConnectionState("connected")).toBe("connected");
  });

  it("reads the in-flight statuses as connecting", () => {
    expect(toDaemonConnectionState("connecting")).toBe("connecting");
    expect(toDaemonConnectionState("probing")).toBe("connecting");
    expect(toDaemonConnectionState("reconnect-pending")).toBe("connecting");
  });

  it("reads every no-live-client status as disconnected", () => {
    expect(toDaemonConnectionState("idle")).toBe("disconnected");
    expect(toDaemonConnectionState("disconnected")).toBe("disconnected");
    expect(toDaemonConnectionState("disposed")).toBe("disconnected");
    expect(toDaemonConnectionState("offline")).toBe("disconnected");
  });
});

describe("createRealCoreAdapter", () => {
  it("starts disconnected before any snapshot is published", () => {
    const adapter = createRealCoreAdapter({ now: () => 1_000 });
    expect(adapter.getConnectionSnapshot()).toMatchObject({
      state: "disconnected",
      serverId: null,
      label: null,
    });
    adapter.dispose();
  });

  it("publishes the live snapshot and notifies subscribers", () => {
    const adapter = createRealCoreAdapter({ now: () => 1_000 });
    let notifications = 0;
    const unsubscribe = adapter.subscribeConnection(() => {
      notifications += 1;
    });

    adapter.publishHostConnection(info("connecting", "profile-1"), "My Mac");
    expect(adapter.getConnectionSnapshot()).toMatchObject({
      state: "connecting",
      serverId: "profile-1",
      label: "My Mac",
    });
    expect(notifications).toBe(1);

    adapter.publishHostConnection(info("connected", "profile-1"), "My Mac");
    expect(adapter.getConnectionSnapshot().state).toBe("connected");
    expect(notifications).toBe(2);
    unsubscribe();
    adapter.dispose();
  });

  it("skips notifying when a republish changes nothing", () => {
    const adapter = createRealCoreAdapter({ now: () => 1_000 });
    adapter.publishHostConnection(info("connected", "profile-1"), "My Mac");

    let notifications = 0;
    adapter.subscribeConnection(() => {
      notifications += 1;
    });
    adapter.publishHostConnection(info("connected", "profile-1"), "My Mac");
    expect(notifications).toBe(0);
    adapter.dispose();
  });

  it("stops notifying after dispose", () => {
    const adapter = createRealCoreAdapter({ now: () => 1_000 });
    let notifications = 0;
    adapter.subscribeConnection(() => {
      notifications += 1;
    });
    adapter.dispose();
    adapter.publishHostConnection(info("connected", "profile-1"), "My Mac");
    expect(notifications).toBe(0);
  });
});
