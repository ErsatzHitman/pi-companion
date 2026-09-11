/**
 * plan.md §14.5 "transcript: 10,000 timeline items without rendering more
 * than a bounded window" (T33A6) — a thin native view over
 * `transcript-window-model.ts`'s RN-free reducer, exactly mirroring this
 * repository's established "all logic in a `-model.ts`, the `.tsx` only
 * wires it into the render tree" architecture (`message-row.tsx` over
 * `message-row-model.ts`, `thinking-row.tsx` over `thinking-row-model.ts`,
 * ...). See that model's module doc comment for the full design: the
 * bounded-window/O(window) guarantee, the stated flood policy, and the
 * follow-tail state machine this component drives.
 *
 * **Generic over the row kind on purpose.** This component has no
 * opinion on whether a row is a message, a thinking section, or a
 * tool-call card — `renderRow` is the caller's own per-kind switch.
 * **Mounted** (T32S10, P5-W14): `SessionTranscript` in
 * `app/h/[serverId]/session/[agentId]/index.tsx` now renders this
 * component in place of the plain, unwindowed `ScrollView` it used to
 * use, handing its existing per-kind switch straight through as
 * `renderRow` and `testId="session-transcript"` — so each row still
 * receives the identical `session-transcript-row-${entry.id}` string
 * this component composes as `${testId}-row-${item.id}`. The seam this
 * comment used to file against that route is closed.
 *
 * **`FlatList`, not `@shopify/flash-list`.** `@shopify/flash-list` is not
 * installed in this workspace (`ls node_modules/@shopify` finds nothing,
 * neither `package.json` declares it) and this task may not run `npm
 * install` — see this task's report for the exact command a future task
 * should run. `FlatList` already does its own native view-recycling for
 * whatever `data` it is handed; what it does **not** do on its own is
 * bound how large that `data` array is or track follow-tail/unread
 * state, which is exactly `transcript-window-model.ts`'s job — this
 * component always hands `FlatList` the *windowed* slice
 * (`snapshot.windowedEntries`), never the full `entries` prop.
 *
 * **Reachability for anything windowed out (plan.md §10.5).** Both edges
 * of the window have one explicit, always-visible, always-accessible
 * control — never a sighted-only scroll gesture with no screen-reader
 * equivalent: "Show N earlier messages" (`Button`, wired to
 * `expandOlder`) above the list for rows older than the window, and a
 * `Banner` with a "Jump to latest" action (wired to `returnToTail`)
 * below it for rows newer than the window while scrolled away from the
 * tail. `Button`/`Banner` (`../../ui/primitives`) already give TalkBack
 * the `button` role and an `accessibilityLiveRegion="polite"` region
 * respectively (see those files' own doc comments) — this component
 * supplies real, state-derived labels/counts to them, not a static
 * string.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  FlatList,
  StyleSheet,
  View,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { Banner, Button } from "../../ui/primitives";
import { BLOCK_GAP } from "../../ui/theme/block-shape";
import { useTheme } from "../../ui/theme/theme-context";
import {
  createTranscriptWindow,
  DEFAULT_TRANSCRIPT_WINDOW_CONFIG,
  type TranscriptScrollMetrics,
  type TranscriptWindow,
  type TranscriptWindowConfig,
  type TranscriptWindowEntry,
} from "./transcript-window-model";

export type { TranscriptWindowConfig, TranscriptWindowEntry } from "./transcript-window-model";
export {
  createTranscriptWindow,
  DEFAULT_TRANSCRIPT_WINDOW_CONFIG,
  isNearBottom,
} from "./transcript-window-model";

export interface TranscriptWindowListProps<T extends TranscriptWindowEntry> {
  /** The full, authoritative, time-ordered entries (e.g.
   * `buildSessionTranscriptEntries(coreTimeline.buildTranscriptEntries(batcher.getState()))`).
   * This component bounds *how many* of these are mounted; it never
   * narrows *which kinds* are in the list — that filtering stays the
   * caller's own job, same as today. */
  entries: readonly T[];
  /** Renders one already-windowed entry. Receives the same
   * `${testId}-row-${entry.id}` convention `SessionTranscript` already
   * uses today, so accessible names and content are unchanged — only how
   * many rows exist in the tree at once changes. */
  renderRow: (entry: T, testId: string) => ReactElement | null;
  config?: TranscriptWindowConfig;
  testId?: string;
}

