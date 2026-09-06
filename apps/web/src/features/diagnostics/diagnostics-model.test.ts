import { describe, expect, it } from "vitest";

import type { hosts } from "@picompanion/frontend-core";
import type { ServerInfoStatusPayload } from "@picompanion/protocol/messages";

import {
  NOT_CONNECTED,
  NO_SERVER_INFO_YET,
  buildDiagnosticsSnapshot,
  type DiagnosticsModelInput,
  type DiagnosticsSection,
} from "./diagnostics-model.js";

const IDLE_INFO: hosts.HostControllerConnectionInfo = {
  status: "idle",
  profileId: null,
  kind: null,
};

function field(sections: DiagnosticsSection[], sectionId: string, fieldId: string): string {
  const section = sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new Error(`missing section ${sectionId}`);
  const found = section.fields.find((candidate) => candidate.id === fieldId);
  if (!found) throw new Error(`missing field ${sectionId}/${fieldId}`);
  return found.value;
}

const BASE_INPUT: DiagnosticsModelInput = {
  appVersion: "0.3.0-beta.2",
  clientId: "picompanion-web",
  connectionInfo: IDLE_INFO,
  profile: null,
  serverInfo: null,
};

describe("buildDiagnosticsSnapshot — disconnected state (T41B1 acceptance: 'the screen works while disconnected')", () => {
  const sections = buildDiagnosticsSnapshot(BASE_INPUT);

  it("returns exactly the connection/versions/capabilities sections, every one non-empty", () => {
    expect(sections.map((section) => section.id)).toEqual([
      "connection",
      "versions",
      "capabilities",
    ]);
    for (const section of sections) {
      expect(section.fields.length).toBeGreaterThan(0);
      for (const value of section.fields.map((f) => f.value)) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it("reports connection status truthfully as idle, not a fabricated 'connected'", () => {
    expect(field(sections, "connection", "status")).toBe("idle");
  });

  it("reports the connection path as not established", () => {
    expect(field(sections, "connection", "kind")).toBe("Not established");
  });

  it("reports no host profile selected", () => {
    expect(field(sections, "connection", "profile")).toBe("None selected");
  });

  it("reports the endpoint as not connected, never a placeholder address", () => {
    expect(field(sections, "connection", "endpoint")).toBe(NOT_CONNECTED);
  });

  it("still shows the real client id this app declares, even disconnected", () => {
    expect(field(sections, "connection", "client-id")).toBe("picompanion-web");
  });

  it("still shows the real app protocol version, even disconnected", () => {
    expect(field(sections, "versions", "app-version")).toBe("0.3.0-beta.2");
  });

  it("reports every daemon-sourced version field as truthfully unknown, not blank or fabricated", () => {
    expect(field(sections, "versions", "daemon-version")).toBe(NO_SERVER_INFO_YET);
    expect(field(sections, "versions", "server-id")).toBe(NO_SERVER_INFO_YET);
    expect(field(sections, "versions", "hostname")).toBe(NO_SERVER_INFO_YET);
    expect(field(sections, "versions", "desktop-managed")).toBe(NO_SERVER_INFO_YET);
  });

  it("reports capabilities as unavailable, not an empty or fabricated list", () => {
    expect(field(sections, "capabilities", "capabilities-unavailable")).toBe(NO_SERVER_INFO_YET);
  });
});

describe("buildDiagnosticsSnapshot — a profile is chosen but no connection kind has been established yet", () => {
  it("still reports the endpoint as not connected (kind is what selects direct vs relay)", () => {
    const profile: hosts.HostProfile = {
      id: "profile-1",
      label: "My laptop",
      direct: { endpoint: "localhost:6767", useTls: false },
      preferDirect: true,
      createdAt: 0,
      updatedAt: 0,
      lastConnectedAt: null,
      lastConnectionKind: null,
    };
    const sections = buildDiagnosticsSnapshot({
      ...BASE_INPUT,
      connectionInfo: { status: "connecting", profileId: "profile-1", kind: null },
      profile,
    });
    expect(field(sections, "connection", "status")).toBe("connecting");
    expect(field(sections, "connection", "profile")).toBe("My laptop");
    expect(field(sections, "connection", "endpoint")).toBe(NOT_CONNECTED);
  });
});

describe("buildDiagnosticsSnapshot — fully negotiated connection", () => {
  const profile: hosts.HostProfile = {
    id: "profile-1",
    label: "My laptop",
    direct: { endpoint: "localhost:6767", useTls: false },
    preferDirect: true,
    createdAt: 0,
    updatedAt: 0,
    lastConnectedAt: 1000,
    lastConnectionKind: "direct",
  };

  const serverInfo: ServerInfoStatusPayload = {
    status: "server_info",
    serverId: "server-abc",
    hostname: "laptop.local",
    version: "0.3.0-beta.2",
    desktopManaged: true,
    capabilities: {
      voice: {
        dictation: { enabled: true, reason: "microphone permission granted" },
        voice: { enabled: false, reason: "no audio device" },
      },
    },
    features: {
      relayConfig: true,
      daemonStatusRpc: false,
    },
  } as ServerInfoStatusPayload;

  const sections = buildDiagnosticsSnapshot({
    appVersion: "0.3.0-beta.2",
    clientId: "picompanion-web",
    connectionInfo: { status: "connected", profileId: "profile-1", kind: "direct" },
    profile,
    serverInfo,
  });

  it("reports the real connection status, path and endpoint in use", () => {
    expect(field(sections, "connection", "status")).toBe("connected");
    expect(field(sections, "connection", "kind")).toBe("Direct");
    expect(field(sections, "connection", "profile")).toBe("My laptop");
    expect(field(sections, "connection", "endpoint")).toBe("localhost:6767");
  });

  it("reports the daemon's real version, server id, hostname and desktop-managed flag", () => {
    expect(field(sections, "versions", "daemon-version")).toBe("0.3.0-beta.2");
    expect(field(sections, "versions", "server-id")).toBe("server-abc");
    expect(field(sections, "versions", "hostname")).toBe("laptop.local");
    expect(field(sections, "versions", "desktop-managed")).toBe("true");
  });

  it("lists every advertised feature flag, sorted, with its real value", () => {
    const capabilities = sections.find((section) => section.id === "capabilities");
    expect(capabilities).toBeDefined();
    const featureFields = capabilities!.fields.filter((f) => f.id.startsWith("feature-"));
    expect(featureFields.map((f) => f.id)).toEqual([
      "feature-daemonStatusRpc",
      "feature-relayConfig",
    ]);
    expect(field(sections, "capabilities", "feature-relayConfig")).toBe("Enabled");
    expect(field(sections, "capabilities", "feature-daemonStatusRpc")).toBe("Disabled");
  });

  it("reports the real advertised voice capability state, including the daemon's stated reason", () => {
    expect(field(sections, "capabilities", "voice-dictation")).toBe(
      "Enabled — microphone permission granted",
    );
    expect(field(sections, "capabilities", "voice-capture")).toBe("Disabled — no audio device");
  });
});

describe("buildDiagnosticsSnapshot — negotiated but the daemon advertised no feature flags at all", () => {
  it("says so explicitly rather than rendering an empty capabilities section", () => {
    const serverInfo: ServerInfoStatusPayload = {
      status: "server_info",
      serverId: "server-abc",
    } as ServerInfoStatusPayload;
    const sections = buildDiagnosticsSnapshot({ ...BASE_INPUT, serverInfo });
    expect(field(sections, "capabilities", "features-none")).toBe("None advertised");
    expect(field(sections, "capabilities", "voice-dictation")).toBe("Not advertised");
    expect(field(sections, "capabilities", "voice-capture")).toBe("Not advertised");
  });
});
