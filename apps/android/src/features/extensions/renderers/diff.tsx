/**
 * `diff` kind renderer (plan.md §11.3, §11.7; T34B3) — "Unified changes",
 * rendered as Android's documented **compact diff**
 * (plan.md §11.3's kind table: "full diff view" / "compact diff then full
 * screen" — web gets the full syntax-highlighted body,
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
 * Counts use mono tabular figures via `DiffSummary` itself (the mono family,
 * `theme.typography.variant.code.fontFamily` — the repo's established
 * "tabular figures" treatment, see that recipe's own doc comment and
 * `PromptBar.tsx`/`ThinkingSection.tsx`'s identical notes); this file adds
 * no numeral of its own outside that recipe.
 *
 * Colour is never the only signal a line changed: every changed line
 * keeps its literal `+`/`-` marker as visible text (mirroring
 * `DiffSummary`'s own "never colour alone" note), and the whole row is one
 * `accessible` TalkBack group naming "Added"/"Removed" in words, not tone.
 * Both of those now live in `ui/recipes/DiffLines.tsx` rather than in
 * this file (T358); the guarantee is unchanged and is proven by
 * `diffLineAnnouncement` in that recipe's own model.
 * On-device announcement is unverified here (no emulator in this
 * workspace) and belongs to the T37 Maestro flows.
 */
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";

import { Card } from "../../../ui/primitives";
import { DiffLines, DiffSummary, pairChangedLines } from "../../../ui/recipes";
import type { DiffLineInput } from "../../../ui/recipes";
import { asFontWeight } from "../../../ui/theme/native-style-helpers";
import { useTheme } from "../../../ui/theme/theme-context";
import type { PiUiElementRendererProps } from "../registry";
import { ElementActionsRow } from "./element-actions";
import { buildDiffRenderModel, type PiUiDiffLineModel } from "./diff-model";

/** Height cap that keeps a long changed-line list scrollable within its own region rather than the whole screen. */
const DIFF_SCROLL_MAX_HEIGHT = 320;

/**
 * T358: the changed lines are the redesign's own `.dl` bands.
 *
 * This file used to draw them itself — a flex row, a fixed 12dp marker
 * column, and a background from `theme.colors.code.diffAdded*`. That
 * was a fourth private drawing of a shape §7.2 gives once, exactly the
 * situation T356 resolved for `.blk`, so the geometry, the tone
 * mapping and the changed-word inversion now come from
 * `ui/recipes/DiffLines.tsx` and this file only maps its own model onto
 * that recipe's input.
 *
 * `pairChangedLines` still finds inverted spans here even though this
 * renderer is COMPACT and mounts no context lines: a removal and the
 * addition that replaced it stay adjacent after the context between
 * them is filtered out, which is exactly the pair it looks for. What is
 * lost is the ability to tell an adjacent-by-filtering pair from an
 * adjacent-in-the-file one — a heuristic misfiring inside a heuristic,
 * and still only decoration, per that model's own doc comment.
 */
function toDiffLineInputs(lines: readonly PiUiDiffLineModel[]): DiffLineInput[] {
  return lines.map((line) => ({
    key: String(line.key),
    tone: line.kind === "add" ? ("add" as const) : ("rem" as const),
    marker: line.marker,
    content: line.content,
  }));
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
        <ScrollView style={styles.scroll} testID={`${testId}-scroll`}>
          <DiffLines
            lines={pairChangedLines(toDiffLineInputs(model.visibleChangeLines))}
            accessibleName={`${model.title} changed lines`}
            testId="diff-line"
          />
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
    empty: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.body.fontSize,
    },
  });
}
