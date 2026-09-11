/**
 * `log` kind renderer (plan.md §11.3; T34A3) — "Streaming lines",
 * presented as a bounded, tail-following scroll region.
 *
 * The Android counterpart to `apps/web/src/features/extensions/renderers/
 * log.tsx`: a title, an optional truncation notice, then the visible
 * lines inside a scrollable region. `log-model.ts` owns every decision
 * (the tail cap, which lines are visible, the truncation wording) and is
 * unit tested; this file is the native mapping onto `ScrollView`/`Text`.
 *
 * "Bounded and scrollable": `log-model.ts` never hands this component more
 * than the effective tail's worth of lines (200 by default — the same
 * value as the web renderer's `DEFAULT_LOG_TAIL` since T226; see that
 * module's note), and those lines sit inside a height-capped `ScrollView`
 * rather than growing the page indefinitely.
 *
 * TalkBack: the title is a header, the region carries an
 * `accessibilityLabel` naming it as this element's output, and each line
 * is its own `Text` node so a screen reader can navigate line by line
 * instead of hearing the whole log as one utterance. On-device
 * announcement is unverified here (no emulator in this workspace) and
 * belongs to the T37 Maestro flows.
 */
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Chip } from "../../../ui/primitives";
import { useTheme } from "../../../ui/theme/theme-context";
import type { PiUiElementRendererProps } from "../registry";
import { ElementActionsRow } from "./element-actions";
import { buildLogRenderModel } from "./log-model";
import { piUiToneGlyph, piUiToneToPrimitiveTone, readPiUiElementTone, toneChipLabel } from "./tone";

/** Height cap that keeps a long log scrollable within its own region rather than the whole screen. */
const LOG_SCROLL_MAX_HEIGHT = 320;

export function LogRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"log">) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const model = buildLogRenderModel(element, payload);
  const testId = `pi-log-${element.ns}-${element.id}`;
  // E2: a tone-carrying log leads its first line with the severity glyph,
  // painted in the tone's colour. The chip beside the title keeps the
  // wording visible so the glyph is never the only signal (plan.md §10.5).
  const tone = readPiUiElementTone(element);
  const toneGlyph = piUiToneGlyph(tone);

  return (
    <View style={styles.wrapper} testID={testId}>
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header">
          {model.title}
        </Text>
        {tone ? (
          <Chip
            label={toneChipLabel(tone)}
            tone={piUiToneToPrimitiveTone(tone)}
            testId={`${testId}-tone`}
          />
        ) : null}
      </View>
      {model.truncatedNotice ? <Text style={styles.notice}>{model.truncatedNotice}</Text> : null}
      <ScrollView
        style={styles.scroll}
        accessibilityLabel={model.scrollAccessibilityLabel}
        testID={`${testId}-scroll`}
      >
        {model.visibleLines.length > 0 ? (
          model.visibleLines.map((line, index) => (
            // Log lines have no stable identity on the wire; index is the
            // best available key within one render of one payload, exactly
            // as on the web.
            <Text key={index} style={model.mono ? styles.lineMono : styles.line}>
              {index === 0 && toneGlyph ? (
                <Text style={{ color: theme.colors.status[toneGlyph.statusKey].foreground }}>
                  {`${toneGlyph.glyph} `}
                </Text>
              ) : null}
              {line}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>{model.emptyText}</Text>
        )}
      </ScrollView>
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
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    title: {
      flexShrink: 1,
      color: theme.colors.ink,
      fontSize: theme.typography.variant.label.fontSize,
    },
    notice: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    scroll: {
      // The well's own `codeBackground` fill, border, radius and padding
      // are gone: the `.blk.ext` wrapper (`registry-view.tsx`) IS the
      // surface now, and a second box inside it would draw two.
      maxHeight: LOG_SCROLL_MAX_HEIGHT,
    },
    line: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.bodySmall.fontSize,
    },
    lineMono: {
      color: theme.colors.code.codeForeground,
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.code.fontSize,
    },
    empty: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.bodySmall.fontSize,
    },
  });
}
