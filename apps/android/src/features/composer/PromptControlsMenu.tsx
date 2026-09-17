import { isValidElement, useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Sheet } from "../../ui/primitives";
import { useTheme } from "../../ui/theme/theme-context";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { EXPRESSIVE_RADIUS_XS } from "../../ui/theme/expressive-shape";
import { buildContextCardViewModel, type ContextUsageBand } from "../telemetry";
import type { AgentUsage } from "@picompanion/protocol/agent-types";

/**
 * The prompt controls menu — the artifact's `.pmenu`.
 *
 * T353 amended the redesign to remove the four metadata pills that used
 * to sit above the prompt bar and put their contents behind a context
 * ring instead; A-COMPOSER reverses that amendment (`plan.md`'s Android
 * composer section, `spec-delta.md` §2 A-COMPOSER) back to the
 * confirmed spec's own markup — the four pills are back above the
 * prompt bar (`FooterPills.tsx`), and there is no ring. This is what
 * THREE of those pills now open (`f-mode`/`f-model`/`f-eff` — see that
 * file's own module doc for why `f-mode` also toggles directly on a
 * plain tap): one panel holding the session's per-turn controls, in the
 * artifact's own order, with the context readout at the bottom, exactly
 * as it already was — this file's own content is UNCHANGED by that
 * reversal (this task's brief: "the menu's content does not change").
 *
 * **Why `Sheet` and not a bespoke absolute overlay.** The artifact
 * positions `.pmenu` absolutely above the prompt bar over a scrim
 * (`bottom:98px` — clearing both the pill row and the bar beneath it),
 * and building that here would mean re-deriving a scrim, a back-gesture
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
 * `QueueModePicker`) that T353 MOVED here rather than rebuilt — they
 * keep their own testIDs, including `composer-queue-mode`, so every
 * flow and contract that names one still finds it. T354 filled the
 * `modeControl` slot the same way, with `SessionControlsPicker`
 * (Build/Plan segments plus the auto-compaction switch), by passing a
 * prop rather than restructuring this panel — which is the property
 * the slot shape was for.
 *
 * The context readout it DOES own, because it is the ring's own
 * reading and belongs next to the thing that opened the menu — and it
 * comes from the same `buildContextCardViewModel` the Live screen's
 * card uses, so the two can never disagree.
 *
 * ## UI-A4: a trailing value on every group label, read from real state
 *
 * The artifact's `.pm-lbl` is a two-part row: the group name, plus a
 * right-aligned mono value (`.pm-lbl b`) — "up to xhigh", "41.2% of
 * 200k". This panel does not own the mode/model/queue state itself
 * (each lives inside the slot `ReactNode` a caller hands it, per the
 * doc comment above), so `readControlState` below reads it back off the
 * slot's own element props — every one of `SessionControlsPicker`,
 * `ModelThinkingPicker` and `QueueModePicker` is passed a `state` prop
 * by its caller, and that is the exact same object this panel reads.
 * Nothing here invents a number: a slot that is absent, or whose
 * element shape does not match, simply renders no trailing value at
 * all, the same "say nothing about a control it was not given" rule
 * the panel already applies to whole groups.
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
  /**
   * Triggers an immediate compaction, when a caller has a real wire path
   * for one. UI-A4 audited the codebase for a "compact now" RPC and
   * found none: `HANDOFF.md`'s daemon-capability inventory states
   * plainly "There is no manual-compact RPC; compaction is a slash
   * command", and `apps/web/src/features/sessions/rpc-command-web-parity.ts`
   * records the same gap on the wire protocol itself ("No wire message
   * for a user-triggered manual compaction exists"). The only real path
   * is sending the literal text `/compact` as a chat message (proven live
   * in `packages/server/src/server/daemon-e2e/pi.real.e2e.test.ts`'s
   * "real Pi daemon executes manual compact out-of-band instead of
   * prompt text"), which requires a send-message capability this menu is
   * never given — so this prop stays optional, and the row it draws
   * renders honestly disabled when it is omitted, rather than an
   * enabled control whose only real outcome is a failure banner
   * (CLAUDE.md's "the failure mode this wave keeps shipping").
   */
  onCompactNow?: () => void;
  testId?: string;
}

const MENU_TITLE = "Session controls";
const MENU_DESCRIPTION = "Mode, model, thinking effort and context for this session";

/** The artifact's `.pm-lbl`: a small uppercase mono group label (9.5px, matching `.pm-lbl b`'s own size). */
const GROUP_LABEL_SIZE = 9.5;
/** The artifact's context bar inside the menu. */
const MENU_BAR_HEIGHT = 6;

/**
 * Reads a slot `ReactNode`'s own `state` prop back out, when the node is
 * a real element carrying one — every one of `SessionControlsPicker`,
 * `ModelThinkingPicker` and `QueueModePicker` is invoked as
 * `<X state={...} .../>` by its caller, so this is the exact same
 * object that component itself renders from, not a guess.
 */
