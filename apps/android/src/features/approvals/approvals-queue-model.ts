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
 * **Scope**: only the `"tool-actions"` presentation (real Pi tool/plan/
 * mode permission requests — the case `ui/recipes/ApprovalForm.tsx`
 * itself models, "Pi wants to write src/x.ts — Approve / Deny") is
 * rendered as a real decision surface. The Tier-1 extension dialog
 * kinds (`select`/`input`/`editor`/`confirm`/generic `question`, plan.md
 * §11.2) have no Android recipe yet — `ui/recipes/` has no `Select`/
 * `TextArea`/`TextField`-composing form for them the way
 * `PermissionDialog.tsx`'s `QuestionPanel` does on web — so
 * `resolveApprovalPanel` reports those as `"unsupported"`: still
 * answerable (a single Dismiss sends a deny/cancel response, so the
 * daemon is never left blocked — plan.md §11.2 "these block the
 * extension and require a response or timeout"), but not a real
 * decision surface. Building that is a gap for a future task; see this
 * task's report.
 */

import { permissions } from "@picompanion/frontend-core";
import { buildToolCallDisplayModel } from "@picompanion/protocol/tool-call-display";

/**
 * Local aliases for the two response builders this module dispatches
 * through (T21A, `packages/frontend-core/src/permissions/responses.ts`).
 * `@picompanion/frontend-core` only exports one package root (plan.md
 * §6: apps depend on package *exports*, never source-relative
 * cross-workspace paths, and there is no `/permissions` subpath), so
 * these come off the `permissions` namespace import — same convention
 * `PermissionDialog.tsx` uses on web.
 */
const { buildActionResponse, buildDenyResponse } = permissions;

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

export interface UnsupportedApprovalPanel {
  readonly kind: "unsupported";
  readonly toolLabel: string;
  readonly presentation: permissions.PermissionDialogPresentation;
  readonly closeResponse: permissions.AgentPermissionResponse;
}

export type ApprovalPanel =
  | BinaryApprovalPanel
  | ActionsRowApprovalPanel
  | UnsupportedApprovalPanel;

/**
 * Classifies one pending request into a renderable panel (T33B5's
 * criterion 1: "a permission request can be approved and denied in
 * app"). Mirrors `PermissionDialog.tsx`'s `ToolActionsPanel` branching
 * (zero actions / a binary pair / an N-action fallback) for the
 * `"tool-actions"` presentation, and reports every other presentation
 * as `"unsupported"` per this module's doc comment.
 */
export function resolveApprovalPanel(view: permissions.PermissionDialogViewModel): ApprovalPanel {
  const toolLabel = view.title ?? view.name;

  if (view.presentation !== "tool-actions") {
    return {
      kind: "unsupported",
      toolLabel,
      presentation: view.presentation,
      closeResponse: buildDenyResponse(),
    };
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

/** Human-readable "N more waiting" text, matching `PermissionDialog.tsx`'s own singular/plural wording. */
export function describeWaitingCount(waitingCount: number): string | null {
  if (waitingCount <= 0) return null;
  return waitingCount === 1
    ? "1 more request is waiting."
    : `${waitingCount} more requests are waiting.`;
}
