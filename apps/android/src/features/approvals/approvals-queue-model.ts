/**
 * Approvals queue and panel model (T33B5; plan.md §9.3 "Permission
 * notifications provide Approve and Deny actions when safe", §12.3
 * "single-answer semantics").
 *
 * RN-free by the same convention `composer-model.ts` and
 * `composer-focus-model.ts` document: vitest cannot render `.tsx` that
 * reaches `react-native`, so every decision here — which request is
 * "current", how many are waiting, which response Approve/Deny/close
 * produce — is a plain function over `@picompanion/frontend-core`'s
 * `permissions.PermissionsController`/`PermissionDialogViewModel`, unit-
 * testable with no device/emulator. `ApprovalsHost.tsx` and
 * `use-approvals-queue.ts` are thin views/wiring over this module.
 *
 * Vocabulary and decision verbs are matched to
 * `apps/web/src/features/approvals/PermissionDialog.tsx` (this task's
 * required reading) rather than invented fresh: "Approve"/"Deny", the
 * `isDangerousRequest`/`binaryActionPair` heuristics, and the
 * `buildActionResponse`/`buildDenyResponse` builders all come from
 * there, or from `@picompanion/frontend-core`'s `permissions` module
 * those builders themselves live in.
 *
 * **Scope**: the `"tool-actions"` presentation (real Pi tool/plan/
 * mode permission requests — the case `ui/recipes/ApprovalForm.tsx`
 * itself models, "Pi wants to write src/x.ts — Approve / Deny") and,
 * since T341, the `"confirm"` presentation are rendered as real decision
 * surfaces. (CORRECTED at T341: this said the Tier-1 extension dialog
 * kinds `select`/`input`/`editor`/`confirm`/generic `question` "have no
 * Android recipe yet" and are all reported as `"unsupported"`. Maestro
 * run 34485299369's `notification-approval` measured that against the
 * daemon's own Pi provider: a `confirm` `extension_ui_request` arrives as
 * a `kind: "question"` request with `metadata.extensionUiMethod:
 * "confirm"`, one question whose options the daemon itself fixes to
 * `Yes`/`No`, and the sheet offered a single Dismiss where the flow —
 * and any user — expected Approve/Deny.) A `confirm` is a binary
 * decision by definition, which is exactly what `ApprovalForm` models,
 * so `resolveConfirmApprovalPanel` below renders it through the same
 * recipe: Approve answers the question with the daemon's own yes-shaped
 * option (`buildQuestionAnswerResponse`; the provider translates it back
 * to `{confirmed: true}` by matching the answer text, `agent.ts`'s
 * `buildExtensionUiResponse`), Deny/close sends the deny response the
 * provider turns into `{cancelled: true}`.
 *
 * The remaining kinds — `select` (single and `multiSelect`), `input`,
 * `editor`, and the generic `question` fallback — are real decision
 * surfaces too, rendered by `ApprovalsQuestionForm.tsx` over
 * `approvals-question-model.ts`'s answer state machine, with the same
 * Submit/Cancel semantics as `PermissionDialog.tsx`'s `QuestionPanel`.
 * (CORRECTED: this said those kinds "still have no `Select`/`TextArea`/
 * `TextField`-composing recipe" and were all reported as
 * `"unsupported"`. Every one of them is built by the daemon with exactly
 * one question — the combined `ask_user` dialog with two — so none needs
 * the Dismiss-only fallback any more.) A `"question"`-kind request that
 * arrives with no `input.questions` at all — nothing to answer, and not a
 * shape the ported Pi provider builds (`mapExtensionUiRequestToPermission`
 * returns no request at all for an unrecognized method) — still reports
 * `"unsupported"`: a single Dismiss sends a deny/cancel response, so the
 * daemon is never left blocked (plan.md §11.2 "these block the extension
 * and require a response or timeout"), but no decision can be read from a
 * request that asks nothing.
 */

