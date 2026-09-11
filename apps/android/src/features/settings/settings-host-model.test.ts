import { describe, expect, it } from "vitest";

import {
  settingsHostAccessibilityLabel,
  settingsHostDetail,
  settingsHostStatus,
  settingsHostTitle,
  type SettingsHostProfileView,
} from "./settings-host-model";

function profile(overrides: Partial<SettingsHostProfileView> = {}): SettingsHostProfileView {
  return {
    label: "mbp-14",
    endpoint: "192.168.1.40:6768",
    kind: "direct",
    useTls: false,
    ...overrides,
  };
}

describe("settingsHostTitle (T366)", () => {
  it("is the name the reader gave the host", () => {
    expect(settingsHostTitle(profile())).toBe("mbp-14");
  });

  it("falls back to the address rather than an empty row", () => {
    expect(settingsHostTitle(profile({ label: "   " }))).toBe("192.168.1.40:6768");
  });

  it("says so plainly when nothing is saved", () => {
    expect(settingsHostTitle(null)).toBe("No host saved");
  });
});

describe("settingsHostDetail (T366)", () => {
  it("says where the daemon is and how it is reached", () => {
    expect(settingsHostDetail(profile())).toBe("192.168.1.40:6768 · direct · no TLS");
    expect(settingsHostDetail(profile({ useTls: true }))).toBe("192.168.1.40:6768 · direct · TLS");
  });

  it("marks a relay address as the relay's, not the daemon's", () => {
    // `HostProfileRecord.endpoint` is the RELAY's own host:port for a
    // relay profile; presenting it bare would read as the daemon's.
    expect(
      settingsHostDetail(profile({ kind: "relay", endpoint: "relay.example:443", useTls: true })),
    ).toBe("relay.example:443 · via relay · TLS");
  });

  it("invents no pairing date, because nothing stores one", () => {
    // The artifact's "· paired Tue" has no field behind it.
    for (const p of [profile(), profile({ kind: "relay" }), null]) {
      expect(settingsHostDetail(p)).not.toMatch(/paired/);
    }
  });

  it("tells an unconnected reader what to do instead of showing a blank", () => {
    expect(settingsHostDetail(null)).toBe("Connect to a daemon to see it here");
  });
});

describe("settingsHostStatus (T366)", () => {
  it("gives every phase a word, so the pill is never a bare colour", () => {
    const phases = ["idle", "connecting", "connected", "disconnected", "disposed"] as const;
    for (const phase of phases) {
      expect(settingsHostStatus(phase).label.length).toBeGreaterThan(0);
    }
  });

  it("reads a dropped socket as Offline, not as an error", () => {
    // A phone going through a tunnel is the ordinary case.
    expect(settingsHostStatus("disconnected")).toEqual({ label: "Offline", tone: "warning" });
    expect(settingsHostStatus("connected")).toEqual({ label: "Online", tone: "success" });
  });
});

describe("settingsHostAccessibilityLabel (T366)", () => {
  it("speaks the name, the state and the address as one stop", () => {
    expect(settingsHostAccessibilityLabel(profile(), "connected")).toBe(
      "mbp-14, Online, 192.168.1.40:6768 · direct · no TLS",
    );
  });

  it("carries the pill's word, which is the part most easily lost in a wrapper", () => {
    expect(settingsHostAccessibilityLabel(null, "idle")).toBe(
      "No host saved, Not connected, Connect to a daemon to see it here",
    );
  });
});
