import { Progress } from "../primitives/index.js";
import type { ButtonKind } from "../primitives/index.js";
import { Button } from "../primitives/index.js";
import "./recipes.css";

export type TaskRowStatus = "pending" | "in-progress" | "blocked" | "done" | "failed";

/** One row's determinate/indeterminate progress (T29B1). Optional; most rows have none. */
export interface TaskRowProgress {
  value?: number;
  max?: number;
  indeterminate?: boolean;
}

/**
 * One row action (T29B1) \u2014 already resolved to display state by the caller
 * (e.g. the `roster` Pi UI Bridge renderer maps `PiUiAction` + pending/settled
 * `ExtensionActionState` into this shape). Kept generic/protocol-agnostic so
 * this recipe never depends on `@picompanion/protocol` wire types.
 */
export interface TaskRowAction {
  id: string;
  label: string;
  kind?: ButtonKind;
  disabled?: boolean;
  /** True while this row's action is in flight; shows "Working\u2026" instead of `feedback`. */
  pending?: boolean;
  /** Settled outcome text (e.g. "Done", "Failed"), shown once no longer pending. */
  feedback?: string;
  /** `action.confirm` message, if any \u2014 surfaced as a `title` attribute (T29B5 owns the actual gate). */
  confirmMessage?: string;
  onSelect: () => void;
}

export interface TaskRowItem {
  id: string;
  title: string;
  status: TaskRowStatus;
  /** Secondary text for this row (T29B1), e.g. a roster row's `detail`. */
  detail?: string;
  progress?: TaskRowProgress;
  actions?: readonly TaskRowAction[];
}

export interface TaskRowsProps {
  items: readonly TaskRowItem[];
  ariaLabel: string;
  testId?: string;
}

const statusText: Record<TaskRowStatus, string> = {
  pending: "Pending",
  "in-progress": "In progress",
  blocked: "Blocked",
  done: "Done",
  failed: "Failed",
};

/** Clamps to `[0, 1]`; a non-positive or missing `max` degenerates to `0` rather than `NaN`/`Infinity`. */
function progressFraction(progress: TaskRowProgress): number | null {
  if (progress.indeterminate === true || progress.value === undefined) return null;
  if (progress.max === undefined) return Math.min(1, Math.max(0, progress.value));
  if (progress.max <= 0) return 0;
  return Math.min(1, Math.max(0, progress.value / progress.max));
}

function TaskRowActions({ title, actions }: { title: string; actions: readonly TaskRowAction[] }) {
  return (
    <div className="pc-task-row__actions" role="group" aria-label={`${title} actions`}>
      {actions.map((action) => (
        <span className="pc-task-row__action" key={action.id}>
          <Button
            kind={action.kind ?? "secondary"}
            disabled={action.disabled || action.pending}
            title={action.confirmMessage}
            onClick={action.onSelect}
          >
            {action.label}
          </Button>
          <span className="pc-task-row__action-state" aria-live="polite">
            {action.pending ? "Working\u2026" : (action.feedback ?? "")}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * TaskRows recipe (plan.md §10.4): a Pi-generated task/todo list with
 * per-row status (Pi's plan-mode task tracking; T29B1 additionally reuses
 * it for the `roster` kind's agent/role/key/task rows). Clean-specification
 * recipe (plan.md §10.1).
 *
 * Every field beyond `title`/`status` is optional so a plain `TaskRowItem`
 * (Pi's plan-mode todos) renders exactly as before \u2014 `detail`, `progress`,
 * and `actions` are additive, not a second variant (plan.md §10.2 "one
 * approved treatment").
 *
 * Accessibility (plan.md §10.5): an ordered list so screen readers
 * announce position/count; each row's status is visible text (not an
 * icon/colour alone), a done row is also marked up with strikethrough
 * styling backed by that same text (never colour alone), and per-row
 * actions sit in their own labelled `role="group"` with a live pending/
 * settled announcement, mirroring the shared element-actions row used by
 * every other Pi UI Bridge kind.
 */
export function TaskRows({ items, ariaLabel, testId }: TaskRowsProps) {
  return (
    <ol className="pc-task-rows" aria-label={ariaLabel} data-testid={testId}>
      {items.map((item) => {
        const fraction = item.progress ? progressFraction(item.progress) : undefined;
        return (
          <li key={item.id} className={`pc-task-row pc-task-row--${item.status}`}>
            <div className="pc-task-row__main">
              <span className="pc-task-row__marker" aria-hidden="true" />
              <span className="pc-task-row__title">{item.title}</span>
              <span className="pc-task-row__status">{statusText[item.status]}</span>
            </div>
            {item.detail ? <p className="pc-task-row__detail">{item.detail}</p> : null}
            {item.progress ? (
              <div className="pc-task-row__progress">
                <Progress label={`${item.title} progress`} value={fraction ?? null} />
              </div>
            ) : null}
            {item.actions && item.actions.length > 0 ? (
              <TaskRowActions title={item.title} actions={item.actions} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default TaskRows;