import { permissions } from "@picompanion/frontend-core";
import { buildToolCallDisplayModel } from "@picompanion/protocol/tool-call-display";

import {
  explainQuestionPanelDetail,
  questionPanelDismissLabel,
} from "./approvals-question-model.js";

/**
 * Local aliases for the two response builders this module dispatches
 * through (T21A, `packages/frontend-core/src/permissions/responses.ts`).
 * `@picompanion/frontend-core` only exports one package root (plan.md
 * §6: apps depend on package *exports*, never source-relative
 * cross-workspace paths, and there is no `/permissions` subpath), so
 * these come off the `permissions` namespace import — same convention
 * `PermissionDialog.tsx` uses on web.
 */
const { buildActionResponse, buildDenyResponse, buildQuestionAnswerResponse } = permissions;

export interface ApprovalsQueueSnapshot {
  /** The oldest still-pending request, or `null` when the queue is empty. */
  readonly current: permissions.PermissionDialogViewModel | null;
  /** How many further requests are queued behind `current`. */
  readonly waitingCount: number;
}

/**
 * Reads `controller`'s pending queue and, when `sessionId` is given,
 * scopes it to that agent — matching `ComposerContainer`'s own
 * `sessionId` prop and `use-approvals-queue.ts`'s web counterpart.
 * Requests are answered one at a time, oldest first.
 */
export function getApprovalsQueueSnapshot(
  controller: Pick<permissions.PermissionsController, "getPending">,
  sessionId?: string,
): ApprovalsQueueSnapshot {
  const pending = controller.getPending();
  const scoped =
    sessionId === undefined ? pending : pending.filter((view) => view.agentId === sessionId);
  return {
    current: scoped[0] ?? null,
    waitingCount: Math.max(0, scoped.length - 1),
  };
}

/**
 * No wire field marks a permission request "dangerous" — the daemon
 * (`packages/protocol/src/agent-types.ts`) carries no such flag. The one
 * real signal is `AgentPermissionAction.variant`; matches
 * `PermissionDialog.tsx`'s own `isDangerousRequest` heuristic exactly.
 */
export function isDangerousRequest(actions: readonly permissions.AgentPermissionAction[]): boolean {
  return actions.some((action) => action.variant === "danger");
}

/** A binary allow/deny action pair fits `ApprovalForm`'s fixed two-button shape as-is. */
export function binaryActionPair(
  actions: readonly permissions.AgentPermissionAction[],
): { allow: permissions.AgentPermissionAction; deny: permissions.AgentPermissionAction } | null {
  if (actions.length !== 2) return null;
  const allow = actions.find((action) => action.behavior === "allow");
  const deny = actions.find((action) => action.behavior === "deny");
  return allow && deny ? { allow, deny } : null;
}

/**
 * One-line detail text for a `"tool-actions"` request, reusing
 * `@picompanion/protocol/tool-call-display`'s `buildToolCallDisplayModel`
 * exactly as `PermissionDialog.tsx`'s `toolCallDetailSummary` does — see
 * that function's doc comment for why `status: "running"` is supplied
 * (the type requires *some* status; nothing here reads it back out).
 */
export function toolCallSummary(view: permissions.PermissionDialogViewModel): string {
  const raw = view.raw;
  if (raw.detail) {
    try {
      const display = buildToolCallDisplayModel({
        name: raw.name,
        status: "running",
        error: null,
        metadata: raw.metadata,
        detail: raw.detail,
      });
      if (display.summary) return display.summary;
    } catch {
      // A malformed `detail` must never block rendering the panel.
    }
  }
  return view.description ?? view.title ?? view.name;
}

/** Deny-behavior actions first — matches `ActionsRow`'s own ordering rationale in `PermissionDialog.tsx` (never default focus onto "approve"). */
function orderDenyFirst(
  actions: readonly permissions.AgentPermissionAction[],
): permissions.AgentPermissionAction[] {
  return [...actions].sort((a, b) => Number(a.behavior !== "deny") - Number(b.behavior !== "deny"));
}

