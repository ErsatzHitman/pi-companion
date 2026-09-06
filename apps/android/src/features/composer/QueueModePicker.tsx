/**
 * Android session-wide queue-mode picker for the compact composer (T39C,
 * plan.md §11.1's "queues and automation" RPC group). Thin native view
 * over `./queue-mode-model.ts` — every behavioural claim (the five
 * availability states, the round trip, the label derivation) already
 * has render-free behavioural proof in `queue-mode-model.test.ts`; this
 * file only wires that into the render tree. Same split as
 * `./ModelThinkingPicker.tsx`/`model-thinking-model.ts` (`react-native`
 * cannot render under this workspace's plain `vitest`, proven 27+ times
 * — see that file's doc comment).
 *
 * ## Touch targets: composed only from already-audited primitives
 *
 * This file declares no `Pressable`/`Touchable*` of its own — every
 * interactive control is `../../ui/primitives`' `Select`, already in
 * `../../ui/primitives/touch-targets.test.ts`'s strict, mutation-checked
 * 48dp audit — same guarantee `ModelThinkingPicker.tsx`'s own header
 * relies on.
 *
 * ## "The current value is visible without opening a menu"
 *
 * `Select` shows its own current value collapsed on its trigger
 * (`current?.label ?? "Not selected"`), but this view additionally
 * renders an explicit summary line built from `queueModeLabel`
 * (`./queue-mode-model.ts`) ABOVE both `Select`s — a value derivable,
 * and asserted, straight from `state` with no picker ever opened.
 *
 * ## A truthful unavailable state, never an enabled control that can
 * only fail
 *
 * Whenever `state.availability !== "ready"` this renders
 * `state.unavailableReason`'s own truthful sentence instead of an
 * enabled `Select` pair — CLAUDE.md's "the failure mode this wave keeps
 * shipping". **T132** wired the production session route to a live,
 * capable client (see `queue-mode-model.ts`'s module doc), so
 * `"no-client"` is now the honest state only before a connection exists
 * — not the only shape a real build can produce.
 *
 * ## No cancel/reorder affordance
 *
 * This control is about the whole session's delivery mode, never a
 * single queued message — it renders no per-item list, no cancel
 * button, no reorder affordance, because Pi exposes no such command
 * (T38B1a's own acceptance criteria, carried over unchanged here).
 */
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Select, type SelectOption } from "../../ui/primitives";
import { useTheme } from "../../ui/theme/theme-context";
import { queueModeLabel, type QueueMode, type QueueModesState } from "./queue-mode-model";

const MODE_OPTIONS: SelectOption[] = [
  { value: "one-at-a-time", label: "One at a time (default)" },
  { value: "all", label: "All together" },
];

/** Sentinel `Select` value standing in for "provider reports no mode at all" (`steeringMode`/`followUpMode: null`) — `Select`'s own `SelectOption.value` is a plain string, so `null` itself cannot be one of its option values. */
const NOT_REPORTED_VALUE = "__not_reported__";

function modeSelectOptions(current: QueueMode | null): SelectOption[] {
  if (current === null) {
    return [{ value: NOT_REPORTED_VALUE, label: "Not reported by this provider" }, ...MODE_OPTIONS];
  }
  return MODE_OPTIONS;
}

export interface QueueModePickerProps {
  state: QueueModesState;
  /** Fires with the tapped option's mode. No-op while `state.availability !== "ready"` (no `Select` is rendered in that case at all). */
  onSelectSteeringMode: (mode: QueueMode) => void;
  /** Fires with the tapped option's mode for the follow-up queue. */
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

  const steeringValue = state.steeringMode ?? NOT_REPORTED_VALUE;
  const followUpValue = state.followUpMode ?? NOT_REPORTED_VALUE;

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
      <Select
        label="Steering queue delivery"
        options={modeSelectOptions(state.steeringMode)}
        value={steeringValue}
        onValueChange={(value) => {
          if (value === "all" || value === "one-at-a-time") onSelectSteeringMode(value);
        }}
        testId={`${testId}-steering`}
      />
      <Select
        label="Follow-up queue delivery"
        options={modeSelectOptions(state.followUpMode)}
        value={followUpValue}
        onValueChange={(value) => {
          if (value === "all" || value === "one-at-a-time") onSelectFollowUpMode(value);
        }}
        testId={`${testId}-follow-up`}
      />
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
