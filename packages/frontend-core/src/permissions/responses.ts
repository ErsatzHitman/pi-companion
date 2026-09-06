/**
 * Pure builders for the `AgentPermissionResponse` a platform renderer
 * sends back after a user answers a permission or extension dialog
 * request (plan.md §12.3). These never touch the network; callers pass
 * the result to `PermissionsController.answer`, which produces the full
 * outbound wire message.
 */

import type { AgentPermissionAction, AgentPermissionResponse } from "./types.js";

/** Answers a `"tool-actions"` presentation by selecting one offered action. */
export function buildActionResponse(
  action: AgentPermissionAction,
  extra?: { updatedInput?: Record<string, unknown> },
): AgentPermissionResponse {
  if (action.behavior === "deny") {
    return { behavior: "deny", selectedActionId: action.id };
  }
  return {
    behavior: "allow",
    selectedActionId: action.id,
    ...(extra?.updatedInput ? { updatedInput: extra.updatedInput } : {}),
  };
}

/**
 * Answers a `"select" | "input" | "editor" | "confirm" | "question"`
 * presentation. `answers` is keyed by each question's `header` (see
 * `PermissionDialogQuestion.header`), matching how the ported Pi
 * provider reads `updatedInput.answers[header]`
 * (`packages/server/src/server/agent/providers/pi/agent.ts`,
 * `permissionAnswer`).
 */
export function buildQuestionAnswerResponse(
  answers: Record<string, string>,
): AgentPermissionResponse {
  return {
    behavior: "allow",
    updatedInput: { answers },
  };
}

/** Cancels/dismisses any presentation without allowing it. */
export function buildDenyResponse(options?: {
  message?: string;
  interrupt?: boolean;
  selectedActionId?: string;
}): AgentPermissionResponse {
  return {
    behavior: "deny",
    ...(options?.selectedActionId !== undefined
      ? { selectedActionId: options.selectedActionId }
      : {}),
    ...(options?.message !== undefined ? { message: options.message } : {}),
    ...(options?.interrupt !== undefined ? { interrupt: options.interrupt } : {}),
  };
}
