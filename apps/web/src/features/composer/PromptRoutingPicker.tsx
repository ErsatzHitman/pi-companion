import type { ChangeEvent } from "react";

import { Select } from "../../ui/primitives/index.js";
import type { SelectOption } from "../../ui/primitives/index.js";
import type { PromptStreamingBehavior } from "./agent-turn-client.js";

/** The `<select>` value standing in for "no explicit choice" (`streamingBehavior: undefined`). Never a real `PromptStreamingBehavior`, so it is safe as a placeholder value. */
const AUTO_OPTION_VALUE = "auto";

const OPTIONS: SelectOption[] = [
  { value: AUTO_OPTION_VALUE, label: "Auto (default)" },
  { value: "steer", label: "Steer — interrupt the running turn" },
  { value: "followUp", label: "Follow-up — wait until it's idle" },
];

export interface PromptRoutingPickerProps {
  /** The routing this specific, not-yet-sent message will carry. `null` is "Auto" (T38B1b's documented default). */
  value: PromptStreamingBehavior | null;
  onChange: (value: PromptStreamingBehavior | null) => void;
  testId?: string;
}

/**
 * Per-message steer/follow-up routing control (T38B1b, plan.md §11.1
 * "queues and automation"). Composes the `Select` primitive (plan.md
 * §10.3), the same "native `<select>`, always visible collapsed, fully
 * keyboard-operable" treatment `QueueModePicker` uses for the session-wide
 * mode — this control is the sibling `QueueModePicker`'s own help copy
 * already promises: "that choice is made per message, separately, when
 * you send it."
 *
 * **This is not `QueueModePicker`** (`use-queue-modes.ts`, T38B1a). That
 * control is a whole-session *setting*, round-tripped through
 * `getQueueModes`/`setSteeringMode`/`setFollowUpMode` and reflecting a
 * live push from other clients — it decides how *several* already-queued
 * messages are delivered once more than one is waiting. This control is
 * plain local UI state with no daemon round trip of its own: it decides
 * which queue *the very next message* enters, and travels to the daemon
 * only by riding along on that message's own `send_agent_message_request`
 * (`SendAgentMessageOptions.streamingBehavior`, `use-composer.ts`'s
 * `submit()`). There is nothing to fetch and nothing another connected
 * client could change out from under this one, so there is no loading or
 * error state to render — unlike every other picker in this directory,
 * it is never disabled.
 *
 * CORRECTED (P6-W7 merge gate). Two claims above were false when this
 * file shipped. The choice did NOT travel to the daemon: the real
 * `DaemonClient.sendAgentMessage` had no `streamingBehavior` in its
 * `SendMessageOptions` and never spread one onto the request, so every
 * choice died one call past `createDaemonAgentTurnClient` — silently,
 * with no banner and no error, which is a worse outcome than the visible
 * failure states T39B and T114 chose in this same wave. And "no
 * 'unsupported' state to render" followed from that: the shipped client
 * WAS an unsupported client. The gate closed the gap in
 * `packages/client/src/daemon-client.ts` rather than gating this control,
 * so the sentences above are true now. Keep them true: if a future change
 * can make the choice unreachable again, this picker needs the disabled
 * treatment `EditFromHereSurface` uses, not prose.
 *
 * **The default is "Auto", not "Steer" or "Follow-up"** (this task's
 * "sensible documented default" acceptance criterion): `value: null`
 * sends no `streamingBehavior` at all, which is exactly what a plain
 * `sendAgentMessage` call did before this control existed — the daemon's
 * own turn-state-derived choice (`agent-turn-client.ts`'s header comment)
 * is untouched unless the user explicitly overrides it here. Making the
 * *un-chosen* state a silent no-op, rather than defaulting the select to
 * an explicit "Steer" or "Follow-up" that fires on every single message
 * a user never thought about, is the deliberately conservative choice.
 *
 * `use-composer.ts`'s `submit()` resets this control back to "Auto" once
 * the choice has been consumed by a submission (`promptRouting`'s own
 * doc comment there): a routing choice is a modifier for *one* message,
 * not a sticky session setting, so it does not silently keep steering
 * (or queuing) every later message the user sends without looking again.
 */
export function PromptRoutingPicker({ value, onChange, testId }: PromptRoutingPickerProps) {
  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    const next = event.target.value;
    if (next === "steer" || next === "followUp") {
      onChange(next);
      return;
    }
    onChange(null);
  }

  return (
    <Select
      label="Send this message as"
      options={OPTIONS}
      value={value ?? AUTO_OPTION_VALUE}
      onChange={handleChange}
      testId={testId}
    />
  );
}

export default PromptRoutingPicker;
