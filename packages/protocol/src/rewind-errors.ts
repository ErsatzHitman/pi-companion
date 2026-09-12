/**
 * Stable machine-detectable failure codes for `agent.rewind.response` —
 * `plan.md` §4.2 ("Workspace checkpoint snapshots").
 *
 * `AgentRewindResponseMessageSchema`'s payload carries only `ok: boolean`
 * and a human-readable `error: string | null`. T383 deliberately added no
 * structured error field — plan.md §4.2's conflict rule says "There is no
 * new message type and no version-literal change" — so a client cannot
 * read a code property off the wire.
 *
 * A files restore that the checkpoint system refuses because the work tree
 * moved under the snapshot is still an outcome a screen must be able to
 * answer with `force: true`, and it must be told apart from a generic
 * daemon failure by a stable signal rather than by matching the wording of
 * a sentence a later edit can reword. The daemon therefore carries the two
 * classified failures as a documented prefix on that `error` string, and
 * `parseRewindFailureCode` recovers the code while
 * `stripRewindFailureMarker` recovers the human sentence for display.
 *
 * This is a convention on an already-`string` field, not a schema or wire
 * shape change: an unmarked `error` (every generic failure) still means
 * "no classified code".
 */

/** Prefix the daemon prepends when a restore is refused for a moved work tree. */
export const REWIND_CONFLICT_ERROR_MARKER = "PI_COMPANION_REWIND_CONFLICT:";

/** Prefix the daemon prepends when the provider/host cannot rewind the requested mode. */
export const REWIND_UNSUPPORTED_ERROR_MARKER = "PI_COMPANION_REWIND_UNSUPPORTED:";

export type RewindFailureCode = "conflict" | "unsupported";

const REWIND_FAILURE_MARKERS: ReadonlyArray<readonly [RewindFailureCode, string]> = [
  ["conflict", REWIND_CONFLICT_ERROR_MARKER],
  ["unsupported", REWIND_UNSUPPORTED_ERROR_MARKER],
];

/** The prefix carrying `code`, for the daemon that emits a classified failure. */
export function markerForRewindFailure(code: RewindFailureCode): string {
  for (const [candidate, marker] of REWIND_FAILURE_MARKERS) {
    if (candidate === code) {
      return marker;
    }
  }
  // Exhaustive over `RewindFailureCode`; unreachable, but a total function
  // beats a silent `undefined` if a future code is added without a marker.
  throw new Error(`No rewind failure marker is registered for code ${String(code)}`);
}

/** The classified code `error` carries, or `null` when it carries no marker. */
export function parseRewindFailureCode(error: string | null | undefined): RewindFailureCode | null {
  if (!error) {
    return null;
  }
  for (const [code, marker] of REWIND_FAILURE_MARKERS) {
    if (error.startsWith(marker)) {
      return code;
    }
  }
  return null;
}

/** Strips a documented marker, returning the human sentence to display (or `error` unchanged). */
export function stripRewindFailureMarker(error: string): string {
  for (const [, marker] of REWIND_FAILURE_MARKERS) {
    if (error.startsWith(marker)) {
      return error.slice(marker.length).trimStart();
    }
  }
  return error;
}
