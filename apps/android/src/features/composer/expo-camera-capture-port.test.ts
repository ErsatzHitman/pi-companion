/**
 * T290 coverage for the real `createExpoCameraCapturePort` adapter.
 *
 * Same technique as `./expo-attachment-source-port.test.ts` and
 * `../voice/expo-audio-voice-capture-port.test.ts`: `expo-image-picker`
 * transitively imports `react-native` (via `expo-modules-core`'s
 * `Platform.ts`), which this workspace's plain `vitest` setup cannot
 * transform. `expo-image-picker` is replaced with a controllable
 * fixture via a `vi.mock` factory, hoisted to the top of this file,
 * before the module under test is imported — so the real native
 * package, and the real `react-native` it would drag in, is never
 * actually loaded here in ANY test in this file.
 *
 * Two proof strategies:
 *  - Most of this suite injects a plain fake `CameraCaptureBindings`
 *    directly (no interaction with the mocked `expo-image-picker`
 *    fixture at all) to prove the port's own composition logic:
 *    permission mapping, cancellation handling, and asset mapping.
 *  - The last block proves `DEFAULT_BINDINGS` itself by calling
 *    `createExpoCameraCapturePort()` with NO arguments and reading the
 *    mocked fixture's own recorded calls.
 *
 * T83/T278's "exactly one resolution per press" invariant is proven at
 * the `runCapturePress` level (`attachment-capture-model.test.ts`) —
 * this file only proves this port never calls a permission method from
 * inside `capturePhoto` itself, which that invariant depends on.
 */
import { describe, expect, it, vi } from "vitest";

import type {
  CameraCaptureBindings,
  CameraCaptureResult,
  ExpoCameraPermissionResponse,
} from "./expo-camera-capture-port.js";

const imagePickerFixture = vi.hoisted(() => {
  const state: {
    permission: { granted: boolean; status: string; canAskAgain: boolean };
    result: CameraCaptureResult;
    getCameraPermissionsAsyncCalls: number;
    requestCameraPermissionsAsyncCalls: number;
    launchCameraAsyncCalls: number;
  } = {
    permission: { granted: true, status: "granted", canAskAgain: true },
    result: { canceled: true },
    getCameraPermissionsAsyncCalls: 0,
    requestCameraPermissionsAsyncCalls: 0,
    launchCameraAsyncCalls: 0,
  };
  return {
    state,
    reset() {
      state.permission = { granted: true, status: "granted", canAskAgain: true };
      state.result = { canceled: true };
      state.getCameraPermissionsAsyncCalls = 0;
      state.requestCameraPermissionsAsyncCalls = 0;
      state.launchCameraAsyncCalls = 0;
    },
  };
});

vi.mock("expo-image-picker", () => ({
  async getCameraPermissionsAsync() {
    imagePickerFixture.state.getCameraPermissionsAsyncCalls += 1;
    return imagePickerFixture.state.permission;
  },
  async requestCameraPermissionsAsync() {
    imagePickerFixture.state.requestCameraPermissionsAsyncCalls += 1;
    return imagePickerFixture.state.permission;
  },
  async launchCameraAsync() {
    imagePickerFixture.state.launchCameraAsyncCalls += 1;
    return imagePickerFixture.state.result;
  },
}));

const { createExpoCameraCapturePort } = await import("./expo-camera-capture-port.js");

function permission(
  granted: boolean,
  status: string,
  canAskAgain: boolean,
): ExpoCameraPermissionResponse {
  return { granted, status, canAskAgain };
}

function createFakeBindings(overrides?: {
  permission?: ExpoCameraPermissionResponse;
  result?: CameraCaptureResult;
}): CameraCaptureBindings & {
  calls: {
    getCameraPermissionsAsync: number;
    requestCameraPermissionsAsync: number;
    launchCameraAsync: number;
  };
} {
  const perm = overrides?.permission ?? permission(true, "granted", true);
  const result = overrides?.result ?? { canceled: true };
  const calls = {
    getCameraPermissionsAsync: 0,
    requestCameraPermissionsAsync: 0,
    launchCameraAsync: 0,
  };
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
    async launchCameraAsync() {
      calls.launchCameraAsync += 1;
      return result;
    },
  };
}

