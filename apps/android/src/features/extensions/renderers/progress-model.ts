/**
 * `progress` kind render model (plan.md §11.3; T34A2) — "Determinate or
 * indeterminate work indicator".
 *
 * The §10.3 `Progress` primitive already renders its percentage as visible
 * text next to the bar and exposes `accessibilityRole="progressbar"` with
 * an `accessibilityValue` (plan.md §10.5 "non-colour status signalling"),
 * so this model's job is only to decide the label, whether the bar is
 * determinate, and whether a raw `value`/`max` step count ("2 of 5") is
 * available — a percentage alone loses the step count a workflow reports
 * its progress in.
 *
 * Identical semantics to the web renderer
 * (`apps/web/src/features/extensions/renderers/progress.tsx`), including
 * the two edge cases worth naming: a missing `value` is indeterminate even
 * without `indeterminate: true`, and an explicitly indeterminate payload
 * that still carries `value`/`max` shows the step count next to an
 * indeterminate bar rather than suppressing it.
 *
 * Kept free of any React Native import so it is unit testable in this
 * workspace (see `status-model.ts`'s note and `../registry.test.ts`).
 */
import type { PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import type { PiUiPayloadForKind } from "../registry";
import type { PiUiAnnouncedText } from "./status-model";

export interface PiUiProgressRenderModel {
  label: string;
  /** `Progress`'s `value` prop: `0`-`1`, or `null` while indeterminate. */
  value: number | null;
  /** The `value` of `max` step count, when both are known. */
  fraction: PiUiAnnouncedText | undefined;
  detail: PiUiAnnouncedText | undefined;
  actionsAccessibilityLabel: string;
}

/** Clamps to `[0, 1]`; `max <= 0` degenerates to `0` rather than `NaN`/`Infinity`. */
export function clampProgressFraction(value: number, max: number | undefined): number {
  if (max === undefined) return Math.min(1, Math.max(0, value));
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

export function buildProgressRenderModel(
  element: Pick<PiUiElement, "title">,
  payload: PiUiPayloadForKind<"progress">,
): PiUiProgressRenderModel {
  const label = payload.label ?? element.title ?? "Progress";
  const isIndeterminate = payload.indeterminate === true || payload.value === undefined;
  const value =
    isIndeterminate || payload.value === undefined
      ? null
      : clampProgressFraction(payload.value, payload.max);
  const fractionText =
    payload.value !== undefined && payload.max !== undefined
      ? `${payload.value} of ${payload.max}`
      : undefined;

  return {
    label,
    value,
    fraction: fractionText
      ? {
          text: fractionText,
          // The bar's own `accessibilityValue` reports a percentage; this
          // names which operation the step count belongs to, and is a
          // polite live region so an advancing step is announced without
          // stealing focus.
          accessibilityLabel: `${label}: ${fractionText}`,
          accessibilityLiveRegion: "polite",
        }
      : undefined,
    detail: payload.detail
      ? {
          text: payload.detail,
          accessibilityLabel: `${label} detail: ${payload.detail}`,
          accessibilityLiveRegion: "polite",
        }
      : undefined,
    actionsAccessibilityLabel: `${label} actions`,
  };
}
