/**
 * `progress` kind renderer (plan.md §11.3; T34A2) — "Determinate or
 * indeterminate work indicator", presented as a progress bar for the
 * status strip.
 *
 * The Android counterpart to `apps/web/src/features/extensions/renderers/
 * progress.tsx`, built from the §10.3 `Progress` primitive. That primitive
 * already renders the percentage as visible text and collapses its
 * indeterminate sweep under reduced motion (plan.md §10.5); this renderer
 * adds the raw `value`/`max` step count ("2 of 5") when both are known,
 * since a percentage alone loses the step count a workflow reports in.
 * `progress-model.ts` owns every decision and is unit tested.
 *
 * TalkBack: `Progress` exposes `accessibilityRole="progressbar"` with an
 * `accessibilityValue` (a 0-100 `now` when determinate, the "In progress"
 * text while indeterminate), and the step count and detail lines are polite
 * live regions so an advancing step is announced without stealing focus.
 * On-device announcement is unverified here (no emulator in this
 * workspace) and belongs to the T37 Maestro flows.
 */
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Progress } from "../../../ui/primitives";
import { useTheme } from "../../../ui/theme/theme-context";
import type { PiUiElementRendererProps } from "../registry";
import { ElementActionsRow } from "./element-actions";
import { buildProgressRenderModel } from "./progress-model";

export function ProgressRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"progress">) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const model = buildProgressRenderModel(element, payload);
  const testId = `pi-progress-${element.ns}-${element.id}`;

  return (
    <View style={styles.wrapper} testID={testId}>
      <Progress label={model.label} value={model.value} testId={`${testId}-bar`} />
      {model.fraction ? (
        <Text
          style={styles.fraction}
          accessibilityLiveRegion={model.fraction.accessibilityLiveRegion}
          accessibilityLabel={model.fraction.accessibilityLabel}
        >
          {model.fraction.text}
        </Text>
      ) : null}
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
    // The step count is a counter, so it takes the mono family
    // (docs/beautiful-ui-reference.md's rule for numerals on counters),
    // matching the primitive's percentage readout. T367: this used to
    // quote that document's own "Geist Mono", a face name that has been
    // wrong on Android since T345 swapped the mono face to JetBrains
    // Mono — the last of the seven sites `HANDOFF.md` §9.3 listed, six
    // of which T356 swept.
    fraction: {
      color: theme.colors["ink-2"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    detail: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}
