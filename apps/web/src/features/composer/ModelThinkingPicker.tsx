import type { ChangeEvent } from "react";

import { Select, StatusIndicator } from "../../ui/primitives/index.js";
import type { SelectOption, StatusTone } from "../../ui/primitives/index.js";
import type { ModelThinkingState } from "./use-model-thinking.js";

/** The wire value for "no explicit thinking-level choice" (`thinkingOptionId: null`) — never a real option id, so it is safe as a `<select>` value. */
const AUTOMATIC_THINKING_OPTION_VALUE = "";

/**
 * Model and thinking-level picker (T28B5, plan.md §11.1 "model and
 * reasoning"). Composes the `Select` primitive (plan.md §10.3: native
 * `<select>`, so its current value is always visible collapsed and it is
 * fully keyboard-operable without forking anything) with
 * `StatusIndicator` for the one non-colour-only explanation this pair
 * needs at a time — the same pairing `Composer.tsx` already uses for its
 * own send/abort/queue status.
 *
 * "Unavailable options are explained rather than silently missing"
 * (T28B5 acceptance criterion) has three layers here:
 *
 * 1. Whole-picker unavailability (`state.availability`): no client wired,
 *    a wired client that does not implement the model/thinking methods,
 *    or the initial snapshot fetch failing — all three render the same
 *    disabled pair of selects plus a `StatusIndicator` naming the reason,
 *    rather than a picker that silently vanishes or does nothing on
 *    click (matching `state.availability`'s own three named reasons).
 * 2. A stale selection (`modelSelectOptions`/`thinkingSelectOptions`):
 *    if the daemon's current `modelId`/`thinkingOptionId` is not present
 *    in the freshly fetched list (renamed, removed, or the list is still
 *    loading), it is kept as a labelled "(unavailable)" option rather
 *    than dropped — the current selection stays visible without opening
 *    the picker even when it can no longer be re-chosen as-is.
 * 3. A model with no thinking levels at all (`thinkingUnsupportedReason`):
 *    the thinking picker still shows "Automatic", with a `StatusIndicator`
 *    naming which model does not support anything else.
 */
export interface ModelThinkingPickerProps {
  state: ModelThinkingState;
  testId?: string;
}

function unavailableSelectOptions(state: ModelThinkingState): SelectOption[] {
  return [
    {
      value: "",
      label: state.availability === "loading" ? "Loading\u2026" : "\u2014",
    },
  ];
}

function modelSelectOptions(state: ModelThinkingState): SelectOption[] {
  if (state.availability !== "ready") return unavailableSelectOptions(state);
  const options = state.models.map((model) => ({
    value: model.id,
    label: model.isDefault ? `${model.label} (default)` : model.label,
  }));
  if (state.modelId && !options.some((option) => option.value === state.modelId)) {
    options.unshift({ value: state.modelId, label: `${state.modelId} (unavailable)` });
  }
  return options;
}

function thinkingSelectOptions(state: ModelThinkingState): SelectOption[] {
  if (state.availability !== "ready") return unavailableSelectOptions(state);
  const options: SelectOption[] = [
    { value: AUTOMATIC_THINKING_OPTION_VALUE, label: "Automatic (provider default)" },
  ];
  for (const option of state.thinkingOptions) {
    options.push({
      value: option.id,
      label: option.isDefault ? `${option.label} (default)` : option.label,
    });
  }
  const selected = state.thinkingOptionId ?? AUTOMATIC_THINKING_OPTION_VALUE;
  if (
    selected !== AUTOMATIC_THINKING_OPTION_VALUE &&
    !options.some((option) => option.value === selected)
  ) {
    options.push({ value: selected, label: `${selected} (unavailable)` });
  }
  return options;
}

function noticeTone(type: "info" | "warning" | "error"): StatusTone {
  if (type === "error") return "danger";
  if (type === "warning") return "warning";
  return "info";
}

export function ModelThinkingPicker({ state, testId }: ModelThinkingPickerProps) {
  const modelTestId = testId ? `${testId}-model` : undefined;
  const thinkingTestId = testId ? `${testId}-thinking` : undefined;
  const statusTestId = testId ? `${testId}-status` : undefined;

  const disabled =
    state.availability !== "ready" || state.isChangingModel || state.isChangingThinking;

  function handleModelChange(event: ChangeEvent<HTMLSelectElement>): void {
    const modelId = event.target.value;
    if (!modelId) return;
    void state.setModel(modelId);
  }

  function handleThinkingChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    void state.setThinkingOption(value === AUTOMATIC_THINKING_OPTION_VALUE ? null : value);
  }

  return (
    <div className="pc-composer__model-thinking" data-testid={testId}>
      <Select
        label="Model"
        options={modelSelectOptions(state)}
        value={state.availability === "ready" ? (state.modelId ?? "") : ""}
        disabled={disabled}
        onChange={handleModelChange}
        testId={modelTestId}
      />
      <Select
        label="Thinking level"
        options={thinkingSelectOptions(state)}
        value={
          state.availability === "ready"
            ? (state.thinkingOptionId ?? AUTOMATIC_THINKING_OPTION_VALUE)
            : ""
        }
        disabled={disabled}
        onChange={handleThinkingChange}
        testId={thinkingTestId}
      />
      {state.availability !== "ready" && state.availability !== "loading" ? (
        <StatusIndicator
          label="Model"
          tone={state.availability === "error" ? "danger" : "neutral"}
          statusText={state.unavailableReason ?? "Unavailable"}
          testId={statusTestId}
        />
      ) : state.changeError ? (
        <StatusIndicator
          label="Change"
          tone="danger"
          statusText={state.changeError}
          testId={statusTestId}
        />
      ) : state.modelsError ? (
        <StatusIndicator
          label="Models"
          tone="warning"
          statusText={state.modelsError}
          testId={statusTestId}
        />
      ) : state.thinkingNotice ? (
        <StatusIndicator
          label="Thinking"
          tone={noticeTone(state.thinkingNotice.type)}
          statusText={state.thinkingNotice.message}
          testId={statusTestId}
        />
      ) : state.thinkingUnsupportedReason ? (
        <StatusIndicator
          label="Thinking"
          tone="info"
          statusText={state.thinkingUnsupportedReason}
          testId={statusTestId}
        />
      ) : null}
    </div>
  );
}

export default ModelThinkingPicker;
