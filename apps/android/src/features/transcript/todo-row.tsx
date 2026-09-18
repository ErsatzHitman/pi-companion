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
 * **The artifact's own `.ov` shape, corrected (T360 follow-up).** The
 * paragraph this replaces quoted four rules that do not exist in the
 * confirmed spec (`C:/Users/aksha/Downloads/pi-ui-goal/android-spec.html`,
 * md5 `498c3bd3…`; `docs/ui-reference/pi-companion-app.html` genuinely
 * differs from it, md5 `3ff70c21…`, so it is never cited here — and
 * CLAUDE.md's "Reference-only documents" list does not cover
 * `docs/ui-reference/` at all, so it never governed this file either):
 * `.ov-row { font-size: 11px; line-height: 1.6 }`, `.ov-hint { font-size:
 * 10.5px }`, `.ov-head .lab { font-size: 11px }`, and `.ov-row .g { width:
 * 11px }` — measured directly (`grep -o '\.ov-row \.g{[^}]*}'` on the
 * spec returns nothing; the other three resolve to different rules
 * below). The real rules: `.ov{margin:0 10px 6px;padding:8px 12px
 * 9px;border-radius:var(--r-blk);background:var(--surface);box-shadow:
 * var(--shadow-card);font:12.5px/1.62 'JetBrains Mono',ui-monospace,
 * monospace}` (`--r-blk` resolves to `14px`; the old `--sh-card` name
 * was also wrong, the token is `--shadow-card`), `.ov-head{font-weight:
 * 700;margin-bottom:1px}`, `.ov-row{border-radius:6px;margin:0
 * -4px;padding:0 4px}` (no font of its own), `.ov-hint{display:none}`
 * (shown only via `.ov.closed .ov-hint{display:block}`). Neither
 * `.ov-row` nor `.ov-hint` sets a font, so both read `.ov`'s own
 * 12.5px/1.62 JetBrains Mono — the head's own `<span class="lab">` is
 * the one exception, styled by a real, separate `.lab{font-size:12px;
 * line-height:1.25}` rule that overrides the inherited size for that
 * element specifically (confirmed: no `.ov-head .lab` descendant rule
 * exists, but a bare `.lab` class rule does, and the head's markup
 * carries that class directly). `Card` already draws the tier `.ov`'s
 * `--shadow-card` names (`ringShadow`), so the widget overrides only
 * the radius, the padding and the bottom margin.
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
/**
 * `.ov{margin:0 10px 6px;padding:8px 12px 9px;border-radius:var(--r-blk)}`
 * (`--r-blk` measured as `14px`). The padding is asymmetric — 8 top, 12
 * each side, 9 bottom — which is why it is three constants below, not
 * one `paddingVertical`.
 */
const OVERLAY_RADIUS = 14;
const OVERLAY_PADDING_TOP = 8;
const OVERLAY_PADDING_HORIZONTAL = 12;
const OVERLAY_PADDING_BOTTOM = 9;
const OVERLAY_MARGIN_BOTTOM = 6;
/**
 * `.ov`'s own `font:12.5px/1.62 'JetBrains Mono',ui-monospace,monospace`.
 * Neither `.ov-row{border-radius:6px;margin:0 -4px;padding:0 4px}` nor
 * `.ov-hint{display:none}` declares a font, so this is what every row
 * and the hint line actually render at — see the file header for the
 * four phantom citations (`.ov-row`'s and `.ov-hint`'s own font-sizes,
 * plus `.ov-head .lab`) this replaces.
 */
const BODY_FONT_SIZE = 12.5;
/** `.ov`'s `1.62` line-height, applied at `BODY_FONT_SIZE`. */
const BODY_LINE_HEIGHT = BODY_FONT_SIZE * 1.62;
/**
 * The head's own `<span class="lab">` is styled by a real, separate
 * `.lab{font-size:12px;line-height:1.25}` rule (measured: exactly one
 * such rule in the spec, and no `.ov-head .lab` descendant rule at all)
 * that overrides `.ov`'s inherited size for that element specifically.
 */
const HEAD_LABEL_FONT_SIZE = 12;
const HEAD_LABEL_LINE_HEIGHT = HEAD_LABEL_FONT_SIZE * 1.25;
/**
 * No `.ov-row .g` rule exists (measured: `grep -o '\.ov-row \.g{[^}]*}'`
 * on the spec returns nothing) — the artifact draws each row's glyph as
 * a plain inline character with no dedicated column. This is a layout
 * choice, not a citation: wide enough to hold `✓`/`◐`/`○` without the
 * subject text reflowing under it.
 */
const GLYPH_COLUMN_WIDTH = 11;

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
        <Text style={[styles.body, styles.dim]}>└─ tap the ring to collapse</Text>
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
      paddingTop: OVERLAY_PADDING_TOP,
      paddingBottom: OVERLAY_PADDING_BOTTOM,
      paddingHorizontal: OVERLAY_PADDING_HORIZONTAL,
      marginBottom: OVERLAY_MARGIN_BOTTOM,
      // No `.ovslot` padding rule exists (measured: `.ovslot{flex:none}`,
      // `.ovslot{transition:opacity .55s ease}`, `.ovslot.fade{opacity:0}`
      // — the earlier "`.ovslot { padding: 0 12px }`" quote here was a
      // fifth phantom citation this file carried, of the same class the
      // header above now documents). This inset is an implementation
      // choice, not a citation.
      marginHorizontal: theme.spacing[3],
    },
    // `.ov-head` is 18dp tall in the artifact; the head is the widget's
    // collapse control, and plan.md §9.3's 48dp touch floor applies to it
    // even though the reference draws a smaller box.
    head: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], minHeight: 48 },
    headLabel: {
      flex: 1,
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: HEAD_LABEL_FONT_SIZE,
      lineHeight: HEAD_LABEL_LINE_HEIGHT,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    row: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[2] },
    body: {
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: BODY_FONT_SIZE,
      lineHeight: BODY_LINE_HEIGHT,
    },
    glyph: { width: GLYPH_COLUMN_WIDTH, textAlign: "center" },
    subject: { flex: 1 },
    struck: { textDecorationLine: "line-through" },
    dim: { color: theme.colors["ink-3"] },
  });
}

export default TranscriptTodoRow;
