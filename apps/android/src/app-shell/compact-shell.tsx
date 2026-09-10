import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { useTheme } from "../ui/theme/theme-context";
import type { CompactShellSlots } from "./compact-shell-slots";
import { useKeyboardInset } from "./keyboard-inset";

export type { CompactShellSlots } from "./compact-shell-slots";
export { COMPACT_SHELL_SLOT_ORDER } from "./compact-shell-slots";

/**
 * Lives in `app-shell/`, not the Expo Router root — see
 * `./compact-shell-slots.ts`'s doc comment (T32S2).
 *
 * The plan.md §9.2 compact session layout, as a named-slot container —
 * T32S1 ("Build the Android navigation shell").
 *
 * §9.2: "The Android session screen is one primary transcript with:
 * host/session session header; compact status strip; pinned live
 * extension area above the composer; virtualized transcript; bottom
 * composer with prominent microphone and attachment actions." This
 * component is exactly that shape and nothing more — it owns slot
 * ordering and the structural chrome (dividers, the pinned-to-bottom
 * composer, the extension area collapsing away when idle) and takes no
 * opinion on what fills each slot.
 *
 * Every slot is optional and defaults to `null`, so
 * `<CompactSessionShell />` alone renders the empty shell this task's
 * acceptance criterion asks for ("The shell renders with empty slots").
 * Later Phase 5 tasks fill them without touching this file:
 *
 * - `header`        — T33A1 (compact transcript header)
 * - `statusStrip`   — T33A1 (compact status strip)
 * - `liveExtension` — the extensions/subagent-fleet feature tasks; only
 *                      rendered while there is something pinned (§9.2
 *                      "remains pinned while active" implies it collapses
 *                      away otherwise, unlike the always-present header/
 *                      status/composer regions)
 * - `transcript`    — the timeline/transcript feature tasks; the one
 *                      region that grows to fill remaining height
 * - `composer`      — T33B1 (bottom composer)
 *
 * Files and terminal are deliberately not slots here: §9.2 "Files and
 * terminal are dedicated routes rather than squeezed beside chat" — they
 * are separate Expo Router destinations (T32S1C), not part of this
 * screen's layout.
 */
export function CompactSessionShell({
  header = null,
  statusStrip = null,
  liveExtension = null,
  transcript = null,
  composer = null,
}: CompactShellSlots) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // T329: under edge-to-edge the window never resizes around the IME, so
  // the shell pads its own bottom by the keyboard's height — that is what
  // keeps the composer "visible above the IME" (plan.md §9.3). See
  // `./keyboard-inset.ts` for the measurement this rests on.
  const keyboardInset = useKeyboardInset();

  return (
    <View style={[styles.shell, { paddingBottom: keyboardInset }]} testID="compact-shell">
      <View style={styles.header} testID="compact-shell-header">
        {header}
      </View>
      <View style={styles.statusStrip} testID="compact-shell-status-strip">
        {statusStrip}
      </View>
      {/* The one flexible region: grows to fill whatever the header, status
       * strip, extension area, and composer don't use. */}
      <View style={styles.transcript} testID="compact-shell-transcript">
        {transcript}
      </View>
      {/* §9.2 "pinned live extension area above the composer" — collapses
       * away entirely (no padding, no divider) rather than reserving
       * empty space when there is nothing pinned. */}
      {liveExtension !== null && liveExtension !== undefined && liveExtension !== false ? (
        <View style={styles.liveExtension} testID="compact-shell-live-extension">
          {liveExtension}
        </View>
      ) : null}
      {/* T338: shrinkable (see `createStyles`), so a composer taller than
       * what is left under the keyboard is squeezed to fit and scrolls its
       * own controls, instead of overflowing the shell and pushing its
       * prompt bar off screen. */}
      <View style={styles.composer} testID="compact-shell-composer">
        {composer}
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    shell: {
      flex: 1,
      backgroundColor: theme.colors.page,
    },
    header: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
    },
    statusStrip: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors["line-soft"],
    },
    transcript: {
      flex: 1,
    },
    liveExtension: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.line,
      backgroundColor: theme.colors.canvas,
    },
    composer: {
      // T338: `flexShrink: 1` is what lets the keyboard inset above
      // actually reach the composer. Every slot here defaults to
      // `flexShrink: 0`, so until this the composer kept its full content
      // height, the transcript (the only `flex: 1` slot) went to zero, and
      // whatever did not fit -- the prompt bar, last in the composer --
      // was drawn under the keyboard and pruned from the accessibility
      // tree (Maestro run 34470287372, both shard-4 flows: `composer-send`
      // not found after typing). `Composer.tsx` scrolls its own controls
      // and pins the prompt bar, so shrinking it is safe.
      flexShrink: 1,
      minHeight: 0,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.line,
      backgroundColor: theme.colors.surface,
      padding: theme.spacing[3],
    },
  });
}
