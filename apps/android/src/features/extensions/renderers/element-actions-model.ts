/**
 * Render model for one element's `actions` row (plan.md §11.3/§11.4; T34A2).
 *
 * Every kind's envelope carries the same optional `actions` array, so the
 * button row is shared rather than re-derived per kind — the same split the
 * web renderers make (`apps/web/src/features/extensions/renderers/
 * element-actions.tsx`). This module holds the RN-free half: which
 * `Button` role each action takes, whether it is disabled because a
 * dispatch is in flight, and the feedback text TalkBack announces when one
 * settles.
 *
 * Dangerous (`confirm`-bearing) actions are pressable here exactly like
 * any other action (T29B5 on the web, `registry-view.tsx` on Android):
 * `dispatchAction` is what gates them behind
 * `DangerousActionConfirmDialog` before anything is sent (plan.md §12.3's
 * "platform confirmation if required" step), so nothing in this model
 * disables or hides them.
 */
import type { extensions } from "@picompanion/frontend-core";
import type { PiUiAction } from "@picompanion/protocol/pi-ui-bridge/schema";

import type { PiUiAnnouncedText } from "./status-model";

/**
 * Mirrors the `Button` primitive's `ButtonKind` without importing it —
 * `Button.tsx` reaches `react-native`, and this module must stay
 * importable by a unit test in this workspace. `element-actions.tsx`
 * passes these straight to `Button`, so a divergence is a type error
 * there.
 */
export type PiUiActionButtonKind = "primary" | "secondary" | "danger";

export interface PiUiActionButtonModel {
  id: string;
  label: string;
  kind: PiUiActionButtonKind;
  /** `true` only while this action's own dispatch is in flight. */
  disabled: boolean;
  /** The wire action, passed back through `dispatchAction` for the confirm gate. */
  action: PiUiAction;
  /** "Working…" while pending, then the settled outcome; absent when idle. */
  feedback: PiUiAnnouncedText | undefined;
}

const BUTTON_KIND: Record<NonNullable<PiUiAction["variant"]>, PiUiActionButtonKind> = {
  primary: "primary",
  secondary: "secondary",
  danger: "danger",
};

/** Visible/announced outcome text, matching the web row's wording exactly. */
export function actionFeedbackText(state: extensions.ExtensionActionState): string | undefined {
  switch (state.status) {
    case "pending":
      return "Working…";
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

/**
 * Builds one model per action, in wire order. An element with no actions
 * yields an empty array, which is how `element-actions.tsx` knows to render
 * nothing at all rather than an empty row.
 */
export function buildElementActionModels(
  actions: readonly PiUiAction[] | undefined,
  getActionState: (actionId: string) => extensions.ExtensionActionState,
): PiUiActionButtonModel[] {
  if (!actions || actions.length === 0) return [];
  return actions.map((action) => {
    const state = getActionState(action.id);
    const feedbackText = actionFeedbackText(state);
    return {
      id: action.id,
      label: action.label,
      kind: BUTTON_KIND[action.variant ?? "secondary"],
      disabled: state.status === "pending",
      action,
      feedback: feedbackText
        ? {
            text: feedbackText,
            accessibilityLabel: `${action.label}: ${feedbackText}`,
            accessibilityLiveRegion: "polite",
          }
        : undefined,
    };
  });
}
