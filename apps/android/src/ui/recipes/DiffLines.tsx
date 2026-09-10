import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { asFontWeight } from "../theme/native-style-helpers";
import { useTheme } from "../theme/theme-context";
import {
  DIFF_LINE_PADDING_HORIZONTAL,
  DIFF_LINE_RADIUS,
  HIT_PADDING_HORIZONTAL,
  HIT_RADIUS,
  INVERTED_PADDING_HORIZONTAL,
  diffLineAnnouncement,
  diffLineInk,
  diffLineSurface,
  highlightHits,
  type DiffLineItem,
} from "./diff-lines-model";

export interface DiffLinesProps {
  /** Already paired and bounded by the caller — see `pairChangedLines`. */
  lines: readonly DiffLineItem[];
  /**
   * Announced for the whole list. Callers name the file, so TalkBack
   * hears "src/Button.tsx changed lines" rather than nine anonymous
   * bands.
   */
  accessibleName: string;
  testId?: string;
}

/**
 * DiffLines recipe (T358) — the artifact's `.dl add|rem|ctx` bands,
 * with `.inv` on the words that actually changed.
 *
 * Every decision this makes is in `./diff-lines-model.ts` and proven by
 * execution there: which tone a line is, which token its wash and its
 * text read from, and which middle span is inverted. This file is the
 * native mapping and nothing else, which is why it has no branching
 * beyond "is there a fill".
 *
 * **Colour is never the only signal.** Each band keeps its literal
 * `+`/`-`/` ` marker as visible text, and the row is one `accessible`
 * group whose label starts with the word `diffLineAnnouncement`
 * returns. A reader who cannot separate the green wash from the red one
 * still gets "Added: …" and "Removed: …" (plan.md §10.5).
 *
 * **The inverted span is decoration and is announced as nothing.** It
 * sits inside the row's own accessible group, so TalkBack reads the
 * line as one continuous string; a per-span announcement would chop a
 * line of code into three fragments and say "highlighted" in the middle
 * of an identifier. What changed is already carried by the pair of
 * bands being adjacent.
 *
 * **No scroll of its own.** A long diff is bounded by its caller before
 * it arrives here (`DEFAULT_DIFF_CHANGE_LINE_CAP`, or
 * `diffLinesFor`'s own cap), and nesting a vertical scroll inside the
 * transcript's vertical scroll is the gesture conflict this app has
 * already had to unpick once in the composer.
 */
export function DiffLines({ lines, accessibleName, testId }: DiffLinesProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View
      style={styles.list}
      accessibilityRole="none"
      accessibilityLabel={accessibleName}
      testID={testId}
    >
      {lines.map((line) => {
        const surface = diffLineSurface(line.tone);
        const ink = theme.colors[diffLineInk(line.tone)];
        const plain = line.spans.map((span) => span.text).join("");
        return (
          <View
            key={line.key}
            style={[
              styles.line,
              surface === null ? null : { backgroundColor: theme.colors[surface] },
            ]}
            accessible
            accessibilityLabel={`${diffLineAnnouncement(line.tone)}: ${line.marker}${plain}`}
            testID={testId ? `${testId}-${line.key}` : undefined}
          >
            <Text style={[styles.text, { color: ink }]} numberOfLines={4}>
              <Text style={styles.marker}>{line.marker}</Text>
              {line.spans.map((span, index) =>
                span.inverted ? (
                  <Text
                    key={index}
                    style={[styles.inverted, { backgroundColor: ink, color: theme.colors.surface }]}
                  >
                    {span.text}
                  </Text>
                ) : (
                  <Text key={index}>{span.text}</Text>
                ),
              )}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export interface MatchedLineProps {
  /** The matched line as the tool returned it. */
  text: string;
  /** The search term to mark. An empty one leaves the line whole. */
  query: string;
  testId?: string;
}

/**
 * One search result line with `mark.hit` on every occurrence of the
 * query (T358) — the artifact draws the match on `accent-highlight`, so
 * a result says WHERE it matched and not only that it did.
 *
 * Kept in this file rather than its own because it is the same idea as
 * `.inv` one file over: a run of text inside a mono line, drawn on a
 * token wash, decorative and inside its caller's accessible group.
 * `highlightHits` is the whole of its behaviour and is proven by
 * execution.
 */
export function MatchedLine({ text, query, testId }: MatchedLineProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const spans = highlightHits(text, query);

  return (
    <Text style={[styles.text, styles.matched]} testID={testId} numberOfLines={4}>
      {spans.map((span, index) =>
        span.hit ? (
          <Text
            key={index}
            style={[
              styles.hit,
              { backgroundColor: theme.colors["accent-highlight"], color: theme.colors.ink },
            ]}
          >
            {span.text}
          </Text>
        ) : (
          <Text key={index}>{span.text}</Text>
        ),
      )}
    </Text>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    list: { gap: 1 },
    line: {
      borderRadius: DIFF_LINE_RADIUS,
      paddingHorizontal: DIFF_LINE_PADDING_HORIZONTAL,
    },
    // The transcript's mono size and leading, per HANDOFF.md §7.1.
    text: {
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.code.fontSize,
      lineHeight: theme.typography.variant.code.lineHeight,
    },
    matched: { color: theme.colors["ink-2"] },
    marker: { fontWeight: asFontWeight(theme.typography.fontWeight.bold) },
    inverted: {
      borderRadius: HIT_RADIUS,
      paddingHorizontal: INVERTED_PADDING_HORIZONTAL,
    },
    hit: {
      borderRadius: HIT_RADIUS,
      paddingHorizontal: HIT_PADDING_HORIZONTAL,
    },
  });
}

export default DiffLines;
