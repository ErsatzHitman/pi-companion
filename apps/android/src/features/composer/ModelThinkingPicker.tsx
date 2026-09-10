/**
 * Android model/thinking-level picker for the compact composer (T39B,
 * plan.md §11.1's "model and reasoning" RPC group). Thin native view
 * over `./model-thinking-model.ts` — every behavioural claim (the four
 * availability states, the round trip, the derived current-selection
 * labels, the selected model's own thinking-option derivation) already
 * has render-free behavioural proof in `model-thinking-model.test.ts`;
 * this file only wires that into the render tree. Same split as
 * `../sessions/session-tree-sheet.tsx`/`session-tree-sheet-model.ts`
 * (`react-native` cannot render under this workspace's plain `vitest`,
 * proven 27+ times — see that file's doc comment).
 *
 * ## Touch targets: composed only from already-audited primitives
 *
 * This file declares no `Pressable`/`Touchable*` of its own — every
 * interactive control is `../../ui/primitives`' `Select`, which is
 * already in `../../ui/primitives/touch-targets.test.ts`'s strict,
 * mutation-checked 48dp audit (`trigger: { minHeight: 48, ... }`,
 * `menuItem: { minHeight: 48, ... }`). Composing an already-audited
 * primitive rather than a bespoke `Pressable` is what keeps this file's
 * own 48dp guarantee real instead of a second, unaudited copy —
 * `model-thinking-model.test.ts`'s header names the exact style values
 * this relies on.
 *
 * ## "The current selection is visible without opening the picker"
 *
 * `Select` already shows its own current value collapsed on its
 * trigger (`current?.label ?? "Select…"`), but this view additionally
 * renders an explicit summary line built from `currentModelLabel`/
 * `currentThinkingLabel` (`./model-thinking-model.ts`) ABOVE both
 * `Select`s — a value derivable, and asserted, straight from `state`
 * with no picker ever opened.
 *
 * ## A truthful unavailable state, never an enabled control that can
 * only fail
 *
 * Whenever `state.availability !== "ready"` this renders
 * `state.unavailableReason`'s own truthful sentence instead of an
 * enabled `Select` pair — CLAUDE.md's "the failure mode this wave keeps
 * shipping". The production session route wires a live, capable client
 * into this feature since T353 (`app-shell/session-route-daemon-clients.ts`'s
 * `resolveModelThinkingClient`), so `"ready"` is a real shape on a
 * connected build; `"no-client"` is what a lab mount, a test harness,
 * or a disconnected build still gets.
 *
 * CORRECTED (T353, recorded here at T354): this said "No Android route
 * wires a live, capable client into this feature yet ... so
 * `"no-client"` is today's only real-build shape." Both clauses were
 * true when written and T353's resolver falsified them; that commit
 * corrected the two sibling doc comments and missed this one.
 */
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Select, type SelectOption } from "../../ui/primitives";
import { useTheme } from "../../ui/theme/theme-context";
import {
  currentModelLabel,
  currentThinkingLabel,
  thinkingOptionsForSelection,
  type ModelThinkingState,
} from "./model-thinking-model";

/** Sentinel `Select` value standing in for "no explicit thinking choice" (`thinkingOptionId: null`) — `Select`'s own `SelectOption.value` is a plain string, so `null` itself cannot be one of its option values. */
const DEFAULT_THINKING_VALUE = "__default__";

export interface ModelThinkingPickerProps {
  state: ModelThinkingState;
  /** Fires with the tapped option's model id. No-op while `state.availability !== "ready"` (no `Select` is rendered in that case at all). */
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

  const modelOptions: SelectOption[] = state.models.map((model) => ({
    value: model.id,
    label: model.label,
  }));
  const { options: thinkingOptions, unsupportedReason } = thinkingOptionsForSelection(state);
  const thinkingSelectOptions: SelectOption[] = [
    { value: DEFAULT_THINKING_VALUE, label: "Default" },
    ...thinkingOptions.map((option) => ({ value: option.id, label: option.label })),
  ];
  const thinkingValue = state.thinkingOptionId ?? DEFAULT_THINKING_VALUE;

  return (
    <View style={styles.root} testID={testId}>
      <Text style={styles.summary} testID={`${testId}-summary`}>
        {`Model: ${currentModelLabel(state)} · Thinking: ${currentThinkingLabel(state)}`}
      </Text>
      <Select
        label="Model"
        options={modelOptions}
        value={state.modelId ?? ""}
        onValueChange={onSelectModel}
        testId={`${testId}-model`}
      />
      {unsupportedReason ? (
        <Text style={styles.unavailable} testID={`${testId}-thinking-unavailable`}>
          {unsupportedReason}
        </Text>
      ) : (
        <Select
          label="Thinking level"
          options={thinkingSelectOptions}
          value={thinkingValue}
          onValueChange={(value) =>
            onSelectThinking(value === DEFAULT_THINKING_VALUE ? null : value)
          }
          testId={`${testId}-thinking`}
        />
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
