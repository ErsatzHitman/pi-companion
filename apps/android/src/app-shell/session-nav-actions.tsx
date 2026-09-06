/**
 * Lives in `app-shell/`, not the Expo Router root — see
 * `./compact-shell-slots.ts`'s doc comment (T32S2).
 *
 * T79: the in-app control that reaches the files and terminal routes —
 * see `./session-nav-actions-model.ts`'s doc comment for the full gap
 * this closes (`../maestro/files-and-terminal.yaml` names it, and asks
 * the task that next edits `../app/h/[serverId]/session/[agentId]/
 * index.tsx` to add it). Mounted as a sibling of `TranscriptHeader`
 * inside that route's `header` slot — §9.2 "Files and terminal are
 * dedicated routes rather than squeezed beside chat" keeps them out of
 * `CompactSessionShell`'s own slot vocabulary (`compact-shell.tsx`'s doc
 * comment), so this renders as ordinary header content, not a shell
 * slot of its own.
 *
 * `Button` (`../ui/primitives`) rather than `IconButton`: both already
 * give the outer `Pressable` a full 48dp hit target (plan.md §9.3;
 * `Button.tsx`/`IconButton.tsx`'s own doc comments), but `IconButton`
 * needs a new glyph in `../ui/primitives/icons.tsx` for "files"/
 * "terminal" that the web primitive layer's matching `IconName` union
 * does not have (`icons.tsx`'s own doc comment: "matching the web
 * primitive layer's `IconName` union") — out of this Android-only task's
 * scope to add on both platforms. `Button`'s own `accessibilityLabel`
 * is its visible `label` text (`Button.tsx`), so TalkBack announces
 * "Files"/"Terminal" with no extra wiring here.
 *
 * `pressSessionFiles`/`pressSessionTerminal` (`./session-nav-actions-
 * model.ts`) own the actual navigation decision and are the only pieces
 * this file's own test suite proves behaviourally — this component is a
 * thin thread-through, proven instead by
 * `./session-nav-actions.test.ts`'s anchored source-text assertions
 * (this file imports `react-native`/`expo-router`, so it cannot run
 * directly under this workspace's plain `vitest` setup — see this
 * repository's `CLAUDE.md`).
 *
 * Reaching either route with no live daemon connection lands honestly:
 * `FilesScreen`'s own "Not connected" `ErrorState` and `TerminalScreen`'s
 * own "Terminal unavailable" `EmptyState` are unchanged by this file —
 * this component only supplies the tap that gets a user there, never a
 * connection check of its own that could show a third, competing state.
 */
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "../ui/primitives";
import { useTheme } from "../ui/theme/theme-context";
import { pressSessionFiles, pressSessionTerminal } from "./session-nav-actions-model";

export interface SessionNavActionsProps {
  serverId: string;
  agentId: string;
  testId?: string;
}

export function SessionNavActions({
  serverId,
  agentId,
  testId = "session-nav-actions",
}: SessionNavActionsProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.row} testID={testId}>
      <Button
        kind="secondary"
        label="Files"
        onPress={() => pressSessionFiles(router, serverId, agentId)}
        testId={`${testId}-files`}
      />
      <Button
        kind="secondary"
        label="Terminal"
        onPress={() => pressSessionTerminal(router, serverId, agentId)}
        testId={`${testId}-terminal`}
      />
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      gap: theme.spacing[2],
      marginTop: theme.spacing[2],
    },
  });
}
