/**
 * `progress` kind renderer (plan.md §11.3; T29A2) — "Determinate or
 * indeterminate work indicator", presented as a status/rail progress bar.
 *
 * The shared `Progress` primitive already conveys its percentage as visible
 * text alongside the bar (plan.md §10.5 "non-color status signalling"); this
 * renderer additionally surfaces the raw `value`/`max` pair as text when
 * both are known (e.g. "2 of 5"), since a percentage alone loses a step
 * count a workflow's progress is usually reported in.
 */
import type { PiUiElementRendererProps } from "../registry.js";
import { Progress } from "../../../ui/primitives/index.js";
import { ElementActionsRow } from "./element-actions.js";
import "./renderers.css";

/** Clamps to `[0, 1]`; `max <= 0` degenerates to `0` rather than `NaN`/`Infinity`. */
function clampFraction(value: number, max: number | undefined): number {
  if (max === undefined) return Math.min(1, Math.max(0, value));
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

export function ProgressRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"progress">) {
  const label = payload.label ?? element.title ?? "Progress";
  // A `value` without a `max` is not renderable as a fraction — `step` with
  // no `total` (e.g. `workflow:progress` before its total is known) would
  // otherwise fall through `clampFraction`'s `max === undefined` branch and
  // clamp the raw step count into `[0, 1]` directly, misreading e.g. step 2
  // as 100%. Treat a missing `max` as indeterminate too, so an absent total
  // still renders something truthful (a moving/unlabeled bar) instead of a
  // fabricated percentage.
  const isIndeterminate =
    payload.indeterminate === true || payload.value === undefined || payload.max === undefined;
  const fraction = isIndeterminate ? null : clampFraction(payload.value!, payload.max);
  const hasFractionText = payload.value !== undefined && payload.max !== undefined;

  return (
    <div className="pc-pi-progress" data-testid={`pi-progress-${element.ns}-${element.id}`}>
      <Progress label={label} value={fraction} />
      {hasFractionText ? (
        <p className="pc-pi-progress__fraction">
          <span className="pc-pi-progress__fraction-value">{payload.value}</span> of{" "}
          <span className="pc-pi-progress__fraction-value">{payload.max}</span>
        </p>
      ) : null}
      {payload.detail ? <p className="pc-pi-progress__detail">{payload.detail}</p> : null}
      <ElementActionsRow
        actions={element.actions}
        dispatchAction={dispatchAction}
        getActionState={getActionState}
        ariaLabel={`${label} actions`}
      />
    </div>
  );
}
