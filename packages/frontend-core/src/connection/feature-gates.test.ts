import { describe, expect, it } from "vitest";
import type { ServerInfoStatusPayload } from "@picompanion/protocol/messages";
import {
  EMPTY_FEATURE_GATE_SNAPSHOT,
  deriveFeatureGateSnapshot,
  isFeatureEnabled,
} from "./feature-gates.js";

function makeServerInfo(overrides: Partial<ServerInfoStatusPayload> = {}): ServerInfoStatusPayload {
  return {
    status: "server_info",
    serverId: "srv_test_0001",
    hostname: "test-daemon",
    version: "0.0.0-test",
    desktopManaged: true,
    capabilities: { voice: { enabled: false, reason: "no provider" } },
    features: { rewind: true, agentDetach: false },
    ...overrides,
  };
}

describe("EMPTY_FEATURE_GATE_SNAPSHOT", () => {
  it("is not negotiated and is frozen", () => {
    expect(EMPTY_FEATURE_GATE_SNAPSHOT.negotiated).toBe(false);
    expect(EMPTY_FEATURE_GATE_SNAPSHOT.serverId).toBeNull();
    expect(Object.isFrozen(EMPTY_FEATURE_GATE_SNAPSHOT)).toBe(true);
    expect(Object.isFrozen(EMPTY_FEATURE_GATE_SNAPSHOT.features)).toBe(true);
  });

  it("treats every feature as disabled before negotiation", () => {
    expect(isFeatureEnabled(EMPTY_FEATURE_GATE_SNAPSHOT, "rewind")).toBe(false);
  });
});

describe("deriveFeatureGateSnapshot", () => {
  it("copies identity fields and defaults optional ones", () => {
    const snapshot = deriveFeatureGateSnapshot(
      makeServerInfo({ hostname: undefined, version: undefined, desktopManaged: undefined }),
    );
    expect(snapshot.negotiated).toBe(true);
    expect(snapshot.serverId).toBe("srv_test_0001");
    expect(snapshot.hostname).toBeNull();
    expect(snapshot.version).toBeNull();
    expect(snapshot.desktopManaged).toBe(false);
  });

  it("preserves hostname/version/desktopManaged when present", () => {
    const snapshot = deriveFeatureGateSnapshot(makeServerInfo());
    expect(snapshot.hostname).toBe("test-daemon");
    expect(snapshot.version).toBe("0.0.0-test");
    expect(snapshot.desktopManaged).toBe(true);
    expect(snapshot.capabilities?.voice?.enabled).toBe(false);
  });

  it("returns a frozen, independent copy of the features map", () => {
    const serverInfo = makeServerInfo();
    const snapshot = deriveFeatureGateSnapshot(serverInfo);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.features)).toBe(true);
    expect(snapshot.features).not.toBe(serverInfo.features);
    // Mutating the source payload afterward must not affect the snapshot.
    if (serverInfo.features) {
      serverInfo.features.rewind = false;
    }
    expect(snapshot.features.rewind).toBe(true);
  });

  it("handles a server_info with no features object at all", () => {
    const snapshot = deriveFeatureGateSnapshot(makeServerInfo({ features: undefined }));
    expect(snapshot.negotiated).toBe(true);
    expect(snapshot.features).toEqual({});
    expect(isFeatureEnabled(snapshot, "rewind")).toBe(false);
  });
});

describe("isFeatureEnabled", () => {
  it("is true only when the daemon explicitly advertised true", () => {
    const snapshot = deriveFeatureGateSnapshot(makeServerInfo());
    expect(isFeatureEnabled(snapshot, "rewind")).toBe(true);
  });

  it("is false when the daemon explicitly advertised false", () => {
    const snapshot = deriveFeatureGateSnapshot(makeServerInfo());
    expect(isFeatureEnabled(snapshot, "agentDetach")).toBe(false);
  });

  it("is false when the daemon never mentioned the feature at all", () => {
    const snapshot = deriveFeatureGateSnapshot(makeServerInfo());
    expect(isFeatureEnabled(snapshot, "daemonSelfUpdate")).toBe(false);
  });
});