export interface BinaryApprovalPanel {
  readonly kind: "binary";
  readonly toolLabel: string;
  readonly detail: string;
  readonly dangerous: boolean;
  readonly approveResponse: permissions.AgentPermissionResponse;
  readonly denyResponse: permissions.AgentPermissionResponse;
  /** The response a scrim tap/back gesture sends — always the deny/cancel side, never a silent close. */
  readonly closeResponse: permissions.AgentPermissionResponse;
}

export interface ActionsRowApprovalPanel {
  readonly kind: "actions-row";
  readonly toolLabel: string;
  readonly detail: string;
  readonly dangerous: boolean;
  readonly actions: readonly {
    readonly action: permissions.AgentPermissionAction;
    readonly response: permissions.AgentPermissionResponse;
  }[];
  readonly closeResponse: permissions.AgentPermissionResponse;
}

/**
 * A Tier-1 extension dialog (`select`/`input`/`editor`/generic
 * `question`) as a real answer form — see `resolveQuestionApprovalPanel`.
 * The draft answers themselves are view state (`ApprovalsQuestionForm.tsx`
 * over `approvals-question-model.ts`); this panel carries only what the
 * classification decides: the questions to ask, the daemon's own dismiss
 * wording, and the deny/close response.
 */
export interface QuestionApprovalPanel {
  readonly kind: "question";
  readonly toolLabel: string;
  readonly detail: string;
  readonly presentation: permissions.PermissionDialogPresentation;
  readonly questions: readonly permissions.PermissionDialogQuestion[];
  readonly dismissLabel: string;
  readonly denyResponse: permissions.AgentPermissionResponse;
  /** The response a scrim tap/back gesture sends — always the deny/cancel side, never a silent close. */
  readonly closeResponse: permissions.AgentPermissionResponse;
}

/**
 * The Dismiss-only fallback. Reachable only for a `"question"`-kind
 * request that carries no questions at all — see this module's doc
 * comment. Kept in the union (rather than removed) because that shape is
 * still answerable — a deny/cancel response unblocks the daemon without
 * pretending a decision was read from an empty request.
 */
export interface UnsupportedApprovalPanel {
  readonly kind: "unsupported";
  readonly toolLabel: string;
  readonly presentation: permissions.PermissionDialogPresentation;
  readonly closeResponse: permissions.AgentPermissionResponse;
}

export type ApprovalPanel =
  | BinaryApprovalPanel
  | ActionsRowApprovalPanel
  | QuestionApprovalPanel
  | UnsupportedApprovalPanel;

/**
 * Classifies one pending request into a renderable panel (T33B5's
 * criterion 1: "a permission request can be approved and denied in
 * app"). Mirrors `PermissionDialog.tsx`'s `ToolActionsPanel` branching
 * (zero actions / a binary pair / an N-action fallback) for the
 * `"tool-actions"` presentation, `resolveConfirmApprovalPanel` for
 * `"confirm"`, and `resolveQuestionApprovalPanel` for every other
 * presentation — with the Dismiss-only `"unsupported"` panel kept for a
 * `"question"`-kind request carrying no questions at all, per this
 * module's doc comment.
 */