function readControlState(node: ReactNode): Record<string, unknown> | null {
  if (!isValidElement(node)) return null;
  const props = node.props as { state?: unknown } | null | undefined;
  const state = props && typeof props === "object" ? props.state : undefined;
  return typeof state === "object" && state !== null ? (state as Record<string, unknown>) : null;
}

/** Mode group trailing value: the artifact's "edits land as made" / "nothing is written", from `SessionControlsState.currentModeId`. */
function modeGroupValue(modeControl: ReactNode): string | undefined {
  const state = readControlState(modeControl);
  const currentModeId = state?.["currentModeId"];
  if (typeof currentModeId !== "string" || currentModeId.length === 0) return undefined;
  return currentModeId.toLowerCase().includes("plan") ? "nothing is written" : "edits land as made";
}

/** Model & effort group trailing value: "up to <ceiling>", the selected model's own highest thinking option, from `ModelThinkingState`. */
function modelGroupValue(modelControl: ReactNode): string | undefined {
  const state = readControlState(modelControl);
  const modelId = state?.["modelId"];
  const models = state?.["models"];
  if (typeof modelId !== "string" || !Array.isArray(models)) return undefined;
  const selected = models.find(
    (model): model is { id: string; thinkingOptions?: { label?: unknown }[] } =>
      typeof model === "object" && model !== null && (model as { id?: unknown }).id === modelId,
  );
  const options = selected?.thinkingOptions;
  const ceiling =
    Array.isArray(options) && options.length > 0 ? options[options.length - 1]?.label : undefined;
  return typeof ceiling === "string" ? `up to ${ceiling}` : undefined;
}

/** One queue mode's display label, mirroring `queue-mode-model.ts`'s `queueModeLabel` without importing it (this reads a duck-typed slice of state, not the real `QueueMode` type). */
function queueModeDisplay(mode: unknown): string {
  if (mode === "all") return "All together";
  if (mode === "one-at-a-time") return "One at a time";
  return "Not reported";
}

/** Queue group trailing value: both current modes, from `QueueModesState`. */
function queueGroupValue(queueControl: ReactNode): string | undefined {
  const state = readControlState(queueControl);
  if (!state) return undefined;
  return `${queueModeDisplay(state["steeringMode"])} / ${queueModeDisplay(state["followUpMode"])}`;
}

function MenuGroup({
  label,
  value,
  children,
  testId,
}: {
  label: string;
  /** The artifact's `.pm-lbl b` — a right-aligned mono value beside the label. Omitted renders no trailing value at all. */
  value?: string;
  children: ReactNode;
  testId?: string;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.group} testID={testId}>
      <View style={styles.groupLabelRow}>
        <Text accessibilityRole="header" style={styles.groupLabel}>
          {label}
        </Text>
        {value ? (
          <Text style={styles.groupValue} testID={testId ? `${testId}-value` : undefined}>
            {value}
          </Text>
        ) : null}
      </View>
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
  onCompactNow,
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
        <MenuGroup label="MODE" value={modeGroupValue(modeControl)} testId={`${testId}-mode`}>
          {modeControl}
        </MenuGroup>
      ) : null}
      {modelControl ? (
        <MenuGroup
          label="MODEL & EFFORT"
          value={modelGroupValue(modelControl)}
          testId={`${testId}-model`}
        >
          {modelControl}
        </MenuGroup>
      ) : null}
      {queueControl ? (
        <MenuGroup label="QUEUE" value={queueGroupValue(queueControl)} testId={`${testId}-queue`}>
          {queueControl}
        </MenuGroup>
      ) : null}
      <MenuGroup label="CONTEXT" value={context.summary} testId={`${testId}-context`}>
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
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !onCompactNow }}
          disabled={!onCompactNow}
          style={styles.pmRow}
          onPress={onCompactNow}
          testID={`${testId}-context-compact`}
        >
          <Text style={styles.pmRowLabel}>Compact now</Text>
          <Text style={styles.pmRowValue}>
            {onCompactNow
              ? autoCompaction === undefined
                ? "auto-compaction: unknown"
                : `auto-compaction ${autoCompaction ? "on" : "off"}`
              : "no wire path — /compact is a slash command, not a menu action"}
          </Text>
        </Pressable>
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
    groupLabelRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: theme.spacing[2],
    },
    groupLabel: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: GROUP_LABEL_SIZE,
      letterSpacing: 0.9,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    groupValue: {
      marginLeft: "auto",
      color: theme.colors["ink-2"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: GROUP_LABEL_SIZE,
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
    pmRow: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      // `.pmenu .pm-row{border-radius:var(--r-xs)}` — A-SHAPE's Android
      // Expressive scale, not the shared `radii.md` this used to read
      // (8, one point off the artifact's own 10).
      borderRadius: EXPRESSIVE_RADIUS_XS,
    },
    pmRowLabel: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.ink,
      fontSize: theme.typography.variant.bodySmall.fontSize,
    },
    pmRowValue: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default PromptControlsMenu;