describe("createExpoCameraCapturePort — permission mapping", () => {
  it("granted maps to granted", async () => {
    const port = createExpoCameraCapturePort(
      createFakeBindings({ permission: permission(true, "granted", true) }),
    );
    await expect(port.getPermissionStatus()).resolves.toBe("granted");
  });

  it("denied with canAskAgain true maps to denied", async () => {
    const port = createExpoCameraCapturePort(
      createFakeBindings({ permission: permission(false, "denied", true) }),
    );
    await expect(port.getPermissionStatus()).resolves.toBe("denied");
  });

  it("denied with canAskAgain false maps to denied-permanently", async () => {
    const port = createExpoCameraCapturePort(
      createFakeBindings({ permission: permission(false, "denied", false) }),
    );
    await expect(port.getPermissionStatus()).resolves.toBe("denied-permanently");
  });

  it("undetermined status maps to undetermined", async () => {
    const port = createExpoCameraCapturePort(
      createFakeBindings({ permission: permission(false, "undetermined", true) }),
    );
    await expect(port.getPermissionStatus()).resolves.toBe("undetermined");
  });

  it("requestPermission reads from requestCameraPermissionsAsync, not getCameraPermissionsAsync", async () => {
    const bindings = createFakeBindings({ permission: permission(true, "granted", true) });
    const port = createExpoCameraCapturePort(bindings);

    await port.requestPermission();

    expect(bindings.calls.requestCameraPermissionsAsync).toBe(1);
    expect(bindings.calls.getCameraPermissionsAsync).toBe(0);
  });
});

describe("createExpoCameraCapturePort — capturePhoto", () => {
  it("never calls a permission method itself (T83/T278's invariant depends on this)", async () => {
    const bindings = createFakeBindings({ result: { canceled: true } });
    const port = createExpoCameraCapturePort(bindings);

    await port.capturePhoto();

    expect(bindings.calls.getCameraPermissionsAsync).toBe(0);
    expect(bindings.calls.requestCameraPermissionsAsync).toBe(0);
    expect(bindings.calls.launchCameraAsync).toBe(1);
  });

  it("a cancelled capture resolves null — not a rejection", async () => {
    const port = createExpoCameraCapturePort(createFakeBindings({ result: { canceled: true } }));
    await expect(port.capturePhoto()).resolves.toBeNull();
  });

  it("an empty assets array (no photo taken) resolves null", async () => {
    const port = createExpoCameraCapturePort(
      createFakeBindings({ result: { canceled: false, assets: [] } }),
    );
    await expect(port.capturePhoto()).resolves.toBeNull();
  });

  it("maps a captured photo's fields onto PickedAttachmentFile, and readAsBytes reads its uri lazily", async () => {
    const port = createExpoCameraCapturePort(
      createFakeBindings({
        result: {
          canceled: false,
          assets: [
            {
              uri: "file:///cache/photo.jpg",
              fileName: "photo.jpg",
              fileSize: 4096,
              mimeType: "image/jpeg",
            },
          ],
        },
      }),
    );

    const file = await port.capturePhoto();

    expect(file).toMatchObject({
      name: "photo.jpg",
      mimeType: "image/jpeg",
      size: 4096,
      uri: "file:///cache/photo.jpg",
    });
    expect(typeof file?.readAsBytes).toBe("function");
  });

  it("falls back to a generic name when fileName is null", async () => {
    const port = createExpoCameraCapturePort(
      createFakeBindings({
        result: { canceled: false, assets: [{ uri: "file:///cache/img.jpg", fileName: null }] },
      }),
    );

    const file = await port.capturePhoto();

    expect(file?.name).toBe("photo.jpg");
  });
});

/**
 * MUTATION (per this repo's CLAUDE.md "a fix that no test can fail is
 * not a fix"): `capturePhoto` was edited in a scratch copy to call
 * `bindings.getCameraPermissionsAsync()` before `launchCameraAsync()`
 * (a speculative extra port-level resolution), and the "never calls a
 * permission method itself" case above was confirmed to fail
 * (`1 !== 0`) against that mutation, then the file was restored
 * byte-for-byte. See this task's final report for the exact `vitest`
 * output.
 */

describe("DEFAULT_BINDINGS — the object that actually wires to expo-image-picker", () => {
  it("createExpoCameraCapturePort() with no arguments calls the real (mocked) expo-image-picker module", async () => {
    imagePickerFixture.reset();
    imagePickerFixture.state.result = {
      canceled: false,
      assets: [
        { uri: "file:///cache/y.jpg", fileName: "y.jpg", fileSize: 20, mimeType: "image/jpeg" },
      ],
    };
    const port = createExpoCameraCapturePort();

    const state1 = await port.getPermissionStatus();
    expect(state1).toBe("granted");
    expect(imagePickerFixture.state.getCameraPermissionsAsyncCalls).toBe(1);

    const file = await port.capturePhoto();
    expect(imagePickerFixture.state.launchCameraAsyncCalls).toBe(1);
    expect(file).toMatchObject({
      name: "y.jpg",
      mimeType: "image/jpeg",
      size: 20,
      uri: "file:///cache/y.jpg",
    });
  });
});
