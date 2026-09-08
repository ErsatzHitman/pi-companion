import { describe, expect, it } from "vitest";

import { runCapturePress } from "./attachment-capture-model";
import type { PermissionState } from "./permission-recovery";
import type { CameraCapturePort, PickedAttachmentFile } from "./attachment-source-port";

/**
 * T278: proves `runCapturePress` resolves camera permission EXACTLY
 * ONCE per press, against the REAL `resolvePermission`
 * (`permission-recovery.ts`), not a further fake standing in for it —
 * the same counting-fake discipline `mic-press-model.test.ts`
 * established for T83's own proof (see that file's header). This is
 * the behavioural half of the "one-resolution-per-press" acceptance
 * criterion; `attachment-wiring.test.ts` carries the source-text half
 * (that `Composer.tsx`'s capture flow actually calls this function,
 * rather than resolving permission itself a second time).
 */

function createCountingPort(options?: {
  permission?: PermissionState;
  photo?: PickedAttachmentFile | null;
}): CameraCapturePort & {
  calls: { getPermissionStatus: number; requestPermission: number; capturePhoto: number };
} {
  const calls = { getPermissionStatus: 0, requestPermission: 0, capturePhoto: 0 };
  const permission = options?.permission ?? "granted";
  // `options.photo` may deliberately be `null` (the "user backed out of
  // the camera activity" case) — `??`/`?.` would treat that `null` as
  // "not provided" and silently fall back to the default, so this
  // checks presence with `in` instead.
  const photo: PickedAttachmentFile | null =
    options && "photo" in options
      ? (options.photo ?? null)
      : {
          name: "photo.jpg",
          mimeType: "image/jpeg",
          size: 1024,
          uri: "file:///cache/photo.jpg",
          readAsBytes: async () => new Uint8Array(),
        };
  return {
    calls,
    async getPermissionStatus() {
      calls.getPermissionStatus += 1;
      return permission;
    },
    async requestPermission() {
      calls.requestPermission += 1;
      return permission;
    },
    async capturePhoto() {
      calls.capturePhoto += 1;
      return photo;
    },
  };
}

describe("runCapturePress resolves camera permission exactly once per press (T278, mirroring T83's discipline)", () => {
  it("granted: reads permission exactly once, never prompts, and calls capturePhoto exactly once", async () => {
    const port = createCountingPort({ permission: "granted" });

    const result = await runCapturePress(port);

    expect(port.calls.getPermissionStatus).toBe(1);
    expect(port.calls.requestPermission).toBe(0);
    expect(port.calls.capturePhoto).toBe(1);
    expect(result.permissionState).toBe("granted");
    expect(result.file?.uri).toBe("file:///cache/photo.jpg");
  });

  it("undetermined: reads once and prompts once — one logical resolution, never two independent ones", async () => {
    const port = createCountingPort({ permission: "undetermined" });

    const result = await runCapturePress(port);

    expect(port.calls.getPermissionStatus).toBe(1);
    expect(port.calls.requestPermission).toBe(1);
    // resolvePermission itself resolves "undetermined" through exactly
    // one requestPermission call, whose own return value IS the final
    // state — createCountingPort's requestPermission echoes the same
    // `permission` it was constructed with, so this stays "undetermined"
    // rather than flipping to "granted"; capturePhoto must not run.
    expect(result.permissionState).toBe("undetermined");
    expect(port.calls.capturePhoto).toBe(0);
    expect(result.file).toBeNull();
  });

  it("denied: reads permission once and never calls capturePhoto", async () => {
    const port = createCountingPort({ permission: "denied" });

    const result = await runCapturePress(port);

    expect(port.calls.getPermissionStatus).toBe(1);
    expect(port.calls.requestPermission).toBe(0);
    expect(port.calls.capturePhoto).toBe(0);
    expect(result.permissionState).toBe("denied");
    expect(result.file).toBeNull();
  });

  it("unavailable (this build's only production CameraCapturePort): surfaces the honest unavailable state, never calls capturePhoto", async () => {
    const port = createCountingPort({ permission: "unavailable" });

    const result = await runCapturePress(port);

    expect(port.calls.getPermissionStatus).toBe(1);
    expect(port.calls.capturePhoto).toBe(0);
    expect(result.permissionState).toBe("unavailable");
    expect(result.file).toBeNull();
  });

  it("granted but the user backs out of the camera activity: capturePhoto resolving null is not a rejection", async () => {
    const port = createCountingPort({ permission: "granted", photo: null });

    const result = await runCapturePress(port);

    expect(port.calls.capturePhoto).toBe(1);
    expect(result.permissionState).toBe("granted");
    expect(result.file).toBeNull();
  });
});

/**
 * MUTATION (per this repo's CLAUDE.md "a fix that no test can fail is
 * not a fix"): `runCapturePress` was edited in a scratch copy to call
 * `port.capturePhoto()` unconditionally, ahead of the permission check
 * (`const file = await port.capturePhoto(); const permissionState =
 * await resolvePermission(port); if (permissionState !== "granted")
 * return { permissionState, file: null }; return { permissionState,
 * file };`), so a denied press would still have fired the camera. The
 * "denied: ... never calls capturePhoto" case above was confirmed to
 * fail (`1 !== 0`) against that mutation, then the file was restored
 * byte-for-byte. A second mutation — duplicating the resolution
 * (`await resolvePermission(port); const permissionState = await
 * resolvePermission(port);`) — was confirmed to fail the "granted:
 * reads permission exactly once" case above (`2 !== 1`) before being
 * discarded the same way. See this task's final report for the exact
 * `vitest` output of both runs.
 */
