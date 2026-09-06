/**
 * `status` kind renderer (plan.md §11.3; T34A2) — "Glanceable state",
 * presented as a status line for the header/status strip.
 *
 * The Android counterpart to `apps/web/src/features/extensions/renderers/
 * status.tsx`: same meaning for the same element (plan.md §18.3), built
 * from the §10.3 `StatusIndicator` primitive rather than DOM markup. Every
 * decision it makes lives in `status-model.ts`, which is unit tested;
 * this file is the native mapping.
 *
 * TalkBack: `StatusIndicator` announces `"<namespace>: <status text>"` as a
 * polite live region (its dot is hidden from the tree, so state is never
 * colour alone), and the optional detail line announces politely on its
 * own. On-device announcement is unverified here — no emulator is
 * available in this workspace — and belongs to the T37 Maestro flows.
 */
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { StatusIndicator } from "../../../ui/primitives";
import { useTheme } from "../../../ui/theme/theme-context";
import type { PiUiElementRendererProps } from "../registry";
import { ElementActionsRow } from "./element-actions";
import { buildStatusRenderModel } from "./status-model";

export function StatusRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"status">) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const model = buildStatusRenderModel(element, payload);
  const testId = `pi-status-${element.ns}-${element.id}`;

  return (
    <View style={styles.wrapper} testID={testId}>
      <StatusIndicator
        label={model.label}
        tone={model.tone}
        statusText={model.statusText}
        testId={`${testId}-indicator`}
      />
      {model.detail ? (
        <Text
          style={styles.detail}
          accessibilityLiveRegion={model.detail.accessibilityLiveRegion}
          accessibilityLabel={model.detail.accessibilityLabel}
        >
          {model.detail.text}
        </Text>
      ) : null}
      <ElementActionsRow
        actions={element.actions}
        dispatchAction={dispatchAction}
        getActionState={getActionState}
        accessibilityLabel={model.actionsAccessibilityLabel}
        testIdPrefix={testId}
      />
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    wrapper: { gap: theme.spacing[1] },
    detail: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}
