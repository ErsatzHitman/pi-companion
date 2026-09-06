import { StatusIndicator, Toggle } from "../../ui/primitives/index.js";

import type { AgentSettingState } from "./agent-setting-state.js";

/**
 * Auto-compaction / auto-retry settings surface (T38B2). Composes the
 * `Toggle` primitive (plan.md §10.3: `role="switch"` +
 * `aria-checked`, kept in sync with the setting's real value — so a
 * change "takes effect without a reload" is directly observable in the
 * DOM via `aria-checked`, no page refresh involved) with
 * `StatusIndicator` for the same "explain rather than silently disable"
 * treatment `QueueModePicker.tsx`/`ModelThinkingPicker.tsx` use.
 *
 * Each row is independent: a real daemon could plausibly support one
 * setting and not the other (auto-compaction's daemon-internal path
 * already exists; auto-retry's does not — see `use-auto-retry.ts`'s doc
 * comment), so `AgentSettingState` is read per-row rather than as one
 * combined availability.
 */
export interface AgentSettingsPanelProps {
  autoCompaction: AgentSettingState;
  autoRetry: AgentSettingState;
  testId?: string;
}

function rowDisabled(state: AgentSettingState): boolean {
  return state.availability !== "ready" || state.isChanging;
}

function rowChecked(state: AgentSettingState): boolean {
  return state.availability === "ready" && state.enabled === true;
}

function rowStatus(state: AgentSettingState): { tone: "danger" | "neutral"; text: string } | null {
  if (state.availability !== "ready" && state.availability !== "loading") {
    return {
      tone: state.availability === "error" ? "danger" : "neutral",
      text: state.unavailableReason ?? "Unavailable",
    };
  }
  if (state.changeError) {
    return { tone: "danger", text: state.changeError };
  }
  return null;
}

function SettingRow({
  label,
  state,
  toggleTestId,
  statusTestId,
}: {
  label: string;
  state: AgentSettingState;
  toggleTestId?: string;
  statusTestId?: string;
}) {
  const status = rowStatus(state);
  return (
    <div className="pc-agent-settings__row">
      <Toggle
        label={label}
        checked={rowChecked(state)}
        disabled={rowDisabled(state)}
        onCheckedChange={(next) => void state.setEnabled(next)}
        testId={toggleTestId}
      />
      {status ? (
        <StatusIndicator
          label={label}
          tone={status.tone}
          statusText={status.text}
          testId={statusTestId}
        />
      ) : null}
    </div>
  );
}

export function AgentSettingsPanel({ autoCompaction, autoRetry, testId }: AgentSettingsPanelProps) {
  const compactionToggleTestId = testId ? `${testId}-auto-compaction-toggle` : undefined;
  const compactionStatusTestId = testId ? `${testId}-auto-compaction-status` : undefined;
  const retryToggleTestId = testId ? `${testId}-auto-retry-toggle` : undefined;
  const retryStatusTestId = testId ? `${testId}-auto-retry-status` : undefined;

  return (
    <div className="pc-agent-settings" data-testid={testId}>
      <SettingRow
        label="Auto-compaction"
        state={autoCompaction}
        toggleTestId={compactionToggleTestId}
        statusTestId={compactionStatusTestId}
      />
      <SettingRow
        label="Auto-retry"
        state={autoRetry}
        toggleTestId={retryToggleTestId}
        statusTestId={retryStatusTestId}
      />
    </div>
  );
}

export default AgentSettingsPanel;
