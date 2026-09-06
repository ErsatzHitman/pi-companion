/**
 * Turns a settled `ArbitrationOutcome` (T47A1a,
 * `packages/frontend-core/src/actions/arbitration.ts`) into the readable
 * explanation T47A2 requires (plan.md §12.3):
 *
 * > A second answer resolves as superseded — not as an error, and never
 * > silently — carrying the outcome and, where the daemon supplies it,
 * > which client answered. The losing client closes with a readable
 * > explanation rather than having the dialog vanish.
 *
 * Pure and React-free by design (like every other `*-model.ts`/plain
 * module in this feature) so its text-building logic is covered by real
 * behavioral tests without touching the DOM or `react-native` — see
 * `outcome-notice.test.ts`.
 *
 * Two arbitration statuses produce a notice here, both meaning "another
 * client's answer is the one that counted, not this client's view of the
 * request":
 *
 * - `"superseded"` — this client itself answered, but a different
 *   client's answer reached the daemon first.
 * - `"resolved-elsewhere"` — this client never answered at all; the
 *   request was still open here when another client answered it. This is
 *   the literal "another client answered the request they are looking
 *   at" case named in this task's charter.
 *
 * `"confirmed"` (this client's own answer won) and `"pending"`/
 * `"answered-locally"` (nothing has settled yet) never produce a notice —
 * there is nothing contested to explain.
 */

import type { actions, permissions } from "@picompanion/frontend-core";

/** Renderer-ready explanation of a contested/superseded permission request. */
export interface OutcomeNoticeViewModel {
  readonly requestId: string;
  /** The request's own title/name, matching what the dialog itself displayed. */
  readonly title: string;
  /** Short status word for a `StatusIndicator`-style at-a-glance label. Never the only place the outcome is conveyed — see `message`. */
  readonly statusLabel: "Superseded" | "Answered elsewhere";
  /**
   * Which client answered, when the daemon supplies a human-readable
   * `label` for it (see `arbitration.ts`'s module doc on the wire gap this
   * degrades for). Always a non-empty, honest string — `"an unknown
   * client"` whenever the daemon did not supply a `label`, never an
   * invented name **and never the raw `clientId`** (T134: every production
   * emitter — `session.ts`'s `dispatchPiUiMessage` and
   * `handleAgentPermissionResponse` — sets `{ clientId: this.clientId }`
   * and nothing else, so a `clientId`-only fallback rendered an opaque
   * connection id, e.g. `clid_9f2a...`, to a real user).
   */
  readonly answeredByLabel: string;
  /** The full, readable sentence a test can read back — the actual explanation, not just a flag. */
  readonly message: string;
}

/**
 * Describes which client answered, honestly degrading to an explicit
 * "unknown" phrase rather than inventing an identity when the daemon
 * supplied no human-readable `label` (today's normal case for every real
 * emitter — see `arbitration.ts`'s wire-gap note). T134: a bare `clientId`
 * (e.g. `clid_9f2a...`) is not a human-readable answerer either, so it is
 * treated the same as "nothing supplied" rather than surfaced verbatim —
 * an opaque connection id is not meaningfully more informative to a user
 * than an explicit "unknown" phrase, and never leaks an internal id into
 * UI copy.
 */
export function describeAnsweredBy(answeredBy: actions.AnsweredBy | undefined): string {
  if (answeredBy?.label) return answeredBy.label;
  return "an unknown client";
}

/**
 * Describes an `AgentPermissionResponse` in plain words: the offered
 * action's own label when `selectedActionId` names one on this request
 * (so a daemon that relabels "Allow"/"Deny" to something else is
 * reflected exactly, matching `PermissionDialog.tsx`'s own
 * `buildActionResponse` convention), otherwise a generic
 * "approved"/"denied" derived from `behavior` alone.
 */
export function describeOutcome(
  response: permissions.AgentPermissionResponse,
  actionsOffered: readonly permissions.AgentPermissionAction[],
): string {
  const action = response.selectedActionId
    ? actionsOffered.find((candidate) => candidate.id === response.selectedActionId)
    : undefined;
  if (action) return `"${action.label}"`;
  return response.behavior === "deny" ? "denied" : "approved";
}

/**
 * Builds the notice for a settled outcome on `view`, or `null` when the
 * outcome does not represent a contested/superseded result (see module
 * doc above for exactly which statuses do).
 */
export function buildOutcomeNotice(
  view: permissions.PermissionDialogViewModel,
  outcome: actions.ArbitrationOutcome<permissions.AgentPermissionResponse>,
): OutcomeNoticeViewModel | null {
  const title = view.title ?? view.name;

  if (outcome.status === "superseded") {
    const who = describeAnsweredBy(outcome.answeredBy);
    const finalOutcome = describeOutcome(outcome.response, view.actions);
    return {
      requestId: view.requestId,
      title,
      statusLabel: "Superseded",
      answeredByLabel: who,
      message:
        `Your answer to "${title}" did not count: ${who} answered this request first. ` +
        `The request was resolved as ${finalOutcome}.`,
    };
  }

  if (outcome.status === "resolved-elsewhere") {
    const who = describeAnsweredBy(outcome.answeredBy);
    const finalOutcome = describeOutcome(outcome.response, view.actions);
    return {
      requestId: view.requestId,
      title,
      statusLabel: "Answered elsewhere",
      answeredByLabel: who,
      message: `${who} already answered "${title}" as ${finalOutcome}, before you responded here.`,
    };
  }

  return null;
}
