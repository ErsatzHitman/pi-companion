/**
 * Android model/thinking-level picker for the compact composer (T39B,
 * plan.md §11.1's "model and reasoning" RPC group). Thin native view
 * over `./model-thinking-model.ts` — every behavioural claim (the four
 * availability states, the round trip, the derived current-selection
 * labels, the selected model's own thinking-option derivation) already
 * has render-free behavioural proof in `model-thinking-model.test.ts`;
 * this file only wires that into the render tree.
 *
 * UI-A4: rebuilt off two `Select` dropdowns onto the reference
 * artifact's own shape (`docs/ui-reference/pi-companion-app.html`'s
 * `.pm-row`/`.tick` model list and `.seg` effort control):
 *
 *  - Every model is an inline row with a leading tick (visible only on
 *    the selected row) and a trailing "up to <ceiling>" value, instead
 *    of being one collapsed `Select` option.
 *  - The effort control is a segmented row of every reachable thinking
 *    option **across every model this provider offers**, not only the
 *    selected model's own list — the artifact's own `.seg` shows steps
 *    beyond the selected model's ceiling rather than hiding them
 *    (`button:disabled { opacity: .38 }`). `thinkingOptionsForSelection`
 *    still decides the selected model's own reachable ceiling exactly as
 *    before; what changed is that a step past it renders disabled
 *    instead of being filtered out of the list entirely. A leading
 *    "Default" segment (absent from the artifact, which always shows a
 *    concrete effort) is kept so `onSelectThinking(null)` — clearing an
 *    explicit choice — stays reachable, which no visual step in the mock
 *    stands for.
 *
 * ## Touch targets: still a single audited shape, now declared here
 *
 * The rows and segment buttons below are this file's own `Pressable`s
 * (the composed `Select` this replaces is gone), so each carries
 * `accessibilityRole="button"` and a style with `minHeight: 48` —
 * `touch-targets.test.ts` discovers and audits this file itself (T378's
 * directory walk), not only the primitives it used to compose.
 *
 * ## A truthful unavailable state, never an enabled control that can
 * only fail
 *
 * Unchanged from the `Select` version: whenever
 * `state.availability !== "ready"` this renders
 * `state.unavailableReason`'s own truthful sentence instead of the
 * model list and effort control.
 */
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../../ui/theme/theme-context";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import {
  currentModelLabel,
  currentThinkingLabel,
  selectedModelOption,
  thinkingOptionsForSelection,
  type ModelThinkingOption,
  type ModelThinkingState,
} from "./model-thinking-model";

/** Sentinel value standing in for "no explicit thinking choice" (`thinkingOptionId: null`). */
const DEFAULT_THINKING_VALUE = "__default__";

/** Every reachable thinking option across every model this provider offers, deduped by id and ordered by first appearance — the artifact's fixed `EFF` ladder, derived from real model data instead of a hardcoded list. */
function allThinkingOptions(
  models: ModelThinkingState["models"],
): readonly ModelThinkingOption[] {
  const seen = new Map<string, ModelThinkingOption>();
  for (const model of models) {
    for (const option of model.thinkingOptions ?? []) {
      if (!seen.has(option.id)) seen.set(option.id, option);
    }
  }
  return [...seen.values()];
}

export interface ModelThinkingPickerProps {
  state: ModelThinkingState;
  /** Fires with the tapped option's model id. No-op while `state.availability !== "ready"` (no row is rendered in that case at all). */
  onSelectModel: (modelId: string) => void;
  /** Fires with the tapped thinking option's id, or `null` for "Default". */
  onSelectThinking: (thinkingOptionId: string | null) => void;
  testId?: string;
}

