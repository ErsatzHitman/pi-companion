import { describe, expect, it } from "vitest";

import type { PermissionState } from "../composer/permission-recovery.js";
import {
  UNREAD_DEVICE_PUSH_STATUS,
  describeDevicePushStatus,
  type DevicePushStatusSnapshot,
} from "./device-push-status-model.js";

const ALL_PERMISSION_STATES: readonly PermissionState[] = [
  "undetermined",
  "granted",
  "denied",
  "denied-permanently",
  "unavailable",
];

function snapshot(overrides: Partial<DevicePushStatusSnapshot> = {}): DevicePushStatusSnapshot {
  return { permissionStatus: "granted", registered: false, ...overrides };
}

describe("UNREAD_DEVICE_PUSH_STATUS", () => {
  it("starts with no permission read and not registered", () => {
    expect(UNREAD_DEVICE_PUSH_STATUS).toEqual({ permissionStatus: null, registered: false });
  });
});

describe("describeDevicePushStatus", () => {
  it("reports registered when a token is registered, regardless of permission state", () => {
    for (const permissionStatus of ALL_PERMISSION_STATES) {
      expect(describeDevicePushStatus(snapshot({ permissionStatus, registered: true }))).toBe(
        "This device is registered to receive push notifications.",
      );
    }
  });

  it("reports checking while the permission read has not resolved yet", () => {
    expect(describeDevicePushStatus(snapshot({ permissionStatus: null, registered: false }))).toBe(
      "Checking push notification status…",
    );
  });

  it("distinguishes every unregistered permission state with its own honest sentence", () => {
    const seen = new Set<string>();
    for (const permissionStatus of ALL_PERMISSION_STATES) {
      const text = describeDevicePushStatus(snapshot({ permissionStatus, registered: false }));
      expect(text.length).toBeGreaterThan(0);
      expect(seen.has(text)).toBe(false);
      seen.add(text);
    }
  });

  it("never claims registration for a granted-but-unregistered device", () => {
    const text = describeDevicePushStatus(
      snapshot({ permissionStatus: "granted", registered: false }),
    );
    expect(text).not.toMatch(/^This device is registered/);
  });

  it("tells a permanently-denied user the real recovery path (system settings), not a re-ask", () => {
    const text = describeDevicePushStatus(
      snapshot({ permissionStatus: "denied-permanently", registered: false }),
    );
    expect(text).toMatch(/system settings/i);
  });

  it("names the build limitation honestly for the unavailable state, never pretending push works", () => {
    const text = describeDevicePushStatus(
      snapshot({ permissionStatus: "unavailable", registered: false }),
    );
    expect(text).toMatch(/not available on this build/);
  });

  it("never mentions a secret or credential (mentioning the WORD 'token' in prose like 'has not registered a push token yet' is fine — it is the VALUE that must never appear, and this snapshot never carries one)", () => {
    for (const permissionStatus of ALL_PERMISSION_STATES) {
      for (const registered of [true, false]) {
        const text = describeDevicePushStatus(snapshot({ permissionStatus, registered }));
        expect(text.toLowerCase()).not.toMatch(/secret|credential/);
      }
    }
  });
});
