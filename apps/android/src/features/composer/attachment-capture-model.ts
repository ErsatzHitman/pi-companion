/**
 * The camera-capture press decision (T278, plan.md §9.2).
 *
 * RN-free for the same reason as `mic-press-model.ts` (see that file's
 * header): `vitest` cannot render `Composer.tsx` under this workspace's
 * plain setup, so the one behavioural rule this task must hold —
 * "resolve the camera permission at most once per press, and never call
 * `capturePhoto` unless that resolution came back granted" — lives here
 * as a plain async function over an injected `CameraCapturePort`,
 * exercised by `attachment-capture-model.test.ts` with a COUNTING fake
 * through the REAL `resolvePermission` (`permission-recovery.ts`) — not
 * a further fake standing in for it — the same discipline
 * `mic-press-model.test.ts` established for T83's own proof.
 *
 * This mirrors the shape `Composer.tsx`'s existing `handleAttachPress`
 * already uses (`resolvePermission(resolvedAttachmentSource)` once,
 * then `pickFiles()` only if granted) rather than
 * `mic-press-model.ts`'s shape (permission resolved INSIDE
 * `requestStart()`). Both shapes satisfy the same real invariant —
 * exactly one resolution per press — because in both cases there is
 * only ONE call to `resolvePermission` in the whole call graph a press
 * can reach; T83's bug was two SEPARATE ports each resolving the same
 * physical permission once, not "resolving outside the port is wrong"
 * (see `attachment-source-port.ts`'s `CameraCapturePort` doc comment
 * for why camera capture gets its own port rather than reusing
 * `AttachmentSourcePort` or `VoiceCapturePort`).
 */
import { resolvePermission, type PermissionState } from "./permission-recovery.js";
import type { CameraCapturePort, PickedAttachmentFile } from "./attachment-source-port.js";

export interface CapturePressResult {
  /** The permission state this press resolved to. Always set, even when denied/unavailable — `Composer.tsx` surfaces it via `PermissionRecoveryNotice kind="photo-capture"`. */
  permissionState: PermissionState;
  /** The captured photo, or `null` when permission was not granted, or when the user backed out of the camera activity without taking one. */
  file: PickedAttachmentFile | null;
}

/**
 * Runs one camera-capture press to completion. Calls
 * `resolvePermission(port)` exactly once; `port.capturePhoto()` is only
 * ever reached when that resolves to `"granted"`.
 */
export async function runCapturePress(port: CameraCapturePort): Promise<CapturePressResult> {
  const permissionState = await resolvePermission(port);
  if (permissionState !== "granted") {
    return { permissionState, file: null };
  }
  const file = await port.capturePhoto();
  return { permissionState, file };
}
