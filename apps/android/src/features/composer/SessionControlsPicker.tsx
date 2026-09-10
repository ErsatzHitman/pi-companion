import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Toggle } from "../../ui/primitives";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import {
  currentModeLabel,
  describeAutoCompaction,
  type SessionControlsState,
} from "./session-controls-model";

/**
 * The context-ring menu's Build/Plan mode row and auto-compaction
 * switch (T354) — the artifact's `.f-mode` segment pair, plus the
 * compaction switch that sits beside the context readout.
 *
 * Thin native view over `./session-controls-model.ts`: every behaviour
 * worth arguing about — the five availability states, the read-back
 * after each write, the in-flight guards, `autoCompaction`'s third
 * `null` state — is proven by execution in
 * `session-controls-model.test.ts`. This file only draws it, the same
 * split `./ModelThinkingPicker.tsx` uses and for the same reason
 * (`react-native` cannot render under this workspace's plain `vitest`).
 *
 * ## Segments, not a `Select`, and why
 *
 * Mode is the one control in this menu whose whole value is being
 * readable at a glance while the other is one tap away: the artifact
 * draws Build and Plan as two adjacent pills with the active one
 * accent-tinted, and collapsing that into a `Select` would cost a tap
 * and hide the alternative. The segments are `accessibilityRole="radio"`
 * inside a `radiogroup`, which is what a one-of-N choice actually is,
 * and each carries `accessibilityState.selected` so the tint is never
 * the only signal (plan.md §10.5).
 *
 * The provider decides how many segments there are. Build/Plan is what
 * Pi reports today, but `state.modes` is whatever the snapshot or
 * `listProviderModes` returned, so a provider with three modes gets
 * three pills rather than a truncated pair.
 *
 * **The visible pill is small, the touch target is 48dp.** Like
 * `../../ui/primitives/Chip.tsx`'s removable variant, the pill keeps the
 * artifact's tight footprint and grows its bounds with `hitSlop` rather
 * than inflating the pill itself (plan.md §9.3, T26C).
 *
 * ## The switch is not drawn when nobody knows its value
 *
 * `state.autoCompaction === null` means no truthful answer exists yet —
 * see the model's doc comment. A switch rendered in that state would
 * have to pick a position, and both positions are a claim. The sentence
 * `describeAutoCompaction(null)` is rendered instead, which says
 * "unknown" and nothing else.
 */
export interface SessionControlsPickerProps {
  state: SessionControlsState;
  /** Fires with the tapped mode's id. No segment is rendered while `state.availability !== "ready"`. */
  onSelectMode: (modeId: string) => void;
  /** Fires with the requested auto-compaction position. */
  onSetAutoCompaction: (enabled: boolean) => void;
  testId?: string;
}

/** The artifact's `.f-mode`: a 9.5px uppercase label inside a tight pill. */
const MODE_LABEL_SIZE = 9.5;
const AUTO_COMPACTION_LABEL = "Auto-compact this session";

export function SessionControlsPicker({
  state,
  onSelectMode,
  onSetAutoCompaction,
  testId = "session-controls-picker",
}: SessionControlsPickerProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (state.availability !== "ready") {
    const label =
      state.availability === "loading" ? "Loading session controls…" : state.unavailableReason;
    return (
      <View style={styles.root} testID={testId}>
        <Text style={styles.muted} testID={`${testId}-unavailable`}>
          {label}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root} testID={testId}>
      <Text style={styles.summary} testID={`${testId}-summary`}>
        {`Mode: ${currentModeLabel(state)} · ${describeAutoCompaction(state.autoCompaction)}`}
      </Text>
      {state.modes.length === 0 ? (
        <Text style={styles.muted} testID={`${testId}-modes-unavailable`}>
          {state.modesError ?? "This provider reports no modes to switch between."}
        </Text>
      ) : (
        <View accessibilityRole="radiogroup" style={styles.segments} testID={`${testId}-modes`}>
          {state.modes.map((mode) => {
            const selected = mode.id === state.currentModeId;
            return (
              <Pressable
                key={mode.id}
                accessibilityRole="radio"
                accessibilityLabel={mode.label}
                accessibilityHint={mode.description}
                accessibilityState={{ selected, disabled: state.isChangingMode }}
                disabled={state.isChangingMode}
                hitSlop={14}
                onPress={() => onSelectMode(mode.id)}
                testID={`${testId}-mode-${mode.id}`}
              >
                <View style={[styles.segment, selected ? styles.segmentSelected : null]}>
                  <Text style={[styles.segmentText, selected ? styles.segmentTextSelected : null]}>
                    {mode.label.toUpperCase()}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      {state.modesError && state.modes.length > 0 ? (
        <Text style={styles.muted} testID={`${testId}-modes-error`}>
          {state.modesError}
        </Text>
      ) : null}
      {state.autoCompaction === null ? (
        <Text style={styles.muted} testID={`${testId}-auto-compaction-unknown`}>
          {describeAutoCompaction(null)}
        </Text>
      ) : (
        <Toggle
          label={AUTO_COMPACTION_LABEL}
          checked={state.autoCompaction}
          onCheckedChange={onSetAutoCompaction}
          disabled={state.isChangingAutoCompaction}
          testId={`${testId}-auto-compaction`}
        />
      )}
      {state.changeError ? (
        <Text style={styles.error} testID={`${testId}-change-error`}>
          {state.changeError}
        </Text>
      ) : null}
      {state.notice ? (
        <Text style={styles.muted} testID={`${testId}-notice`}>
          {state.notice.message}
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    root: { gap: theme.spacing[2] },
    summary: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    segments: { flexDirection: "row", gap: theme.spacing[2] },
    segment: {
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[1],
      borderRadius: theme.radii.chip,
      borderWidth: 1,
      borderColor: theme.colors.line,
      backgroundColor: theme.colors.surface,
    },
    segmentSelected: {
      backgroundColor: theme.colors["accent-tint"],
      borderColor: theme.colors.accent,
    },
    segmentText: {
      color: theme.colors["ink-2"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: MODE_LABEL_SIZE,
      letterSpacing: 0.8,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    segmentTextSelected: { color: theme.colors.accent },
    muted: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    error: {
      color: theme.colors.red,
      fontSize: theme.typography.variant.caption.fontSize,
    },
  });
}

export default SessionControlsPicker;
