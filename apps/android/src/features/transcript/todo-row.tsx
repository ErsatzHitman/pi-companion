/**
 * The redesign's todo widget (`HANDOFF.md` §7.2's `.ov`) — T360.
 *
 * A thin native view over `./todo-row-model.ts`: which of three states
 * each item is in, which token its glyph and subject read from, the
 * ring's geometry and arc offset, the head's `Todos (n/m)` and the
 * announced sentence all live there and are proven by execution. This
 * file draws them.
 *
 * **Why it is a card and not a `.blk`.** The artifact gives this widget
 * `surface` plus `shadow-card` and a 14 radius — a raised panel rather
 * than one of the transcript's flat blocks — because a todo list is a
 * standing summary of the whole turn, not one thing that happened at
 * one moment. `Card`'s `ringShadow` already draws exactly that tier
 * (`ui/theme/native-style-helpers.ts`), so the widget reuses it rather
 * than restating a shadow.
 *
 * **Colour is never the only signal** (plan.md §10.5). Every row shows
 * its own glyph — `✓`, `◐`, `○`, three distinct marks, not three tints
 * of one — plus a `#n`, and the head prints the literal count. The ring
 * is hidden from assistive tech and the whole widget announces
 * `todoAccessibilityLabel`, which names the counts and the current
 * item's own words.
 *
 * **The artifact's `(form)` tag is not drawn**, and that is an
 * omission with a reason rather than an oversight: the wire's todo item
 * is `{ text, completed }` and carries nothing that says an item is
 * waiting on a form. Drawing the tag would mean inventing the
 * condition, and a badge that appears for the wrong rows is worse than
 * one that does not appear at all. If the daemon ever sends that fact,
 * the model gains a field and this file gains a `Text`.
 */
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "../../ui/primitives";
import { ProgressRing } from "../../ui/recipes";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import {
  RING_CIRCUMFERENCE,
  RING_RADIUS,
  RING_STROKE,
  buildTodoRows,
  ringDashOffset,
  ringInk,
  todoAccessibilityLabel,
  todoGlyph,
  todoGlyphInk,
  todoHeadGlyph,
  todoHeadInk,
  todoHeadline,
  todoProgress,
  todoSubjectInk,
  type TodoTranscriptEntry,
} from "./todo-row-model";

export type { TodoTranscriptEntry } from "./todo-row-model";
export { isTodoEntry } from "./todo-row-model";

/** The artifact's 18px ring box: `2r` plus the stroke it draws centred on that radius. */
const RING_SIZE = RING_RADIUS * 2 + RING_STROKE;

export interface TranscriptTodoRowProps {
  entry: TodoTranscriptEntry;
  testId?: string;
}

function TranscriptTodoRowImpl({ entry, testId }: TranscriptTodoRowProps) {
  const { theme } = useTheme();
  const styles = createStyles(theme);
  const progress = todoProgress(entry.items);
  const rows = buildTodoRows(entry.items);
  const headTint = theme.colors[todoHeadInk(progress)];

  return (
    <Card
      style={styles.card}
      accessible
      accessibilityLabel={todoAccessibilityLabel(entry.items)}
      testID={testId}
    >
      <View style={styles.head}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ProgressRing
            size={RING_SIZE}
            radius={RING_RADIUS}
            strokeWidth={RING_STROKE}
            circumference={RING_CIRCUMFERENCE}
            dashOffset={ringDashOffset(progress.fraction)}
            trackColor={theme.colors.inset}
            arcColor={theme.colors[ringInk(progress)]}
          />
        </View>
        <Text style={[styles.mono, styles.headLabel, { color: headTint }]}>
          {`${todoHeadGlyph(progress)} ${todoHeadline(progress)}`}
        </Text>
      </View>
      {rows.map((row) => (
        <View key={row.number} style={styles.row}>
          <Text style={[styles.mono, styles.connector]}>{row.connector}</Text>
          <Text style={[styles.mono, { color: theme.colors[todoGlyphInk(row.state)] }]}>
            {todoGlyph(row.state)}
          </Text>
          <Text style={[styles.mono, styles.number]}>{`#${row.number}`}</Text>
          <Text
            style={[
              styles.mono,
              styles.subject,
              { color: theme.colors[todoSubjectInk(row.state)] },
              row.struck ? styles.struck : null,
            ]}
            numberOfLines={2}
          >
            {row.subject}
          </Text>
        </View>
      ))}
    </Card>
  );
}

export const TranscriptTodoRow = memo(TranscriptTodoRowImpl);

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    card: { gap: theme.spacing[1] },
    head: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
    headLabel: { fontWeight: asFontWeight(theme.typography.variant.label.fontWeight) },
    row: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[2] },
    // The transcript's mono size and leading, per HANDOFF.md §7.1.
    mono: {
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.code.fontSize,
      lineHeight: theme.typography.variant.code.lineHeight,
    },
    connector: { color: theme.colors["ink-3"] },
    number: { color: theme.colors["ink-3"] },
    subject: { flex: 1 },
    struck: { textDecorationLine: "line-through" },
  });
}

export default TranscriptTodoRow;
