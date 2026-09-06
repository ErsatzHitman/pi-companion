/**
 * Shared shape for a single boolean agent setting's live state
 * (`use-auto-compaction.ts`, `use-auto-retry.ts`), following
 * `use-queue-modes.ts`'s `QueueModesAvailability`/`QueueModesState`
 * convention exactly, narrowed to one boolean instead of a mode pair.
 *
 * - `"no-client"`: no live settings client is wired at all.
 * - `"unsupported"`: a client is wired but omits this setting's get/set
 *   pair — see `settings-client.ts`'s header comment for why this is
 *   the state a real `DaemonClient` renders today for BOTH settings.
 * - `"loading"`: the initial fetch is in flight.
 * - `"error"`: the initial fetch failed; `unavailableReason` carries the
 *   daemon's raw explanation.
 * - `"ready"`: a value has loaded and is visible without opening
 *   anything.
 */
export type AgentSettingAvailability = "no-client" | "unsupported" | "loading" | "ready" | "error";

export interface AgentSettingState {
  availability: AgentSettingAvailability;
  /** Human explanation for a non-`"ready"` `availability`, or `null` once ready. */
  unavailableReason: string | null;
  /** The setting's current value, or `null` before it has ever loaded. */
  enabled: boolean | null;
  /** `true` while a change call is in flight. */
  isChanging: boolean;
  /** The most recent change failure, or `null`. Cleared at the start of the next call. */
  changeError: string | null;
  /** Changes the setting. No-op while `availability !== "ready"` or another change is already in flight. */
  setEnabled: (next: boolean) => Promise<void>;
}
