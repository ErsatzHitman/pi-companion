/**
 * Camera-failure classification (plan.md §12.1, T27A4).
 *
 * `navigator.mediaDevices.getUserMedia` rejects with a `DOMException`
 * whose `name` distinguishes "the user said no" from "there is no
 * camera to ask about" from everything else; this module turns that
 * into the three outcomes the QR capture UI needs to show a distinct,
 * explained fallback for (acceptance criterion: "Camera-denied and
 * no-camera cases show an explained fallback to manual entry").
 */

export type CameraFailureKind = "denied" | "unavailable" | "error";

/** Thrown by `defaultGetUserMedia` when the platform has no camera API at all (no `navigator`, no `mediaDevices`, or no `getUserMedia`), rather than letting a raw `TypeError` reach the UI. */
export class CameraUnavailableError extends Error {
  constructor(message = "This browser has no camera to scan with.") {
    super(message);
    this.name = "CameraUnavailableError";
  }
}

const DENIED_NAMES = new Set(["NotAllowedError", "PermissionDeniedError", "SecurityError"]);
const UNAVAILABLE_NAMES = new Set([
  "NotFoundError",
  "DevicesNotFoundError",
  "OverconstrainedError",
  "ConstraintNotSatisfiedError",
]);

/**
 * A browser `DOMException` (what `getUserMedia` actually rejects with)
 * does not reliably satisfy `instanceof Error` across environments
 * (jsdom's own `DOMException` does not extend its `Error`, though
 * Node's and real browsers' both do) — so `.name` is read structurally
 * off anything that looks like it has one, rather than gating on
 * `instanceof Error` first.
 */
function errorName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) return undefined;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

/**
 * Classifies a `getUserMedia` rejection into `"denied"` (permission
 * refused), `"unavailable"` (no camera device / constraints
 * unsatisfiable / no camera API present), or `"error"` (anything else,
 * e.g. the device is in use by another application).
 */
export function classifyCameraError(error: unknown): CameraFailureKind {
  if (error instanceof CameraUnavailableError) return "unavailable";
  const name = errorName(error);
  if (name && DENIED_NAMES.has(name)) return "denied";
  if (name && UNAVAILABLE_NAMES.has(name)) return "unavailable";
  return "error";
}
