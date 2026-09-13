import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button, SearchField } from "../../ui/primitives";
import { useTheme } from "../../ui/theme/theme-context";
import type { TranscriptSearchSnapshot } from "./transcript-search-model";

export interface TranscriptSearchBarProps {
  /** Everything the bar renders, from `transcriptSearchSnapshot`. */
  snapshot: TranscriptSearchSnapshot;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  testId?: string;
}

/**
 * Transcript find bar — the Android half of the shared transcript
 * search (`timeline.findTranscriptSearchMatches`,
 * `@picompanion/frontend-core`, via `transcript-search-model.ts`).
 *
 * A thin native view, deliberately logic-free: the query, the match
 * list, and the cursor all arrive ready-made in `snapshot`, and every
 * tap leaves through a callback the owner (`transcript-window.tsx`,
 * which holds the `FlatList` ref that scrolls to a match) supplies. The
 * field is the `SearchField` primitive, navigation the `Button`
 * primitive, and every colour/space/radius below a `theme.*` token
 * (repository invariant: no raw values in product code) — plan.md §10.3
 * composition, not a second search-field implementation.
 *
 * The count is a `Text` with `accessibilityLiveRegion="polite"` so a
 * narrowing query announces its new count to TalkBack, matching web's
 * `role="status"` count. The buttons are disabled (never hidden) with
 * no matches — the same "reasoned rejection, not a hidden affordance"
 * treatment the transcript's other gated controls use.
 */
export function TranscriptSearchBar({
  snapshot,
  onQueryChange,
  onNext,
  onPrevious,
  testId,
}: TranscriptSearchBarProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.bar} testID={testId}>
      <SearchField
        label="Search transcript"
        placeholder="Search transcript"
        value={snapshot.query}
        onChangeText={onQueryChange}
        testId={testId ? `${testId}-input` : undefined}
      />
      <View style={styles.nav}>
        {snapshot.statusText.length > 0 ? (
          <Text
            style={styles.count}
            accessibilityLiveRegion="polite"
            testID={testId ? `${testId}-count` : undefined}
          >
            {snapshot.statusText}
          </Text>
        ) : null}
        <Button
          kind="secondary"
          label="Previous match"
          onPress={onPrevious}
          disabled={!snapshot.hasMatches}
          testId={testId ? `${testId}-previous` : undefined}
        />
        <Button
          kind="secondary"
          label="Next match"
          onPress={onNext}
          disabled={!snapshot.hasMatches}
          testId={testId ? `${testId}-next` : undefined}
        />
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    bar: { gap: theme.spacing[2] },
    nav: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      flexWrap: "wrap",
    },
    count: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
      fontFamily: theme.typography.variant.caption.fontFamily,
    },
  });
}

export default TranscriptSearchBar;
