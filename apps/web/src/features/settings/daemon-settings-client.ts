import type { SettingsClient } from "./settings-client.js";

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` this
 * adapter would need, matching `daemon-agent-turn-client.ts`'s
 * `DaemonTurnClient` narrow-adapter convention (T28B2) exactly. Every
 * member is optional, mirroring `SettingsClient` itself.
 *
 * **T131 UPDATE**: auto-compaction's two methods now exist on the real
 * `DaemonClient` (`packages/client/src/daemon-client.ts`'s
 * `setAutoCompaction`/`getAutoCompaction`, sending
 * `set_auto_compaction_request`/`get_auto_compaction_request` —
 * `packages/protocol/src/messages.ts`), so this interface's shapes for
 * them now match the real class exactly — `setAutoCompaction` returns
 * `Promise<AgentProviderNotice | null>` (the same
 * `set_steering_mode_request`-style envelope `setSteeringMode` uses, per
 * `settings-client.ts`'s header comment), not the `Promise<void>` this
 * interface declared before the real method existed.
 *
 * **wire-apps-followup UPDATE**: auto-retry's two methods now exist on
 * the real `DaemonClient` too (`setAutoRetry`/`getAutoRetry`, sending
 * `set_auto_retry_request`/`get_auto_retry_request` —
 * `packages/protocol/src/messages.ts`), so this interface's shapes for
 * them now match the real class exactly — `setAutoRetry` returns the
 * same `Promise<AgentProviderNotice | null>` envelope. CORRECTED
 * (wire-apps-followup): this previously said "**Auto-retry remains
 * verified absent** — see `daemon-settings-client.test.ts`, which checks
 * this structurally against the live `DaemonClient` class" and that
 * "`createDaemonSettingsClient` below therefore still resolves
 * `getAutoRetry`/`setAutoRetry` to `undefined` for any real
 * `DaemonClient` today". Both sentences were true when written and are
 * false now that the wire has landed: `createDaemonSettingsClient`
 * resolves both to real bound functions for a real `DaemonClient`, and
 * `use-auto-retry.ts`'s `"unsupported"` state now covers only partial
 * fakes and stale clients, never a current real one.
 */
export interface DaemonSettingsClient {
  getAutoCompaction?(agentId: string): Promise<boolean>;
  setAutoCompaction?(
    agentId: string,
    enabled: boolean,
  ): Promise<{ type: string; message: string } | null>;
  getAutoRetry?(agentId: string): Promise<boolean>;
  setAutoRetry?(
    agentId: string,
    enabled: boolean,
  ): Promise<{ type: string; message: string } | null>;
}

/**
 * Builds a `SettingsClient` backed by a real (or fixture-driven fake)
 * `DaemonClient`-shaped object.
 *
 * `getAutoCompaction`/`getAutoRetry` are plain passthroughs (both sides
 * agree on `Promise<boolean>`). `setAutoCompaction`/`setAutoRetry` each
 * discard the daemon's `AgentProviderNotice | null` — `SettingsClient`'s
 * contract stays `Promise<void>` deliberately: `AgentSettingsPanel` never
 * surfaces provider notices (unlike the composer's queue-mode controls,
 * which do), so there is nothing this feature would do with one today.
 * `use-auto-compaction.ts`'s own round-trip discipline (call
 * `setAutoCompaction`, then re-fetch with `getAutoCompaction` and trust
 * THAT) makes the notice unnecessary for correctness: the re-fetched
 * value is what actually reaches the UI, not anything inferred from the
 * set call's response — and `use-auto-retry.ts` follows the identical
 * discipline for its own pair.
 *
 * CORRECTED (wire-apps-followup): this previously said
 * "`getAutoRetry`/`setAutoRetry` stay untranslated `undefined` for a real
 * `DaemonClient` today (see this file's module doc) — the day a future
 * task adds real wire methods for them". That day is now: both resolve
 * here with no shape change needed, the same way
 * `getAutoCompaction`/`setAutoCompaction` did the moment T131 landed.
 */
export function createDaemonSettingsClient(daemon: DaemonSettingsClient): SettingsClient {
  return {
    getAutoCompaction: daemon.getAutoCompaction
      ? (agentId: string): Promise<boolean> => daemon.getAutoCompaction!(agentId)
      : undefined,
    setAutoCompaction: daemon.setAutoCompaction
      ? async (agentId: string, enabled: boolean): Promise<void> => {
          await daemon.setAutoCompaction!(agentId, enabled);
        }
      : undefined,
    getAutoRetry: daemon.getAutoRetry
      ? (agentId: string): Promise<boolean> => daemon.getAutoRetry!(agentId)
      : undefined,
    setAutoRetry: daemon.setAutoRetry
      ? async (agentId: string, enabled: boolean): Promise<void> => {
          await daemon.setAutoRetry!(agentId, enabled);
        }
      : undefined,
  };
}
