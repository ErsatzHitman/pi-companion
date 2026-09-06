import { describe, expect, it } from "vitest";

import {
  describePermissionRecovery,
  resolvePermission,
  type PermissionKind,
  type PermissionPort,
  type PermissionState,
} from "./permission-recovery";

const KINDS: readonly PermissionKind[] = ["photos", "microphone", "camera", "notifications"];
const STATES: readonly PermissionState[] = [
  "undetermined",
  "granted",
  "denied",
  "denied-permanently",
  "unavailable",
];

function scriptedPort(
  statusSequence: PermissionState[],
  requestSequence: PermissionState[],
): { port: PermissionPort; calls: { statusCalls: number; requestCalls: number } } {
  const calls = { statusCalls: 0, requestCalls: 0 };
  const port: PermissionPort = {
    async getPermissionStatus() {
      const value = statusSequence[calls.statusCalls] ?? statusSequence[statusSequence.length - 1];
      calls.statusCalls += 1;
      return value as PermissionState;
    },
    async requestPermission() {
      const value =
        requestSequence[calls.requestCalls] ?? requestSequence[requestSequence.length - 1];
      calls.requestCalls += 1;
      return value as PermissionState;
    },
  };
  return { port, calls };
}

describe("describePermissionRecovery — every state has a named, non-empty exit", () => {
  for (const kind of KINDS) {
    for (const state of STATES) {
      it(`(${kind}, ${state}) has a non-empty title, message, and actionLabel`, () => {
        const copy = describePermissionRecovery(kind, state);
        expect(copy.title.length).toBeGreaterThan(0);
        expect(copy.message.length).toBeGreaterThan(0);
        expect(copy.actionLabel.length).toBeGreaterThan(0);
        expect(["request", "open-settings", "dismiss"]).toContain(copy.action);
      });
    }
  }

  it("denied-permanently never routes back into a re-prompt — its action is always open-settings", () => {
    for (const kind of KINDS) {
      expect(describePermissionRecovery(kind, "denied-permanently").action).toBe("open-settings");
    }
  });

  it("denied and undetermined route to a request (re-prompt is still meaningful there)", () => {
    for (const kind of KINDS) {
      expect(describePermissionRecovery(kind, "denied").action).toBe("request");
      expect(describePermissionRecovery(kind, "undetermined").action).toBe("request");
    }
  });

  it("granted and unavailable are dismiss-only — nothing left to ask for", () => {
    for (const kind of KINDS) {
      expect(describePermissionRecovery(kind, "granted").action).toBe("dismiss");
      expect(describePermissionRecovery(kind, "unavailable").action).toBe("dismiss");
    }
  });

  it("microphone copy names microphone, not photos, and vice versa", () => {
    expect(describePermissionRecovery("microphone", "denied").message.toLowerCase()).toContain(
      "microphone",
    );
    expect(describePermissionRecovery("photos", "denied").message.toLowerCase()).not.toContain(
      "microphone",
    );
  });

  it("camera copy (T60D, folded in from features/connect/'s onboarding step) names camera and its QR-pairing purpose", () => {
    const denied = describePermissionRecovery("camera", "denied");
    expect(denied.message.toLowerCase()).toContain("camera");
    expect(denied.message.toLowerCase()).not.toContain("microphone");

    const blocked = describePermissionRecovery("camera", "denied-permanently");
    expect(blocked.action).toBe("open-settings");
    expect(blocked.message.toLowerCase()).toContain("pairing qr code");
  });

  it("notifications copy (T60D, folded in for features/notifications/) names notifications", () => {
    expect(
      describePermissionRecovery("notifications", "undetermined").message.toLowerCase(),
    ).toContain("notification");
  });

  it("T60F's undetermined-title decision (applied by T60G): notifications gets the bespoke question title, not the generic pattern", () => {
    const copy = describePermissionRecovery("notifications", "undetermined");
    expect(copy.title).toBe("Turn on notifications?");
    // The override is title-only — message/actionLabel/action stay exactly
    // as generic as every other kind's "undetermined" copy (the same
    // "Allow {kind} access to {purpose}." pattern, not a restated one).
    expect(copy.message).toBe("Allow notification access to show updates about your agents.");
    expect(copy.actionLabel).toBe("Allow");
    expect(copy.action).toBe("request");
  });

  it("the undetermined-title override is scoped to notifications only — the other three kinds keep the generic '{Kind} access needed' title", () => {
    expect(describePermissionRecovery("photos", "undetermined").title).toBe(
      "Photo and file access needed",
    );
    expect(describePermissionRecovery("microphone", "undetermined").title).toBe(
      "Microphone access needed",
    );
    expect(describePermissionRecovery("camera", "undetermined").title).toBe("Camera access needed");
  });
});

describe("resolvePermission — mirrors ../connect/qr-scan-model.ts's enterScanSurface rule", () => {
  it("returns granted without ever calling requestPermission", async () => {
    const { port, calls } = scriptedPort(["granted"], []);
    expect(await resolvePermission(port)).toBe("granted");
    expect(calls.requestCalls).toBe(0);
  });

  it("prompts exactly once when the read comes back undetermined", async () => {
    const { port, calls } = scriptedPort(["undetermined"], ["granted"]);
    expect(await resolvePermission(port)).toBe("granted");
    expect(calls.requestCalls).toBe(1);
  });

  it("never re-prompts an already-denied permission", async () => {
    const { port, calls } = scriptedPort(["denied"], ["granted"]);
    expect(await resolvePermission(port)).toBe("denied");
    expect(calls.requestCalls).toBe(0);
  });

  it("never re-prompts a permanently-denied permission", async () => {
    const { port, calls } = scriptedPort(["denied-permanently"], ["granted"]);
    expect(await resolvePermission(port)).toBe("denied-permanently");
    expect(calls.requestCalls).toBe(0);
  });

  it("never prompts an unavailable port", async () => {
    const { port, calls } = scriptedPort(["unavailable"], ["granted"]);
    expect(await resolvePermission(port)).toBe("unavailable");
    expect(calls.requestCalls).toBe(0);
  });
});
