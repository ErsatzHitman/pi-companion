import type { ChangeEvent } from "react";

import { Select, StatusIndicator } from "../../ui/primitives/index.js";
import type { SelectOption, StatusTone } from "../../ui/primitives/index.js";
import type { QueueMode } from "./agent-turn-client.js";
import type { QueueModesState } from "./use-queue-modes.js";

/** The wire value for "provider reports no mode at all" (`steeringMode`/`followUpMode: null`) — never a real `QueueMode`, so it is safe as a `<select>` placeholder value. */
const NOT_REPORTED_OPTION_VALUE = "";

/**
 * Steer and follow-up mode control (T38B1a, plan.md §11.1 "queues and
 * automation"). Composes the `Select` primitive (plan.md §10.3: native
 * `<select>`, so the current mode is always visible collapsed — the
 * "visible without opening a menu" acceptance criterion — and fully
 * keyboard-operable) with `StatusIndicator` for the same "explain rather
 * than silently empty" treatment `ModelThinkingPicker` uses.
 *
 * **This control is intentionally about the whole session, never a
 * single queued message**: it has no per-item list, no cancel button, no
 * reorder affordance, because Pi exposes no such command (T38B1a's
 * acceptance criteria; see `Composer.test.tsx`'s "offers no button at
 * all" assertion, which fails the moment anything like that is added).
 * The explanatory copy below states the mode-vs-per-message
 * distinction directly in the UI, not only in a comment, because it is
 * easy to conflate the two: this control decides how several
 * already-queued messages are *delivered* (together, or one per cycle);
 * it does not decide whether any single message steers the running turn
 * or waits behind it — that per-message choice is a separate control.
 *
 * Three layers of "unavailable options are explained":
 *
 * 1. Whole-control unavailability (`state.availability`): no client
 *    wired, a wired client that cannot change the mode yet, or the
 *    initial fetch failing — all three render the same disabled pair of
 *    selects plus a `StatusIndicator` naming the reason.
 * 2. A provider that reports no mode at all (`steeringMode`/
 *    `followUpMode: null` while `availability === "ready"`): the select
 *    shows a "Not reported" placeholder rather than a real `QueueMode`
 *    value that was never actually observed.
 * 3. A change in flight or a failed change: `StatusIndicator` names it.
 *
 * A fourth, T127 addition: a successful `setSteeringMode`/`setFollowUpMode`
 * call can carry the daemon's own provider notice (e.g. "this applies from
 * the next turn") — `state.steeringNotice`/`state.followUpNotice`, the same
 * "carry the notice through and render it" treatment
 * `ModelThinkingPicker.tsx` already gives `thinkingNotice`. A `null` notice
 * (the common case — most changes carry none) renders nothing here, same
 * as there.
 */
export interface QueueModePickerProps {
  state: QueueModesState;
  testId?: string;
}

function unavailableSelectOptions(state: QueueModesState): SelectOption[] {
  return [
    {
      value: "",
      label: state.availability === "loading" ? "Loading…" : "—",
    },
  ];
}

const MODE_OPTIONS: SelectOption[] = [
  { value: "one-at-a-time", label: "One at a time (default)" },
  { value: "all", label: "All together" },
];

function noticeTone(type: "info" | "warning" | "error"): StatusTone {
  if (type === "error") return "danger";
  if (type === "warning") return "warning";
  return "info";
}

function modeSelectOptions(state: QueueModesState, current: QueueMode | null): SelectOption[] {
  if (state.availability !== "ready") return unavailableSelectOptions(state);
  if (current === null) {
    return [
      { value: NOT_REPORTED_OPTION_VALUE, label: "Not reported by this provider" },
      ...MODE_OPTIONS,
    ];
  }
  return MODE_OPTIONS;
}

export function QueueModePicker({ state, testId }: QueueModePickerProps) {
  const steeringTestId = testId ? `${testId}-steering` : undefined;
  const followUpTestId = testId ? `${testId}-follow-up` : undefined;
  const statusTestId = testId ? `${testId}-status` : undefined;

  const disabled =
    state.availability !== "ready" || state.isChangingSteeringMode || state.isChangingFollowUpMode;

  function handleSteeringChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    if (value !== "all" && value !== "one-at-a-time") return;
    void state.setSteeringMode(value);
  }

  function handleFollowUpChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    if (value !== "all" && value !== "one-at-a-time") return;
    void state.setFollowUpMode(value);
  }

  return (
    <div className="pc-composer__queue-modes" data-testid={testId}>
      <p className="pc-composer__queue-modes-help">
        These two settings control how several already-queued messages are delivered for the whole
        session — one at a time, or all together. They do not decide whether a single message steers
        the running turn or waits for it to finish; that choice is made per message, separately,
        when you send it.
      </p>
      <Select
        label="Steering queue delivery"
        options={modeSelectOptions(state, state.steeringMode)}
        value={
          state.availability === "ready" ? (state.steeringMode ?? NOT_REPORTED_OPTION_VALUE) : ""
        }
        disabled={disabled}
        onChange={handleSteeringChange}
        testId={steeringTestId}
      />
      <Select
        label="Follow-up queue delivery"
        options={modeSelectOptions(state, state.followUpMode)}
        value={
          state.availability === "ready" ? (state.followUpMode ?? NOT_REPORTED_OPTION_VALUE) : ""
        }
        disabled={disabled}
        onChange={handleFollowUpChange}
        testId={followUpTestId}
      />
      {state.availability !== "ready" && state.availability !== "loading" ? (
        <StatusIndicator
          label="Queue mode"
          tone={state.availability === "error" ? "danger" : "neutral"}
          statusText={state.unavailableReason ?? "Unavailable"}
          testId={statusTestId}
        />
      ) : state.changeError ? (
        <StatusIndicator
          label="Queue mode"
          tone="danger"
          statusText={state.changeError}
          testId={statusTestId}
        />
      ) : state.steeringNotice ? (
        <StatusIndicator
          label="Steering queue"
          tone={noticeTone(state.steeringNotice.type)}
          statusText={state.steeringNotice.message}
          testId={statusTestId}
        />
      ) : state.followUpNotice ? (
        <StatusIndicator
          label="Follow-up queue"
          tone={noticeTone(state.followUpNotice.type)}
          statusText={state.followUpNotice.message}
          testId={statusTestId}
        />
      ) : null}
    </div>
  );
}

export default QueueModePicker;
