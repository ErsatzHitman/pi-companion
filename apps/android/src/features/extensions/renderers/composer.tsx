/**
 * `composer` kind renderer (plan.md §11.3; T34A3) — "Replace or prefill
 * draft", presented as a proposed-draft preview card. Example: the
 * `prompt-arbitrage` extension rewriting the composer draft (plan.md
 * §11.7).
 *
 * The Android counterpart to `apps/web/src/features/extensions/renderers/
 * composer.tsx`: the same mode label and the same "what it would replace"
 * disclosure, built from the §10.3 `Card`/`Chip` primitives.
 * `composer-model.ts` owns every decision and is unit tested; this file is
 * the native mapping.
 *
 * Actually applying the accepted text to the live composer input is not
 * this renderer's concern — see `composer-model.ts`'s note. The element's
 * `accept`/`undo` actions still dispatch normally through the shared
 * action row.
 */
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, Chip } from "../../../ui/primitives";
import { asFontWeight } from "../../../ui/theme/native-style-helpers";
import { useTheme } from "../../../ui/theme/theme-context";
import type { PiUiElementRendererProps } from "../registry";
import { buildComposerRenderModel } from "./composer-model";
import { ElementActionsRow } from "./element-actions";

export function ComposerRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"composer">) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const model = buildComposerRenderModel(element, payload);
  const testId = `pi-composer-${element.ns}-${element.id}`;

  return (
    <Card style={styles.card} testID={testId}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {model.title}
        </Text>
        <Chip label={model.modeLabel} tone="info" />
      </View>
      <Text style={styles.proposed}>{model.proposedText}</Text>
      {model.previousText !== undefined ? (
        <View style={styles.previous}>
          <Text style={styles.previousLabel}>Current draft</Text>
          <Text style={styles.previousText}>{model.previousText || "(empty)"}</Text>
        </View>
      ) : null}
      <ElementActionsRow
        actions={element.actions}
        dispatchAction={dispatchAction}
        getActionState={getActionState}
        accessibilityLabel={model.actionsAccessibilityLabel}
        testIdPrefix={testId}
      />
    </Card>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    card: { gap: theme.spacing[2] },
    header: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
    title: {
      flex: 1,
      color: theme.colors.ink,
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    proposed: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      lineHeight: theme.typography.variant.body.lineHeight,
    },
    previous: {
      gap: theme.spacing[1],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.line,
      paddingTop: theme.spacing[2],
    },
    previousLabel: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    previousText: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.bodySmall.fontSize,
    },
  });
}
