/**
 * Android session-wide queue-mode picker for the compact composer (T39C,
 * plan.md §11.1's "queues and automation" RPC group). Thin native view
 * over `./queue-mode-model.ts` — every behavioural claim (the five
 * availability states, the round trip, the label derivation) already
 * has render-free behavioural proof in `queue-mode-model.test.ts`; this
 * file only wires that into the render tree.
 *
 * UI-A4: rebuilt off two `Select` dropdowns onto the reference
 * artifact's own shape (`docs/ui-reference/pi-companion-app.html`'s
 * `.pm-row[data-cyc]`) — a row that cycles its own value in place on
 * tap, with the current value shown as trailing mono text, rather than
 * opening a second menu on top of this one. The artifact cycles a
 * three-value display label ("Steer"/"Queue"/"Reject"); this control
 * still carries only the two real `QueueMode` values Pi's protocol
 * defines (`"one-at-a-time"`/`"all"` — see `./queue-mode-model.ts`'s
 * module doc for why a third, invented value is not added here), so
 * each row cycles between exactly those two and calls its existing
 * callback with the concrete next value — the round trip, the
 * availability gating and both callbacks are unchanged from the
 * `Select`-based version this replaces.
 *
 * ## Touch targets: still a single audited shape, now declared here
 *
 * The two rows below are this file's own `Pressable`s (T39C's original
 * composed `Select`, already in `touch-targets.test.ts`'s audit, is
 * gone), so each carries `accessibilityRole="button"` and a `pmRow`
 * style with `minHeight: 48` directly — `touch-targets.test.ts`
 * discovers and audits this file itself (T378's directory walk), not
 * only the primitives it used to compose.
 *
 * ## A truthful unavailable state, never an enabled control that can
 * only fail
 *
 * Unchanged from the `Select` version: whenever
 * `state.availability !== "ready"` this renders `state.unavailableReason`'s
 * own truthful sentence instead of the two rows.
 *
 * ## No cancel/reorder affordance
 *
 * Unchanged: this control is about the whole session's delivery mode,
 * never a single queued message.
 */
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../../ui/theme/theme-context";
import { queueModeLabel, type QueueMode, type QueueModesState } from "./queue-mode-model";

/** The next mode a tap cycles to — the only two real values `QueueMode` has; a `null` (provider reports none) cycles to `"one-at-a-time"` first, same as picking it from the old `Select`'s default row. */
function nextQueueMode(current: QueueMode | null): QueueMode {
  return current === "one-at-a-time" ? "all" : "one-at-a-time";
}

export interface QueueModePickerProps {
  state: QueueModesState;
  /** Fires with the tapped row's next mode. No-op while `state.availability !== "ready"` (neither row is rendered in that case at all). */
  onSelectSteeringMode: (mode: QueueMode) => void;
  /** Fires with the tapped row's next mode for the follow-up queue. */
  onSelectFollowUpMode: (mode: QueueMode) => void;
  testId?: string;
}

export function QueueModePicker({
  state,
  onSelectSteeringMode,
  onSelectFollowUpMode,
  testId = "queue-mode-picker",
}: QueueModePickerProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (state.availability !== "ready") {
    const label =
      state.availability === "loading" ? "Loading queue mode…" : state.unavailableReason;
    return (
      <View style={styles.root} testID={testId}>
        <Text style={styles.unavailable} testID={`${testId}-unavailable`}>
          {label}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root} testID={testId}>
      <Text style={styles.help}>
        These two settings control how several already-queued messages are delivered for the whole
        session — one at a time, or all together. They do not decide whether a single message steers
        the running turn or waits for it to finish; that choice is made per message, separately,
        when you send it.
      </Text>
      <Text style={styles.summary} testID={`${testId}-summary`}>
        {`Steering: ${queueModeLabel(state.steeringMode)} · Follow-up: ${queueModeLabel(state.followUpMode)}`}
      </Text>
      <Pressable
        accessibilityRole="button"
        style={styles.pmRow}
        onPress={() => onSelectSteeringMode(nextQueueMode(state.steeringMode))}
        testID={`${testId}-steering`}
      >
        <Text style={styles.pmRowLabel}>While a turn runs</Text>
        <Text style={styles.pmRowValue}>{queueModeLabel(state.steeringMode)} ›</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={styles.pmRow}
        onPress={() => onSelectFollowUpMode(nextQueueMode(state.followUpMode))}
        testID={`${testId}-follow-up`}
      >
        <Text style={styles.pmRowLabel}>After it finishes</Text>
        <Text style={styles.pmRowValue}>{queueModeLabel(state.followUpMode)} ›</Text>
      </Pressable>
      {state.changeError ? (
        <Text style={styles.error} testID={`${testId}-change-error`}>
          {state.changeError}
        </Text>
      ) : null}
      {state.steeringNotice ? (
        <Text style={styles.notice} testID={`${testId}-steering-notice`}>
          {state.steeringNotice.message}
        </Text>
      ) : null}
      {state.followUpNotice ? (
        <Text style={styles.notice} testID={`${testId}-follow-up-notice`}>
          {state.followUpNotice.message}
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    root: { gap: theme.spacing[2] },
    help: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    summary: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    pmRow: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      borderRadius: theme.radii.md,
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
    unavailable: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    error: {
      color: theme.colors.red,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    notice: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default QueueModePicker;
