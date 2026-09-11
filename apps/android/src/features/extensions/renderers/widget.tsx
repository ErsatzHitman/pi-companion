/**
 * `widget` kind renderer (plan.md §11.3; T34A2) — "Persistent summary",
 * presented as a card (pinned near the composer once T34A4 places it).
 *
 * The Android counterpart to `apps/web/src/features/extensions/renderers/
 * widget.tsx`: the same rows/lines/text precedence and the same fallback
 * wording, built from the §10.3 `Card`/`Chip` primitives instead of a
 * `<dl>`. `widget-model.ts` owns every decision and is unit tested; this
 * file is the native mapping.
 *
 * TalkBack: the title is a header, and each labelled row is one `accessible`
 * group whose label folds the row's label, value, tone, and detail into a
 * single utterance — React Native has no `<dt>`/`<dd>` association, so
 * without the grouping a row would be swiped through as unrelated
 * fragments. A row's tone is always accompanied by its visible chip label,
 * never colour alone (plan.md §10.5). On-device announcement is unverified
 * here (no emulator in this workspace) and belongs to the T37 Maestro flows.
 */
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, Chip } from "../../../ui/primitives";
import { asFontWeight } from "../../../ui/theme/native-style-helpers";
import { useTheme } from "../../../ui/theme/theme-context";
import type { PiUiElementRendererProps } from "../registry";
import { ElementActionsRow } from "./element-actions";
import {
  buildWidgetRenderModel,
  padWidgetRowLabel,
  widgetRowLabelColumnLength,
  type PiUiWidgetBodyModel,
} from "./widget-model";

type Styles = ReturnType<typeof createStyles>;

function WidgetBody({ body, styles }: { body: PiUiWidgetBodyModel; styles: Styles }) {
  if (body.type === "rows") {
    // E3/E4 draw each key/value pair on ONE mono line with the key padded
    // to the block's longest label (`reason   completed · 9 turns · 71k`),
    // so every value in a block starts on the same column.
    const labelColumnLength = widgetRowLabelColumnLength(body.rows);
    return (
      <View style={styles.rows}>
        {body.rows.map((row) => (
          <View
            style={styles.row}
            key={row.key}
            accessible
            accessibilityLabel={row.accessibilityLabel}
          >
            <Text style={styles.rowLabel}>{padWidgetRowLabel(row.label, labelColumnLength)}</Text>
            <View style={styles.rowValue}>
              {row.value ? <Text style={styles.rowValueText}>{row.value}</Text> : null}
              {row.toneChipLabel ? <Chip label={row.toneChipLabel} tone={row.tone} /> : null}
              {row.detail ? <Text style={styles.rowDetail}>{row.detail}</Text> : null}
            </View>
          </View>
        ))}
      </View>
    );
  }
  if (body.type === "lines") {
    return (
      <View style={styles.lines}>
        {body.lines.map((line, index) => (
          // Lines have no stable identity on the wire; index is the best
          // available key, exactly as on the web.
          <Text style={styles.line} key={index}>
            {line}
          </Text>
        ))}
      </View>
    );
  }
  return <Text style={body.type === "empty" ? styles.empty : styles.text}>{body.text}</Text>;
}

export function WidgetRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"widget">) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const model = buildWidgetRenderModel(element, payload);
  const testId = `pi-widget-${element.ns}-${element.id}`;

  return (
    <Card style={styles.card} testID={testId}>
      <Text style={styles.title} accessibilityRole="header">
        {model.title}
      </Text>
      <WidgetBody body={model.body} styles={styles} />
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
    title: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    rows: { gap: theme.spacing[2] },
    // One line per row: the padded mono label, then the value.
    row: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[2] },
    rowLabel: {
      color: theme.colors["ink-2"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.code.fontSize,
    },
    rowValue: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: theme.spacing[2],
    },
    rowValueText: {
      flexShrink: 1,
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
    },
    rowDetail: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    lines: { gap: theme.spacing[1] },
    line: { color: theme.colors.ink, fontSize: theme.typography.variant.body.fontSize },
    text: { color: theme.colors.ink, fontSize: theme.typography.variant.body.fontSize },
    empty: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.body.fontSize,
    },
  });
}
