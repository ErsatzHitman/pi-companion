/**
 * `roster` kind renderer (plan.md §11.3, §11.7; T29B1) — "Agents, roles,
 * keys, or tasks with per-row actions", presented through the shared
 * `TaskRows` recipe (plan.md §10.4) so a roster reads exactly like Pi's own
 * plan-mode task list, just with richer optional per-row content.
 *
 * Per-row action routing (plan.md §4.2, §12.3): the daemon's Pi UI action
 * router resolves a row-scoped action against the composite element id
 * `${element.id}#${row.id}` (see `packages/server/.../pi-ui-bridge/
 * identity.ts` `parseCompositeElementId`/`PIUI_ROW_SEPARATOR`), with the
 * plain row action's own `actionId` alongside it — never a composite
 * `actionId`. This renderer is therefore the one place that composes that
 * `elementId` override (via the registry's `dispatchAction`/`getActionState`
 * optional second argument, added alongside this renderer) rather than
 * folding the row id into `actionId`, which the daemon would not understand.
 *
 * Dangerous (`confirm`-bearing) row actions follow the exact same
 * treatment `ElementActionsRow` already applies to element-level actions
 * (see that module's header comment, T29B5): a row action always dispatches
 * through `dispatchAction`, which gates a `confirm`-bearing dispatch behind
 * a platform confirmation dialog before sending anything — a row action is
 * not a materially different case, just one more scoped to a row identity
 * instead of the element.
 */
import type { PiUiAction } from "@picompanion/protocol/pi-ui-bridge/schema";
import type { extensions } from "@picompanion/frontend-core";

import type { ButtonKind } from "../../../ui/primitives/index.js";
import type { TaskRowAction, TaskRowItem, TaskRowStatus } from "../../../ui/recipes/index.js";
import { TaskRows } from "../../../ui/recipes/index.js";
import type { PiUiElementRendererProps } from "../registry.js";
import { ElementActionsRow } from "./element-actions.js";
import "./renderers.css";

const BUTTON_KIND: Record<NonNullable<PiUiAction["variant"]>, ButtonKind> = {
  primary: "primary",
  secondary: "secondary",
  danger: "danger",
};

const ROW_STATE_TO_TASK_STATUS: Record<string, TaskRowStatus> = {
  idle: "pending",
  running: "in-progress",
  blocked: "blocked",
  done: "done",
  error: "failed",
};

/** Roster rows carry no wire tone; `idle` defaults it the same way plan.md §11.3 documents. */
function taskRowStatus(state: string | undefined): TaskRowStatus {
  return ROW_STATE_TO_TASK_STATUS[state ?? "idle"] ?? "pending";
}

function feedbackText(state: extensions.ExtensionActionState): string | undefined {
  switch (state.status) {
    case "success":
      return "Done";
    case "rejected":
      return state.error ?? "Failed";
    case "timeout":
      return "Timed out";
    case "cancelled":
      return "Cancelled";
    default:
      return undefined;
  }
}

export function RosterRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"roster">) {
  const title = element.title ?? "Roster";

  const items: TaskRowItem[] = payload.rows.map((row) => {
    const rowElementId = `${element.id}#${row.id}`;
    const actions: TaskRowAction[] | undefined = row.actions?.map((action) => {
      const state = getActionState(action.id, rowElementId);
      const pending = state.status === "pending";
      return {
        id: action.id,
        label: action.label,
        kind: BUTTON_KIND[action.variant ?? "secondary"],
        disabled: pending,
        pending,
        feedback: feedbackText(state),
        confirmMessage: action.confirm,
        onSelect: () => {
          void dispatchAction(action.id, { action, elementId: rowElementId });
        },
      };
    });

    return {
      id: row.id,
      title: row.label,
      status: taskRowStatus(row.state),
      detail: row.detail,
      progress: row.progress,
      actions,
    };
  });

  return (
    <div className="pc-pi-roster" data-testid={`pi-roster-${element.ns}-${element.id}`}>
      <h3 className="pc-pi-roster__title">{title}</h3>
      {items.length > 0 ? (
        <TaskRows items={items} ariaLabel={title} />
      ) : (
        <p className="pc-pi-roster__empty">No rows to show.</p>
      )}
      <ElementActionsRow
        actions={element.actions}
        dispatchAction={dispatchAction}
        getActionState={getActionState}
        ariaLabel={`${title} actions`}
      />
    </div>
  );
}