export function ModelThinkingPicker({
  state,
  onSelectModel,
  onSelectThinking,
  testId = "model-thinking-picker",
}: ModelThinkingPickerProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (state.availability !== "ready") {
    const label = state.availability === "loading" ? "Loading model…" : state.unavailableReason;
    return (
      <View style={styles.root} testID={testId}>
        <Text style={styles.unavailable} testID={`${testId}-unavailable`}>
          {label}
        </Text>
      </View>
    );
  }

  const { unsupportedReason } = thinkingOptionsForSelection(state);
  const reachableIds = new Set(
    (selectedModelOption(state)?.thinkingOptions ?? []).map((option) => option.id),
  );
  const effortSteps = allThinkingOptions(state.models);
  const thinkingValue = state.thinkingOptionId ?? DEFAULT_THINKING_VALUE;

  return (
    <View style={styles.root} testID={testId}>
      <Text style={styles.summary} testID={`${testId}-summary`}>
        {`Model: ${currentModelLabel(state)} · Thinking: ${currentThinkingLabel(state)}`}
      </Text>
      {state.models.map((model) => {
        const selected = model.id === state.modelId;
        const ceiling = model.thinkingOptions?.[model.thinkingOptions.length - 1]?.label;
        return (
          <Pressable
            key={model.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={styles.pmRow}
            onPress={() => onSelectModel(model.id)}
            testID={`${testId}-model-${model.id}`}
          >
            <Text style={[styles.tick, selected ? styles.tickOn : null]}>✓</Text>
            <Text style={[styles.pmRowLabel, selected ? styles.pmRowLabelOn : null]}>
              {model.label}
            </Text>
            {ceiling ? <Text style={styles.pmRowValue}>up to {ceiling}</Text> : null}
          </Pressable>
        );
      })}
      {unsupportedReason ? (
        <Text style={styles.unavailable} testID={`${testId}-thinking-unavailable`}>
          {unsupportedReason}
        </Text>
      ) : (
        <View style={styles.seg} testID={`${testId}-thinking`}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: thinkingValue === DEFAULT_THINKING_VALUE }}
            style={styles.segButton}
            onPress={() => onSelectThinking(null)}
            testID={`${testId}-thinking-default`}
          >
            <Text
              style={[
                styles.segButtonLabel,
                thinkingValue === DEFAULT_THINKING_VALUE ? styles.segButtonLabelOn : null,
              ]}
            >
              Default
            </Text>
          </Pressable>
          {effortSteps.map((option) => {
            const reachable = reachableIds.has(option.id);
            const selected = thinkingValue === option.id;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: !reachable }}
                disabled={!reachable}
                style={[styles.segButton, !reachable ? styles.segButtonDisabled : null]}
                onPress={() => reachable && onSelectThinking(option.id)}
                testID={`${testId}-thinking-${option.id}`}
              >
                <Text style={[styles.segButtonLabel, selected ? styles.segButtonLabelOn : null]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {state.changeError ? (
        <Text style={styles.error} testID={`${testId}-change-error`}>
          {state.changeError}
        </Text>
      ) : null}
      {state.thinkingNotice ? (
        <Text style={styles.notice} testID={`${testId}-thinking-notice`}>
          {state.thinkingNotice.message}
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
    pmRow: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      borderRadius: theme.radii.md,
    },
    tick: {
      width: 14,
      color: "transparent",
      fontSize: theme.typography.variant.bodySmall.fontSize,
    },
    tickOn: {
      color: theme.colors.accent,
    },
    pmRowLabel: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.ink,
      fontSize: theme.typography.variant.bodySmall.fontSize,
    },
    pmRowLabelOn: {
      fontWeight: asFontWeight("600"),
    },
    pmRowValue: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    seg: {
      flexDirection: "row",
      gap: theme.spacing[1],
      padding: theme.spacing[1],
      backgroundColor: theme.colors.inset,
      borderRadius: theme.radii.md,
    },
    segButton: {
      flex: 1,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radii.sm,
    },
    segButtonDisabled: {
      opacity: 0.38,
    },
    segButtonLabel: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    segButtonLabelOn: {
      color: theme.colors.ink,
      fontWeight: asFontWeight("600"),
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

export default ModelThinkingPicker;