function metricsFromScrollEvent(
  event: NativeSyntheticEvent<NativeScrollEvent>,
): TranscriptScrollMetrics {
  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
  return {
    contentOffsetY: contentOffset.y,
    contentHeight: contentSize.height,
    viewportHeight: layoutMeasurement.height,
  };
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: { flex: 1, gap: theme.spacing[2] },
    list: { flex: 1 },
    // The artifact's `.t { padding: 12px 12px 4px; gap: 9px }` — the
    // transcript's own inset and the space between its blocks.
    listContent: {
      gap: BLOCK_GAP,
      paddingHorizontal: theme.spacing[3],
      paddingTop: theme.spacing[3],
      paddingBottom: theme.spacing[1],
    },
  });
}

export function TranscriptWindowList<T extends TranscriptWindowEntry>({
  entries,
  renderRow,
  config = DEFAULT_TRANSCRIPT_WINDOW_CONFIG,
  testId,
}: TranscriptWindowListProps<T>) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const windowRef = useRef<TranscriptWindow<T> | null>(null);
  if (!windowRef.current) {
    windowRef.current = createTranscriptWindow<T>(config);
  }
  const listRef = useRef<FlatList<T> | null>(null);

  const [snapshot, setSnapshot] = useState(() => windowRef.current!.applyEntries(entries));

  useEffect(() => {
    const next = windowRef.current!.applyEntries(entries);
    setSnapshot(next);
    if (next.shouldScrollToTail) {
      listRef.current?.scrollToEnd({ animated: false });
    }
    // `entries` is the only real dependency -- `windowRef` is a ref and
    // never changes identity across this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setSnapshot(windowRef.current!.onScroll(metricsFromScrollEvent(event)));
  };

  const handleScrollBeginDrag = () => {
    setSnapshot(windowRef.current!.setScrolling(true));
  };

  const handleScrollEndDrag = () => {
    setSnapshot(windowRef.current!.setScrolling(false));
  };

  const handleMomentumScrollEnd = () => {
    setSnapshot(windowRef.current!.setScrolling(false));
  };

  const handleShowEarlier = () => {
    setSnapshot(windowRef.current!.expandOlder());
  };

  const handleJumpToTail = () => {
    const next = windowRef.current!.returnToTail();
    setSnapshot(next);
    if (next.shouldScrollToTail) {
      listRef.current?.scrollToEnd({ animated: false });
    }
  };

  const renderItem: ListRenderItem<T> = ({ item }) =>
    renderRow(item, testId ? `${testId}-row-${item.id}` : `transcript-window-row-${item.id}`);

  return (
    <View style={styles.container} testID={testId}>
      {snapshot.hiddenOlderCount > 0 ? (
        <Button
          kind="secondary"
          label={`Show ${snapshot.hiddenOlderCount} earlier message${snapshot.hiddenOlderCount === 1 ? "" : "s"}`}
          onPress={handleShowEarlier}
          testId={testId ? `${testId}-show-earlier` : undefined}
        />
      ) : null}
      <FlatList<T>
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={snapshot.windowedEntries as T[]}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        testID={testId ? `${testId}-list` : undefined}
      />
      {snapshot.unreadCount > 0 ? (
        <Banner
          tone="info"
          message={`${snapshot.unreadCount} new message${snapshot.unreadCount === 1 ? "" : "s"}`}
          actionLabel="Jump to latest"
          onAction={handleJumpToTail}
          testId={testId ? `${testId}-unread-banner` : undefined}
        />
      ) : null}
    </View>
  );
}

export default TranscriptWindowList;
