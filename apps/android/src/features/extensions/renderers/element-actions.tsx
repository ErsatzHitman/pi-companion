/**
 * Shared element-level action row for the Android Pi UI Bridge renderers
 * (plan.md §11.3/§11.4; T34A2). An element's `actions` array is part of the
 * common envelope rather than any one payload shape, so `status`, `widget`,
 * and `progress` (and the later kinds) all render this one component
 * instead of repeating a button row each.
 *
 * The row itself is presentational: `element-actions-model.ts` decides
 * every label, role, disabled state, and announcement, and this file maps
 * that onto the §10.3 `Button` primitive. Pressing a `confirm`-bearing
 * action calls `dispatchAction` exactly like any other action;
 * `registry-view.tsx` is what gates it behind
 * `DangerousActionConfirmDialog` before anything reaches the daemon
 * (plan.md §12.3).
 *
 * Accessibility: the row is a non-focusable group (like `ChipGroup`) so
 * TalkBack lands on the buttons themselves, each already carrying
 * `accessibilityRole="button"` and a disabled `accessibilityState` from
 * `Button`. Each action's outcome sits next to it as a polite live region,
 * so "Working…" and then "Done"/"Failed" are announced without moving
 * focus.
 *
 * Two deliberate divergences from the web row
 * (`apps/web/src/features/extensions/renderers/element-actions.tsx`), both
 * platform differences rather than behaviour changes:
 *
 * 1. The outcome node is rendered only while there is an outcome to
 *    announce, where the web row keeps an empty `aria-live` span mounted at
 *    all times. A live region inserted into the DOM after the fact is not
 *    reliably announced by browser screen readers, which is why the web row
 *    pre-mounts it; on Android the announcement is driven by the parent's
 *    subtree change, so a conditionally mounted `accessibilityLiveRegion`
 *    node is the idiomatic — and announced — form. Keeping an empty `Text`
 *    mounted here would also add the row's `gap` after every idle button.
 * 2. A `confirm` message is not attached as a hover title — there is no
 *    hover on Android, and `DangerousActionConfirmDialog` states it at press
 *    time instead.
 * 3. The web row's `role="group"` + `aria-label` names the whole row to a
 *    screen reader. React Native has no group role, and a container that is
 *    itself `accessible` would swallow its buttons' own focus and press
 *    handling, so the row stays a non-focusable container: its
 *    `accessibilityLabel` is carried for parity and for view-hierarchy
 *    inspection, but TalkBack announces the buttons individually rather than
 *    the group name. Each button already carries the action's own label,
 *    which is the part that identifies what pressing it does.
 */
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { extensions } from "@picompanion/frontend-core";
import type { PiUiAction } from "@picompanion/protocol/pi-ui-bridge/schema";

import { Button } from "../../../ui/primitives";
import { useTheme } from "../../../ui/theme/theme-context";
import type { PiUiDispatchAction } from "../registry";
import { buildElementActionModels } from "./element-actions-model";

export interface ElementActionsRowProps {
  actions: readonly PiUiAction[] | undefined;
  dispatchAction: PiUiDispatchAction;
  getActionState: (actionId: string) => extensions.ExtensionActionState;
  /** Accessible name for the enclosing group, e.g. `"Deploy workflow actions"`. */
  accessibilityLabel: string;
  /** Per-action `testID`s become `${testIdPrefix}-action-${actionId}`. */
  testIdPrefix?: string;
}

export function ElementActionsRow({
  actions,
  dispatchAction,
  getActionState,
  accessibilityLabel,
  testIdPrefix,
}: ElementActionsRowProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const models = buildElementActionModels(actions, getActionState);

  if (models.length === 0) return null;

  return (
    <View
      style={styles.row}
      accessible={false}
      accessibilityRole="none"
      accessibilityLabel={accessibilityLabel}
    >
      {models.map((model) => (
        <View style={styles.action} key={model.id}>
          <Button
            kind={model.kind}
            label={model.label}
            disabled={model.disabled}
            onPress={() => {
              void dispatchAction(model.id, { action: model.action });
            }}
            testId={testIdPrefix ? `${testIdPrefix}-action-${model.id}` : undefined}
          />
          {model.feedback ? (
            <Text
              style={styles.feedback}
              accessibilityLiveRegion={model.feedback.accessibilityLiveRegion}
              accessibilityLabel={model.feedback.accessibilityLabel}
            >
              {model.feedback.text}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
    action: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
    feedback: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}
