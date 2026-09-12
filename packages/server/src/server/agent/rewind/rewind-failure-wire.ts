/**
 * Stamps the two classified `agent.rewind` failures onto the wire —
 * `plan.md` §4.2 ("Workspace checkpoint snapshots").
 *
 * `agent.rewind.response.payload` has no structured error code (T383 left
 * the wire shape alone), so the session handler's single catch-all turns
 * every throw into one `error` string. The rewind controller in
 * `@picompanion/frontend-core` still has to tell a refused restore and an
 * unsupported mode apart from a generic daemon failure — and by a stable
 * code, not by matching a human sentence — so this function prepends the
 * documented markers from `@picompanion/protocol/rewind-errors`.
 *
 * The daemon's own error classes keep their human messages unchanged; the
 * marker exists only on the wire, where `stripRewindFailureMarker` removes
 * it before a screen displays the sentence.
 */
import {
  REWIND_CONFLICT_ERROR_MARKER,
  REWIND_UNSUPPORTED_ERROR_MARKER,
} from "@picompanion/protocol/rewind-errors";
import { CheckpointConflictError } from "../checkpoints/index.js";
import { RewindCapabilityError } from "./rewind.js";

/** The `agent.rewind.response.payload.error` string for `error`, marker included when classified. */
export function formatRewindFailureForWire(error: unknown): string {
  const message = error instanceof Error ? error.message : "Failed to rewind agent";
  if (error instanceof CheckpointConflictError) {
    return `${REWIND_CONFLICT_ERROR_MARKER}${message}`;
  }
  if (error instanceof RewindCapabilityError) {
    return `${REWIND_UNSUPPORTED_ERROR_MARKER}${message}`;
  }
  return message;
}
