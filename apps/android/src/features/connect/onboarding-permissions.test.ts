import { describe, expect, it } from "vitest";

import {
  describePermissionRecovery,
  type OnboardingPermissionsPort,
} from "./onboarding-permissions.js";

/**
 * T60D unification: this module no longer declares its own copy table
 * or five-state union — `describeCameraPermissionRecovery`/
 * `OnboardingPermissionStatus`/`ALL_ONBOARDING_PERMISSION_STATUSES` are
 * gone, and every case those tests used to cover is now proved once,
 * over every `PermissionKind` including `"camera"`, by
 * `../composer/permission-recovery.test.ts`. What is left to prove
 * here is narrower and connect-specific:
 *   1. `describePermissionRecovery("camera", state)` still gives every
 *      state a named, non-empty recovery and still routes
 *      `"denied-permanently"` to `"open-settings"` — re-asserted here,
 *      not just trusted from the composer suite, because this is the
 *      call site this task's acceptance criteria name directly.
 *   2. `OnboardingPermissionsPort` is a real structural superset of
 *      composer's `PermissionPort` (`getPermissionStatus`/
 *      `requestPermission`) plus `openAppSettings` — a fake missing
 *      either shared method fails to typecheck as this interface.
 */
describe('describePermissionRecovery("camera", state) — the onboarding call site', () => {
  const STATES = [
    "undetermined",
    "granted",
    "denied",
    "denied-permanently",
    "unavailable",
  ] as const;

  it("gives every possible camera state a non-empty, named recovery — no state has no exit", () => {
    for (const state of STATES) {
      const recovery = describePermissionRecovery("camera", state);
      expect(recovery.title.length).toBeGreaterThan(0);
      expect(recovery.message.length).toBeGreaterThan(0);
      expect(recovery.actionLabel.length).toBeGreaterThan(0);
      expect(["request", "open-settings", "dismiss"]).toContain(recovery.action);
    }
  });

  it("'denied' (denied once) offers to ask again, not settings", () => {
    expect(describePermissionRecovery("camera", "denied").action).toBe("request");
  });

  it("'denied-permanently' (never ask again) routes to system settings, not a re-prompt", () => {
    expect(describePermissionRecovery("camera", "denied-permanently").action).toBe("open-settings");
  });

  it("'denied' and 'denied-permanently' carry distinct copy", () => {
    const deniedOnce = describePermissionRecovery("camera", "denied").message;
    const deniedForever = describePermissionRecovery("camera", "denied-permanently").message;
    expect(deniedOnce).not.toBe(deniedForever);
  });

  it("only 'denied-permanently' ever routes to open-settings — every other state has a different exit", () => {
    for (const state of STATES) {
      if (state === "denied-permanently") continue;
      expect(describePermissionRecovery("camera", state).action).not.toBe("open-settings");
    }
  });

  it("granted needs no action beyond dismiss", () => {
    expect(describePermissionRecovery("camera", "granted").action).toBe("dismiss");
  });

  it("unavailable (no camera module installed) explains the app-level fact, distinct from a user denial", () => {
    const unavailable = describePermissionRecovery("camera", "unavailable").message;
    const denied = describePermissionRecovery("camera", "denied").message;
    expect(unavailable).not.toBe(denied);
  });
});

describe("OnboardingPermissionsPort — structurally composer's PermissionPort plus openAppSettings", () => {
  it("a fake implementing all three methods satisfies the type", () => {
    const calls: string[] = [];
    const port: OnboardingPermissionsPort = {
      async getPermissionStatus() {
        calls.push("getPermissionStatus");
        return "undetermined";
      },
      async requestPermission() {
        calls.push("requestPermission");
        return "granted";
      },
      async openAppSettings() {
        calls.push("openAppSettings");
      },
    };

    return Promise.all([
      port.getPermissionStatus(),
      port.requestPermission(),
      port.openAppSettings(),
    ]).then(() => {
      expect(calls).toEqual(["getPermissionStatus", "requestPermission", "openAppSettings"]);
    });
  });
});