export function resolveApprovalPanel(view: permissions.PermissionDialogViewModel): ApprovalPanel {
  const toolLabel = view.title ?? view.name;

  if (view.presentation === "confirm") {
    return resolveConfirmApprovalPanel(view);
  }

  if (view.presentation !== "tool-actions") {
    if (view.questions.length === 0) {
      return {
        kind: "unsupported",
        toolLabel,
        presentation: view.presentation,
        closeResponse: buildDenyResponse(),
      };
    }
    return resolveQuestionApprovalPanel(view);
  }

  const detail = toolCallSummary(view);

  if (view.actions.length === 0) {
    const denyResponse = buildDenyResponse();
    return {
      kind: "binary",
      toolLabel,
      detail,
      dangerous: false,
      approveResponse: { behavior: "allow" },
      denyResponse,
      closeResponse: denyResponse,
    };
  }

  const pair = binaryActionPair(view.actions);
  if (pair) {
    const denyResponse = buildActionResponse(pair.deny);
    return {
      kind: "binary",
      toolLabel,
      detail,
      dangerous: isDangerousRequest(view.actions),
      approveResponse: buildActionResponse(pair.allow),
      denyResponse,
      closeResponse: denyResponse,
    };
  }

  const ordered = orderDenyFirst(view.actions);
  const denyAction = ordered.find((action) => action.behavior === "deny");
  return {
    kind: "actions-row",
    toolLabel,
    detail,
    dangerous: isDangerousRequest(view.actions),
    actions: ordered.map((action) => ({ action, response: buildActionResponse(action) })),
    closeResponse: denyAction ? buildActionResponse(denyAction) : buildDenyResponse(),
  };
}

/**
 * A non-`"tool-actions"`, non-`"confirm"` presentation as a real answer
 * form — `select` (single and `multiSelect`), `input`, `editor`, and the
 * generic `question` fallback. The daemon builds every one of these with
 * exactly one question (the combined `ask_user` dialog with two), so this
 * is a direct projection: the questions pass through in wire order, the
 * dismiss wording is the daemon's own `dismissLabel` (default "Cancel"),
 * and both dismiss and close send the same plain deny response
 * `PermissionDialog.tsx`'s Cancel button sends. The draft answers and the
 * Submit gate live in `approvals-question-model.ts`.
 */
export function resolveQuestionApprovalPanel(
  view: permissions.PermissionDialogViewModel,
): QuestionApprovalPanel {
  const denyResponse = buildDenyResponse();
  return {
    kind: "question",
    toolLabel: view.title ?? view.name,
    detail: explainQuestionPanelDetail(view),
    presentation: view.presentation,
    questions: view.questions,
    dismissLabel: questionPanelDismissLabel(view),
    denyResponse,
    closeResponse: denyResponse,
  };
}

/** The answer text the daemon's Pi provider reads as a confirmation (`agent.ts`'s `buildExtensionUiResponse`: `/^yes$/i`). */
const CONFIRM_YES_PATTERN = /^yes$/i;

/**
 * T341: a `confirm` extension dialog as a binary Approve/Deny panel — see
 * this module's doc comment. The daemon builds the request with exactly
 * one question (`QUESTION_RESPONSE_HEADER`, options `Yes`/`No`) and reads
 * back the first string answer, so Approve answers that question with
 * whichever offered option label is yes-shaped (falling back to the
 * literal the provider matches on, should a daemon ever offer none), and
 * Deny — like a scrim tap or back gesture — sends the plain deny
 * response, which the provider turns into `{cancelled: true}`. `detail`
 * is the question text itself: the provider joins the dialog's title and
 * message into it, so nothing the extension said is dropped.
 */
export function resolveConfirmApprovalPanel(
  view: permissions.PermissionDialogViewModel,
): BinaryApprovalPanel {
  const question = view.questions[0];
  const yesLabel =
    question?.options.find((option) => CONFIRM_YES_PATTERN.test(option.label.trim()))?.label ??
    "Yes";
  const denyResponse = buildDenyResponse();
  return {
    kind: "binary",
    toolLabel: view.title ?? view.name,
    detail: question?.question ?? view.description ?? "",
    dangerous: false,
    approveResponse: buildQuestionAnswerResponse({ [question?.header ?? "response"]: yesLabel }),
    denyResponse,
    closeResponse: denyResponse,
  };
}

/** Human-readable "N more waiting" text, matching `PermissionDialog.tsx`'s own singular/plural wording. */
export function describeWaitingCount(waitingCount: number): string | null {
  if (waitingCount <= 0) return null;
  return waitingCount === 1
    ? "1 more request is waiting."
    : `${waitingCount} more requests are waiting.`;
}
