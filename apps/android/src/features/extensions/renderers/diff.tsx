/**
 * `diff` kind renderer (plan.md §11.3, §11.7; T34B3) — "Unified changes",
 * rendered as Android's documented **compact diff**
 * (`docs/pi-extension-compatibility.md` §4's kind table: "full diff /
 * compact diff" — web gets the full syntax-highlighted body,
 * `apps/web/src/features/extensions/renderers/diff.tsx`, T29B3; Android
 * gets this compact one).
 *
 * Every decision — parsing, add/remove counts, which lines count as
 * "changed", and the bounding ceiling — lives in `diff-model.ts` and is
 * unit tested there (see that module's doc comment for why "compact"
 * means only changed lines are ever mounted); this file is only the
 * native mapping onto `Card` + `DiffSummary` (`ui/recipes/DiffSummary.tsx`,
 * plan.md §10.4) plus a bounded, coloured line list, matching how
 * `roster.tsx` composes primitives/recipes directly for a kind that
 * doesn't reduce to one existing recipe.
 *
 * Counts use mono tabular figures via `DiffSummary` itself (Geist Mono,
 * `theme.typography.variant.code.fontFamily` — the repo's established
 * "tabular figures" treatment, see that recipe's own doc comment and
 * `PromptBar.tsx`/`ThinkingSection.tsx`'s identical notes); this file adds
 * no numeral of its own outside that recipe.
 *
 * Colour is never the only signal a line changed: every changed line
 * keeps its literal `+`/`-` marker as visible text (mirroring
 * `DiffSummary`'s own "never colour alone" note), and the whole row is one
 * `accessible` TalkBack group naming "Added"/"Removed" in words, not tone.
 * On-device announcement is unverified here (no emulator in this
 * workspace) and belongs to the T37 Maestro flows.
 */
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Card } from "../../../ui/primitives";
import { DiffSummary } from "../../../ui/recipes";
import { asFontWeight } from "../../../ui/theme/native-style-helpers";
import { useTheme } from "../../../ui/theme/theme-context";
import type { PiUiElementRendererProps } from "../registry";
import { ElementActionsRow } from "./element-actions";
import { buildDiffRenderModel, type PiUiDiffLineModel } from "./diff-model";

type Styles = ReturnType<typeof createStyles>;

/** Height cap that keeps a long changed-line list scrollable within its own region rather than the whole screen. */
const DIFF_SCROLL_MAX_HEIGHT = 320;

function DiffLineRow({ line, styles }: { line: PiUiDiffLineModel; styles: Styles }) {
  const added = line.kind === "add";
  return (
    <View
      style={[styles.line, added ? styles.lineAdded : styles.lineRemoved]}
      accessible
      accessibilityLabel={`${added ? "Added" : "Removed"}: ${line.content}`}
      testID={`diff-line-${line.key}`}
    >
      <Text style={[styles.marker, added ? styles.markerAdded : styles.markerRemoved]}>
        {line.marker}
      </Text>
      <Text style={styles.content} numberOfLines={4}>
        {line.content}
      </Text>
    </View>
  );
}

export function DiffRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"diff">) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const model = buildDiffRenderModel(element, payload);
  const testId = `pi-diff-${element.ns}-${element.id}`;

  return (
    <Card style={styles.card} testID={testId}>
      <Text style={styles.title} accessibilityRole="header">
        {model.title}
      </Text>
      <DiffSummary
        path={model.path}
        added={model.added}
        removed={model.removed}
        modified={model.modified}
        testId={`${testId}-summary`}
      />
      {model.truncatedNotice ? <Text style={styles.notice}>{model.truncatedNotice}</Text> : null}
      {model.visibleChangeLines.length > 0 ? (
        <ScrollView
          style={styles.scroll}
          accessibilityLabel={`${model.title} changed lines`}
          testID={`${testId}-scroll`}
        >
          {model.visibleChangeLines.map((line) => (
            <DiffLineRow key={line.key} line={line} styles={styles} />
          ))}
        </ScrollView>
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
    notice: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    scroll: {
      maxHeight: DIFF_SCROLL_MAX_HEIGHT,
      borderWidth: 1,
      borderColor: theme.colors.code.codeBorder,
      borderRadius: theme.radii.control,
    },
    line: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[1],
    },
    lineAdded: { backgroundColor: theme.colors.code.diffAddedBackground },
    lineRemoved: { backgroundColor: theme.colors.code.diffRemovedBackground },
    marker: {
      width: 12,
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.code.fontSize,
    },
    markerAdded: { color: theme.colors.code.diffAddedForeground },
    markerRemoved: { color: theme.colors.code.diffRemovedForeground },
    content: {
      flex: 1,
      color: theme.colors.code.codeForeground,
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.code.fontSize,
    },
    empty: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.body.fontSize,
    },
  });
}
