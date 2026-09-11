/**
 * The redesign's todo widget (`HANDOFF.md` §7.2's `.ov`) — T360, moved
 * into the pinned slot above the prompt bar by this task.
 *
 * A thin native view over `./todo-row-model.ts`: which of three states
 * each item is in, which token its glyph and subject read from, the
 * ring's geometry and arc offset, the head's `Todos (n/m)` and the
 * announced sentence all live there and are proven by execution. This
 * file draws them.
 *
 * **It docks above the prompt bar, not in the transcript.** The
 * artifact puts this widget in `.ovslot` — the same pinned area the Pi
 * UI elements live in — because it is a standing summary of the whole
 * turn: the current task must stay readable at any scroll position,
 * which a transcript row cannot do. The session route mounts it there,
 * beside `PinnedLiveExtensionArea`, and `app-shell/session-transcript-
 * model.ts` no longer keeps `todo` entries in the transcript list.
 *
 * **The artifact's own `.ov` shape.** Quoting the artifact's CSS:
 * `.ov { border-radius: 12px; background: var(--surface); box-shadow:
 * var(--sh-card); padding: 8px 10px; margin-bottom: 8px }`,
 * `.ov-head { display: flex; align-items: center; gap: 8px; cursor:
 * pointer }`, `.ov-row { display: flex; gap: 8px; font-size: 11px;
 * line-height: 1.6 }`, `.ov-row .g { width: 11px; flex: none;
 * text-align: center }`, `.ov-hint { font-size: 10.5px }`. `Card`
 * already draws the tier `.ov`'s `--sh-card` names (`ringShadow`), so
 * the widget overrides only the radius and the padding.
 *
 * **The head is the collapse control.** `.ov.closed .ov-row,
 * .ov.closed .ov-hint { display: none }` and the artifact's line reads
 * "tap the ring to collapse" — so the head is a real `Pressable` with
 * `accessibilityRole="button"` and `accessibilityState.expanded`, which
 * is also what makes the collapse reachable without a tap on a 18dp
 * ring. That is local UI state, owned here and nowhere else.
 *
 * **Colour is never the only signal** (plan.md §10.5). Every row shows
 * its own glyph — `✓`, `◐`, `○`, three distinct marks, not three tints
 * of one — and the head prints the literal count. The ring is hidden
 * from assistive tech and the head announces
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
import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

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
/** `.ov { border-radius: 12px; padding: 8px 10px; margin-bottom: 8px }`. */
const OVERLAY_RADIUS = 12;
const OVERLAY_PADDING_VERTICAL = 8;
const OVERLAY_PADDING_HORIZONTAL = 10;
const OVERLAY_MARGIN_BOTTOM = 8;
/** `.ov-head .lab { font-size: 11px }` and `.ov-row { font-size: 11px }`. */
const BODY_FONT_SIZE = 11;
/** `.ov-row { line-height: 1.6 }`. */
const BODY_LINE_HEIGHT = BODY_FONT_SIZE * 1.6;
/** `.ov-row .g { width: 11px }` and `.ov-hint { font-size: 10.5px }`. */
const GLYPH_COLUMN_WIDTH = 11;
const HINT_FONT_SIZE = 10.5;

export interface TranscriptTodoRowProps {
  entry: TodoTranscriptEntry;
  testId?: string;
}

function TranscriptTodoRowImpl({ entry, testId }: TranscriptTodoRowProps) {
  const { theme } = useTheme();
  const styles = createStyles(theme);
  const [collapsed, setCollapsed] = useState(false);
  const progress = todoProgress(entry.items);
  const rows = buildTodoRows(entry.items);
  const headTint = theme.colors[todoHeadInk(progress)];

  return (
    <Card style={styles.card} testID={testId}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={todoAccessibilityLabel(entry.items)}
        accessibilityState={{ expanded: !collapsed }}
        onPress={() => setCollapsed((current) => !current)}
        style={styles.head}
        testID={testId ? `${testId}-head` : undefined}
      >
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
        <Text style={[styles.headLabel, { color: headTint }]}>
          {`${todoHeadGlyph(progress)} ${todoHeadline(progress)}`}
        </Text>
      </Pressable>
      {collapsed
        ? null
        : rows.map((row, index) => (
            <View key={`${index}-${row.subject}`} style={styles.row}>
              <Text
                style={[
                  styles.glyph,
                  styles.body,
                  { color: theme.colors[todoGlyphInk(row.state)] },
                ]}
              >
                {todoGlyph(row.state)}
              </Text>
              <Text
                style={[
                  styles.body,
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
      {collapsed ? null : (
        <Text style={[styles.hint, styles.dim]}>└─ tap the ring to collapse</Text>
      )}
    </Card>
  );
}

export const TranscriptTodoRow = memo(TranscriptTodoRowImpl);

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    card: {
      gap: theme.spacing[1],
      borderRadius: OVERLAY_RADIUS,
      paddingVertical: OVERLAY_PADDING_VERTICAL,
      paddingHorizontal: OVERLAY_PADDING_HORIZONTAL,
      marginBottom: OVERLAY_MARGIN_BOTTOM,
      // `.ovslot { padding: 0 12px }` — the widget sits in the pinned
      // slot, which has no inset of its own.
      marginHorizontal: theme.spacing[3],
    },
    // `.ov-head` is 18dp tall in the artifact; the head is the widget's
    // collapse control, and plan.md §9.3's 48dp touch floor applies to it
    // even though the reference draws a smaller box.
    head: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], minHeight: 48 },
    headLabel: {
      flex: 1,
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: BODY_FONT_SIZE,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    row: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[2] },
    body: { fontSize: BODY_FONT_SIZE, lineHeight: BODY_LINE_HEIGHT },
    glyph: { width: GLYPH_COLUMN_WIDTH, textAlign: "center" },
    subject: { flex: 1 },
    struck: { textDecorationLine: "line-through" },
    hint: { fontSize: HINT_FONT_SIZE },
    dim: { color: theme.colors["ink-3"] },
  });
}

export default TranscriptTodoRow;
