/**
 * `roster` kind renderer (plan.md §11.3, §11.7; T34B1) — "Agents, roles,
 * keys, or tasks with per-row actions", the subagents fleet and
 * switchboard key list's shared presentation.
 *
 * The Android counterpart to `apps/web/src/features/extensions/renderers/
 * roster.tsx`: same composite `${element.id}#${row.id}` row-action routing
 * (that file's header comment explains why a row action is not folded into
 * `actionId`), built from the §10.3 `Card`/`Chip`/`Progress`/`Button`
 * primitives instead of the web `TaskRows` recipe — Android's `TaskRows`
 * recipe (`ui/recipes/TaskRows.tsx`) only models Pi's own four-state
 * plan-mode task list (no per-row detail/model/elapsed/actions), so a
 * roster composes primitives directly rather than forcing a shape that
 * does not fit, matching how `widget.tsx` already composes `Card`/`Chip`
 * rather than reusing a recipe built for something narrower.
 *
 * Every decision — row fields, state tone, the fleet-active predicate, and
 * each row action's pending/feedback state — lives in `roster-model.ts`
 * and is unit tested there; this file is the native mapping.
 *
 * TalkBack: each row is one `accessible` group whose label folds label,
 * state, model, elapsed time, detail, and "Selected" into one utterance
 * (React Native has no `<dt>`/`<dd>` association, so unglued `Text`
 * siblings would be swiped through as unrelated fragments — the same
 * reasoning `widget.tsx`'s row grouping documents). A row's state is never
 * colour alone: the state chip always carries its visible label text.
 * On-device announcement is unverified here (no emulator in this
 * workspace) and belongs to the T37 Maestro flows.
 */
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { PiUiRosterRow } from "@picompanion/protocol/pi-ui-bridge/schema";

import { Button, Card, Chip, Progress } from "../../../ui/primitives";
import { asFontWeight } from "../../../ui/theme/native-style-helpers";
import { useTheme } from "../../../ui/theme/theme-context";
import type { PiUiElementRendererProps } from "../registry";
import { ElementActionsRow } from "./element-actions";
import {
  buildRosterRenderModel,
  buildRosterRowActionsModel,
  type PiUiRosterRowModel,
} from "./roster-model";

type Styles = ReturnType<typeof createStyles>;

function RosterRow({
  elementId,
  row,
  wireRow,
  dispatchAction,
  getActionState,
  styles,
}: {
  elementId: string;
  row: PiUiRosterRowModel;
  wireRow: Pick<PiUiRosterRow, "actions">;
  dispatchAction: PiUiElementRendererProps<"roster">["dispatchAction"];
  getActionState: PiUiElementRendererProps<"roster">["getActionState"];
  styles: Styles;
}) {
  const actionsModel = buildRosterRowActionsModel(
    elementId,
    { id: row.key, actions: wireRow.actions },
    getActionState,
  );

  return (
    <View
      style={[styles.row, row.selected ? styles.rowSelected : null]}
      accessible
      accessibilityLabel={row.accessibilityLabel}
      testID={`pi-roster-row-${row.key}`}
    >
      <View style={styles.rowHeader}>
        <Text style={styles.rowLabel} numberOfLines={2}>
          {row.label}
        </Text>
        {row.stateLabel ? <Chip label={row.stateLabel} tone={row.tone} /> : null}
      </View>
      {row.model || row.elapsed ? (
        <View style={styles.rowMeta}>
          {row.model ? <Text style={styles.rowMetaText}>{row.model}</Text> : null}
          {row.elapsed ? (
            <Text
              style={styles.rowMetaText}
              accessibilityLiveRegion={row.elapsed.accessibilityLiveRegion}
              accessibilityLabel={row.elapsed.accessibilityLabel}
            >
              {row.elapsed.text}
            </Text>
          ) : null}
        </View>
      ) : null}
      {row.detail ? <Text style={styles.rowDetail}>{row.detail}</Text> : null}
      {row.progress ? (
        <Progress
          label={row.label}
          value={row.progress.value}
          testId={`pi-roster-row-${row.key}-progress`}
        />
      ) : null}
      {actionsModel.actions.length > 0 ? (
        <View style={styles.rowActions}>
          {actionsModel.actions.map((action) => (
            <View style={styles.rowAction} key={action.id}>
              <Button
                kind={action.kind}
                label={action.label}
                disabled={action.disabled}
                onPress={() => {
                  void dispatchAction(action.id, {
                    action: action.action,
                    elementId: actionsModel.rowElementId,
                  });
                }}
                testId={`pi-roster-row-${row.key}-action-${action.id}`}
              />
              {action.feedback ? (
                <Text
                  style={styles.rowMetaText}
                  accessibilityLiveRegion={action.feedback.accessibilityLiveRegion}
                  accessibilityLabel={action.feedback.accessibilityLabel}
                >
                  {action.feedback.text}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function RosterRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"roster">) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const model = buildRosterRenderModel(element, payload);
  const testId = `pi-roster-${element.ns}-${element.id}`;

  return (
    <Card style={styles.card} testID={testId} accessibilityState={{ busy: model.active }}>
      <Text style={styles.title} accessibilityRole="header">
        {model.title}
      </Text>
      {model.rows.length > 0 ? (
        <View style={styles.rows}>
          {model.rows.map((row, index) => (
            <RosterRow
              key={row.key}
              elementId={element.id}
              row={row}
              wireRow={payload.rows[index]!}
              dispatchAction={dispatchAction}
              getActionState={getActionState}
              styles={styles}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>{model.emptyText}</Text>
      )}
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
    card: { gap: theme.spacing[3] },
    title: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    rows: { gap: theme.spacing[3] },
    row: {
      gap: theme.spacing[1],
      paddingVertical: theme.spacing[2],
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    rowSelected: { backgroundColor: theme.colors.hover },
    rowHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing[2],
    },
    rowLabel: {
      flex: 1,
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
    },
    rowMeta: { flexDirection: "row", gap: theme.spacing[2] },
    rowMetaText: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    rowDetail: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    rowActions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
    rowAction: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
    empty: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.body.fontSize,
    },
  });
}
