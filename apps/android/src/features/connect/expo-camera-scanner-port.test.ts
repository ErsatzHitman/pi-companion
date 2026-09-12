/**
 * T392 coverage for the real `createExpoCameraScannerPort` adapter.
 *
 * Same technique as `../composer/expo-camera-capture-port.test.ts` and
 * `../voice/expo-audio-voice-capture-port.test.ts`: `expo-camera` reaches
 * `react-native` transitively (via `expo-modules-core`'s `Platform`),
 * which this workspace's plain `vitest` setup cannot transform, so the
 * package is replaced with a controllable fixture via a `vi.mock`
 * factory hoisted to the top of this file, before the module under test
 * is imported. The real native package is never actually loaded here.
 *
 * Two proof strategies, mirroring the capture port's suite:
 *  - Most cases inject a plain fake `CameraScannerBindings` directly to
 *    prove this port's own mapping/composition.
 *  - The last block proves `DEFAULT_BINDINGS` itself by calling
 *    `createExpoCameraScannerPort()` with NO arguments and reading the
 *    mocked fixture's recorded calls.
 */
import { describe, expect, it, vi } from "vitest";

import type { PermissionState } from "../composer/permission-recovery.js";
import type {
  CameraScannerBindings,
  ExpoCameraPermissionResponse,
} from "./expo-camera-scanner-port.js";

const cameraFixture = vi.hoisted(() => {
  const state: {
    permission: { granted: boolean; status: string; canAskAgain: boolean };
    getCameraPermissionsAsyncCalls: number;
    requestCameraPermissionsAsyncCalls: number;
  } = {
    permission: { granted: true, status: "granted", canAskAgain: true },
    getCameraPermissionsAsyncCalls: 0,
    requestCameraPermissionsAsyncCalls: 0,
  };
  return {
    state,
    reset() {
      state.permission = { granted: true, status: "granted", canAskAgain: true };
      state.getCameraPermissionsAsyncCalls = 0;
      state.requestCameraPermissionsAsyncCalls = 0;
    },
  };
});

vi.mock("expo-camera", () => ({
  Camera: {
    async getCameraPermissionsAsync() {
      cameraFixture.state.getCameraPermissionsAsyncCalls += 1;
      return cameraFixture.state.permission;
    },
    async requestCameraPermissionsAsync() {
      cameraFixture.state.requestCameraPermissionsAsyncCalls += 1;
      return cameraFixture.state.permission;
    },
  },
}));

const { createExpoCameraScannerPort } = await import("./expo-camera-scanner-port.js");

function permission(
  granted: boolean,
  status: string,
  canAskAgain: boolean,
): ExpoCameraPermissionResponse {
  return { granted, status, canAskAgain };
}

function createFakeBindings(overrides?: {
  permission?: ExpoCameraPermissionResponse;
}): CameraScannerBindings & {
  calls: { getCameraPermissionsAsync: number; requestCameraPermissionsAsync: number };
} {
  const perm = overrides?.permission ?? permission(true, "granted", true);
  const calls = { getCameraPermissionsAsync: 0, requestCameraPermissionsAsync: 0 };
  return {
    calls,
    async getCameraPermissionsAsync() {
      calls.getCameraPermissionsAsync += 1;
      return perm;
    },
    async requestCameraPermissionsAsync() {
      calls.requestCameraPermissionsAsync += 1;
      return perm;
    },
  };
}

describe("createExpoCameraScannerPort — permission mapping", () => {
  it.each<[boolean, string, boolean, PermissionState]>([
    [true, "granted", true, "granted"],
    [false, "denied", true, "denied"],
    // Android's "don't ask again": the OS itself refuses to prompt
    // again, so this must be its own recoverable-via-settings state.
    [false, "denied", false, "denied-permanently"],
    [false, "undetermined", true, "undetermined"],
  ])(
    "granted=%s status=%s canAskAgain=%s -> %s",
    async (granted, status, canAskAgain, expected) => {
      const bindings = createFakeBindings({ permission: permission(granted, status, canAskAgain) });
      const port = createExpoCameraScannerPort(bindings);

      expect(await port.getPermissionStatus()).toBe(expected);
      expect(await port.requestPermission()).toBe(expected);
    },
  );

  it("getPermissionStatus never prompts through requestCameraPermissionsAsync, and vice versa", async () => {
    const bindings = createFakeBindings();
    const port = createExpoCameraScannerPort(bindings);

    await port.getPermissionStatus();
    expect(bindings.calls.getCameraPermissionsAsync).toBe(1);
    expect(bindings.calls.requestCameraPermissionsAsync).toBe(0);

    await port.requestPermission();
    expect(bindings.calls.requestCameraPermissionsAsync).toBe(1);
    expect(bindings.calls.getCameraPermissionsAsync).toBe(1);
  });

  it('never invents "unavailable" — a working permission read can only report the OS\'s own four answers', async () => {
    for (const candidate of [
      permission(true, "granted", true),
      permission(false, "denied", true),
      permission(false, "denied", false),
      permission(false, "undetermined", true),
    ]) {
      const port = createExpoCameraScannerPort(createFakeBindings({ permission: candidate }));
      expect(await port.getPermissionStatus()).not.toBe("unavailable");
      expect(await port.requestPermission()).not.toBe("unavailable");
    }
  });
});

describe("DEFAULT_BINDINGS — the object that actually wires to expo-camera", () => {
  it("createExpoCameraScannerPort() with no arguments reaches the real (mocked) expo-camera permission functions", async () => {
    cameraFixture.reset();
    cameraFixture.state.permission = { granted: false, status: "denied", canAskAgain: false };
    const port = createExpoCameraScannerPort();

    expect(await port.getPermissionStatus()).toBe("denied-permanently");
    expect(cameraFixture.state.getCameraPermissionsAsyncCalls).toBe(1);

    expect(await port.requestPermission()).toBe("denied-permanently");
    expect(cameraFixture.state.requestCameraPermissionsAsyncCalls).toBe(1);
  });
});
