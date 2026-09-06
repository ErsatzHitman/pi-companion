/**
 * T36A — notification-permission port tests, plan.md §9.3.
 *
 * `describePermissionRecovery("notifications", state)` copy coverage
 * (every `PermissionState` resolves to a non-empty, distinct
 * explanation with a named exit action; `"denied"` and
 * `"denied-permanently"` never share an action) now lives in
 * `../composer/permission-recovery.test.ts`, which already asserts it
 * over the full `PermissionKind` x `PermissionState` matrix —
 * `"notifications"` included. Restating that coverage here would be
 * exactly the duplication T60F deleted (see this directory's
 * `notification-permission-recovery.ts` header).
 *
 * What this file still proves, because it is this module's own
 * behaviour and composer's test suite has no reason to cover it:
 * `resolvePermission` (re-exported, not reimplemented) correctly drives
 * a `NotificationPermissionPort` — the port shape this feature's own
 * code constructs.
 */
import { describe, expect, it } from "vitest";

import {
  resolvePermission,
  type NotificationPermissionPort,
} from "./notification-permission-recovery";
import { describePermissionRecovery } from "../composer/permission-recovery";

describe("describePermissionRecovery('notifications', state) (imported, not reimplemented)", () => {
  it("is reachable for the notifications kind and denied still names a retry", () => {
    const copy = describePermissionRecovery("notifications", "denied");
    expect(copy.action).toBe("request");
    expect(copy.message.toLowerCase()).toContain("denied");
  });

  it("denied-permanently still routes to system settings, never 'request'", () => {
    const copy = describePermissionRecovery("notifications", "denied-permanently");
    expect(copy.action).toBe("open-settings");
    expect(copy.action).not.toBe("request");
    expect(copy.message.toLowerCase()).toContain("settings");
  });
});

describe("resolvePermission (imported, not reimplemented) drives this module's port", () => {
  it("reads a granted status without prompting", async () => {
    let requestCalled = false;
    const port: NotificationPermissionPort = {
      async getPermissionStatus() {
        return "granted";
      },
      async requestPermission() {
        requestCalled = true;
        return "granted";
      },
    };

    const status = await resolvePermission(port);

    expect(status).toBe("granted");
    expect(requestCalled).toBe(false);
  });

  it("prompts exactly once when the OS has never asked", async () => {
    let requestCalls = 0;
    const port: NotificationPermissionPort = {
      async getPermissionStatus() {
        return "undetermined";
      },
      async requestPermission() {
        requestCalls += 1;
        return "granted";
      },
    };

    const status = await resolvePermission(port);

    expect(status).toBe("granted");
    expect(requestCalls).toBe(1);
  });

  it("never re-prompts a denied-permanently read", async () => {
    let requestCalls = 0;
    const port: NotificationPermissionPort = {
      async getPermissionStatus() {
        return "denied-permanently";
      },
      async requestPermission() {
        requestCalls += 1;
        return "denied-permanently";
      },
    };

    const status = await resolvePermission(port);

    expect(status).toBe("denied-permanently");
    expect(requestCalls).toBe(0);
  });
});
