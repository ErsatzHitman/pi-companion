import { useMemo, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Sheet } from "../../ui/primitives";
import { useTheme } from "../../ui/theme/theme-context";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { buildContextCardViewModel, type ContextUsageBand } from "../telemetry";
import type { AgentUsage } from "@picompanion/protocol/agent-types";

/**
 * The context-ring menu (T353) — the artifact's `.pmenu`.
 *
 * The redesign's amendment removed the four control pills that used to
 * sit above the prompt bar and put their contents behind the context
 * ring instead. This is what the ring opens: one panel holding the
 * session's per-turn controls, in the artifact's own order, with the
 * context readout at the bottom where the ring itself lives.
 *
 * **Why `Sheet` and not a bespoke absolute overlay.** The artifact
 * positions `.pmenu` absolutely above the prompt bar over a scrim, and
 * building that here would mean re-deriving a scrim, a back-gesture
 * handler and a TalkBack focus move that `ui/primitives/Sheet.tsx`
 * already owns — and, crucially, getting the IME right. A menu opened
 * from the composer competes with a focused `TextInput`; `Sheet`
 * deliberately avoids React Native's `<Modal>` for exactly that reason
 * (see its own doc comment), and reproducing the layout by hand would
 * have re-opened the question. The panel is bottom-anchored, which is
 * where the artifact draws it.
 *
 * **The rows are slots, not implementations.** Model/effort and queue
 * mode already have working controls (`ModelThinkingPicker`,
 * `QueueModePicker`) that this task MOVED here rather than rebuilt —
 * they keep their own testIDs, including `composer-queue-mode`, so
 * every flow and contract that names one still finds it. Build/Plan and
 * the auto-compaction switch are not yet built; this menu renders
 * whatever nodes it is given and says nothing about controls that do
 * not exist, so adding them later is adding a prop, not restructuring
 * a panel.
 *
 * The context readout it DOES own, because it is the ring's own
 * reading and belongs next to the thing that opened the menu — and it
 * comes from the same `buildContextCardViewModel` the Live screen's
 * card uses, so the two can never disagree.
 */
export interface PromptControlsMenuProps {
  open: boolean;
  onClose: () => void;
  /** The newest usage the daemon has reported for this session. */
  usage?: AgentUsage | null;
  /** Whether auto-compaction is on, when known. Omitted while nothing has asked the daemon. */
  autoCompaction?: boolean;
  /** The Build/Plan mode control, when one exists. */
  modeControl?: ReactNode;
  /** The model and thinking-effort control (`ModelThinkingPicker`). */
  modelControl?: ReactNode;
  /** The steering/follow-up queue control (`QueueModePicker`). */
  queueControl?: ReactNode;
  testId?: string;
}

const MENU_TITLE = "Session controls";
const MENU_DESCRIPTION = "Mode, model, thinking effort and context for this session";

/** The artifact's `.pm-lbl`: a small uppercase mono group label. */
const GROUP_LABEL_SIZE = 10;
/** The artifact's context bar inside the menu. */
const MENU_BAR_HEIGHT = 6;

function MenuGroup({
  label,
  children,
  testId,
}: {
  label: string;
  children: ReactNode;
  testId?: string;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.group} testID={testId}>
      <Text accessibilityRole="header" style={styles.groupLabel}>
        {label}
      </Text>
      {children}
    </View>
  );
}

export function PromptControlsMenu({
  open,
  onClose,
  usage,
  autoCompaction,
  modeControl,
  modelControl,
  queueControl,
  testId = "prompt-controls-menu",
}: PromptControlsMenuProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const context = useMemo(
    () => buildContextCardViewModel({ usage, autoCompaction }),
    [usage, autoCompaction],
  );
  const bandColors: Record<ContextUsageBand, string> = {
    normal: theme.colors.accent,
    warning: theme.colors.orange,
    critical: theme.colors.red,
  };

  return (
    <Sheet
      open={open}
      title={MENU_TITLE}
      description={MENU_DESCRIPTION}
      onClose={onClose}
      testId={testId}
    >
      {modeControl ? (
        <MenuGroup label="MODE" testId={`${testId}-mode`}>
          {modeControl}
        </MenuGroup>
      ) : null}
      {modelControl ? (
        <MenuGroup label="MODEL & EFFORT" testId={`${testId}-model`}>
          {modelControl}
        </MenuGroup>
      ) : null}
      {queueControl ? (
        <MenuGroup label="QUEUE" testId={`${testId}-queue`}>
          {queueControl}
        </MenuGroup>
      ) : null}
      <MenuGroup label="CONTEXT" testId={`${testId}-context`}>
        <View accessible accessibilityLabel={context.accessibilityLabel}>
          <Text style={styles.contextSummary}>{context.summary}</Text>
          <View style={styles.contextTrack}>
            {context.fraction === null ? null : (
              <View
                style={[
                  styles.contextFill,
                  {
                    width: `${Math.round(context.fraction * 100)}%`,
                    backgroundColor: bandColors[context.band],
                  },
                ]}
              />
            )}
          </View>
        </View>
        {context.statsText.length > 0 ? (
          <Text style={styles.contextStats} testID={`${testId}-context-stats`}>
            {context.statsText}
          </Text>
        ) : null}
      </MenuGroup>
    </Sheet>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    group: {
      gap: theme.spacing[2],
      paddingTop: theme.spacing[3],
    },
    groupLabel: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: GROUP_LABEL_SIZE,
      letterSpacing: 0.9,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    contextSummary: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.bodySmall.fontSize,
    },
    contextTrack: {
      marginTop: theme.spacing[2],
      height: MENU_BAR_HEIGHT,
      borderRadius: theme.radii.full,
      backgroundColor: theme.colors.inset,
      overflow: "hidden",
    },
    contextFill: {
      height: MENU_BAR_HEIGHT,
      borderRadius: theme.radii.full,
    },
    contextStats: {
      color: theme.colors["ink-2"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default PromptControlsMenu;
