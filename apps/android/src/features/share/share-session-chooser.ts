/**
 * Session-chooser state machine for an accepted share (T36C).
 *
 * Modelling the draft is the easy half of "a share intent creates a
 * draft in a chosen session" (this task's brief); *choosing* the
 * session is the half that must not go wrong. This module is a pure
 * reducer over `ShareChooserState` that names every edge case the
 * brief calls out explicitly, so a share can never silently land in
 * the wrong session:
 *
 *   - no session exists to choose from  -> `"no-sessions"`
 *   - the chooser is dismissed          -> `"cancelled"`
 *   - the chosen session is no longer valid by the time the share
 *     resolves (closed/archived between the chooser opening and the
 *     user's tap) -> `"invalid-session"`, refused rather than written
 *   - a second share arrives while the chooser is already open -> the
 *     new content replaces whatever was previously queued behind the
 *     open chooser (last-share-wins for the *queued* slot only — the
 *     share currently being chosen for is never displaced), and the
 *     caller is told so it can re-present the chooser for the queued
 *     share once the current one resolves or is dismissed.
 *
 * `chooseSession` re-validates the chosen id against a *freshly
 * supplied* `validSessionIds` at resolve time rather than trusting the
 * candidate list the chooser was opened with — that is what catches
 * "no longer valid by the time the share resolves".
 */

import type { ClassifiedShareContent } from "./share-intent-model.js";

export type ShareChooserState =
  | { status: "idle" }
  | {
      status: "choosing";
      content: ClassifiedShareContent;
      candidateSessionIds: readonly string[];
      /** A share that arrived while this chooser was already open, awaiting its own turn. */
      queuedNext?: ClassifiedShareContent;
    }
  | { status: "resolved"; content: ClassifiedShareContent; sessionId: string }
  | { status: "cancelled"; content: ClassifiedShareContent }
  | { status: "invalid-session"; content: ClassifiedShareContent; sessionId: string }
  | { status: "no-sessions"; content: ClassifiedShareContent };

export const IDLE_SHARE_CHOOSER_STATE: ShareChooserState = { status: "idle" };

export type PresentShareOutcome = "opened" | "queued" | "queued-replacing-pending" | "no-sessions";

export interface PresentShareResult {
  state: ShareChooserState;
  outcome: PresentShareOutcome;
}

/**
 * Presents a newly accepted share for the user to choose a session for.
 * If a chooser is already open, the new share is queued behind it
 * (never merged into, and never silently replacing, the share already
 * being chosen for).
 */
export function presentShareForChoice(
  state: ShareChooserState,
  content: ClassifiedShareContent,
  candidateSessionIds: readonly string[],
): PresentShareResult {
  if (state.status === "choosing") {
    const outcome: PresentShareOutcome = state.queuedNext ? "queued-replacing-pending" : "queued";
    return {
      state: { ...state, queuedNext: content },
      outcome,
    };
  }

  if (candidateSessionIds.length === 0) {
    return { state: { status: "no-sessions", content }, outcome: "no-sessions" };
  }

  return {
    state: { status: "choosing", content, candidateSessionIds },
    outcome: "opened",
  };
}

export type ChooseSessionOutcome = "resolved" | "invalid-session";

export interface ChooseSessionResult {
  state: ShareChooserState;
  outcome: ChooseSessionOutcome;
  /** A share queued while the chooser was open, now ready to be presented again. `undefined` when none was queued. */
  nextPending?: ClassifiedShareContent;
}

/**
 * Resolves the open chooser with the user's chosen session id,
 * re-validated against `validSessionIds` as of *this* call — not the
 * candidate list the chooser opened with. A no-op-shaped
 * `{status:"invalid-session"}` result is returned (not a throw) when
 * `sessionId` is no longer in `validSessionIds`; the caller must not
 * write anywhere in that case.
 */
export function chooseSession(
  state: ShareChooserState,
  sessionId: string,
  validSessionIds: readonly string[],
): ChooseSessionResult | null {
  if (state.status !== "choosing") return null;

  const nextPending = state.queuedNext;
  if (!validSessionIds.includes(sessionId)) {
    return {
      state: { status: "invalid-session", content: state.content, sessionId },
      outcome: "invalid-session",
      nextPending,
    };
  }

  return {
    state: { status: "resolved", content: state.content, sessionId },
    outcome: "resolved",
    nextPending,
  };
}

export interface DismissChooserResult {
  state: ShareChooserState;
  nextPending?: ClassifiedShareContent;
}

/** Dismisses the open chooser without choosing a session. A no-op (`null`) unless a chooser is actually open. */
export function dismissChooser(state: ShareChooserState): DismissChooserResult | null {
  if (state.status !== "choosing") return null;
  return {
    state: { status: "cancelled", content: state.content },
    nextPending: state.queuedNext,
  };
}
