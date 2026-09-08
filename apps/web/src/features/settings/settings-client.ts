/**
 * Auto-compaction / auto-retry settings port (T38B2, plan.md §11.1's
 * "queues and automation" RPC group: `set_auto_compaction`,
 * `set_auto_retry`, `abort_retry`).
 *
 * **T131 UPDATE — auto-compaction's world changed, auto-retry's did not.**
 * T131 built `set_auto_compaction_request`/`get_auto_compaction_request`
 * (`packages/protocol/src/messages.ts`), the `session.ts` handlers, the
 * `AgentManager`/`PiRpcAgentSession` methods, and
 * `DaemonClient.setAutoCompaction`/`getAutoCompaction`
 * (`packages/client/src/daemon-client.ts`) — exactly the three-layer shape
 * this comment's T38B2 finding below said was missing. Auto-compaction is
 * therefore no longer world 3: it now has a real wire, proven by
 * `daemon-client.test.ts`, `session.test.ts`, `agent-manager.test.ts` and
 * `pi/agent.test.ts`, and mounted on web via `AgentSettingsPanel` at
 * `routes/screens/host-settings-screen.tsx` through
 * `daemon-settings-client.ts`'s `createDaemonSettingsClient`. Auto-retry
 * still has no daemon-internal path at all (see below) and remains world 3
 * unchanged — this task deliberately built one setting's wire completely
 * rather than leaving both half-built (see this file's own
 * `SettingsClient` interface doc, unchanged, and
 * `daemon-settings-client.ts`'s module doc for the up-to-date split).
 *
 * The grep evidence immediately below is preserved verbatim as it stood
 * before T131 (auto-compaction's grep lines are now stale by construction
 * — that is what T131 closed — and are kept here only as the historical
 * record of the finding this task corrected, not as a current claim):
 *
 * - `grep -n "auto_compaction\|autoCompaction\|AutoCompaction" packages/protocol/src/messages.ts`
 *   -> zero hits. No `set_auto_compaction_request`/`_response` wire
 *   message exists, unlike `set_steering_mode_request` (T38B0a,
 *   `packages/protocol/src/messages.ts:1646-1657`).
 * - `grep -n "auto_retry\|autoRetry\|AutoRetry" packages/protocol/src/messages.ts`
 *   -> zero hits (only the observational `pi_retry` event type exists,
 *   fed by the Pi provider's `auto_retry_start`/`auto_retry_end`
 *   lifecycle events — see `packages/server/src/server/agent/providers/pi/agent.ts:2460-2483`
 *   — never by a user-settable toggle).
 * - `grep -rn "setAutoCompaction\|setAutoRetry\|getAutoCompaction\|getAutoRetry" packages/client/src/daemon-client.ts`
 *   -> zero hits. No shipped `DaemonClient` method sends anything for
 *   either setting.
 * - This is independently confirmed by
 *   `apps/web/src/features/sessions/rpc-command-web-parity.ts`'s own
 *   `"gap"` entries for `set_auto_compaction`, `set_auto_retry` and
 *   `abort_retry` (that file is this repository's audited registry of
 *   exactly this fact, cross-checked against plan.md by
 *   `rpc-command-web-parity.test.ts`).
 *
 * The two settings are not equally far from shippable, and the doc
 * comments throughout this feature say so precisely rather than
 * flattening them into one "not implemented" bucket:
 *
 * - **Auto-compaction** has a real, already-implemented daemon-internal
 *   path: `PiRuntimeSession.setAutoCompaction(enabled)` exists today
 *   (declared on the `PiRuntimeSession` interface in
 *   `packages/server/src/server/agent/providers/pi/runtime.ts`, backed by
 *   `cli-runtime.ts`'s `setAutoCompaction` method, which sends
 *   `{ type: "set_auto_compaction", enabled }`) and is already reachable
 *   from a `/autocompact` slash command inside a running turn
 *   (`packages/server/src/server/agent/providers/pi/agent.ts`'s
 *   `executeAutoCompactCommand`). What is missing is purely the outer
 *   layer: a `set_auto_compaction_request`/`_response` wire message
 *   (there is no protocol schema for it at all) plus a
 *   `packages/server/src/server/session.ts` handler turning it into that
 *   existing `runtimeSession.setAutoCompaction` call, plus a
 *   `DaemonClient.setAutoCompaction` method — the exact three-layer shape
 *   `set_steering_mode_request`/session handler/`DaemonClient.setSteeringMode`
 *   already have (T38B0a/T38B0c/T110). A `GetAutoCompaction`-shaped read
 *   would mirror `get_queue_modes_request` similarly, sourced from
 *   `PiSessionState.autoCompactionEnabled` (declared on `PiSessionState` in
 *   `packages/server/src/server/agent/providers/pi/rpc-types.ts`).
 *
 * - **Auto-retry has no daemon-internal path at all**, not even a slash
 *   command: `grep -n "retry" packages/server/src/server/agent/providers/pi/runtime.ts
 *   packages/server/src/server/agent/providers/pi/cli-runtime.ts` returns
 *   zero. Retries run unconditionally — `agent.ts`'s `handleSessionEvent`
 *   method, in its `auto_retry_start`/`auto_retry_end` cases, has no
 *   enablement check of any kind, it always forwards Pi's own retry
 *   lifecycle as `pi_retry` events. `rpc-types.ts`'s `PiRpcCommand` union
 *   declares a `set_auto_retry` Pi-RPC-command *arm*
 *   (`{ id?: string; type: "set_auto_retry"; enabled: boolean }`,
 *   added by T38A0 as a type-level mirror of Pi's own RPC surface) but
 *   `grep -rn "setAutoRetry" packages/server/src` is zero — nothing ever
 *   constructs or sends that command. Closing this gap needs a NEW
 *   `PiRuntimeSession.setAutoRetry` method (there is no Pi CLI runtime
 *   call to wrap it around yet, unlike auto-compaction's
 *   `cli-runtime.ts`'s `setAutoCompaction` method) in addition to the
 *   same three protocol/session/client layers auto-compaction needs.
 *   This is a strictly bigger gap than auto-compaction's.
 *
 * There is also a pre-existing GENERIC wire mechanism —
 * `set_agent_feature_request`/`_response` (`SetAgentFeatureRequestMessageSchema`/
 * `SetAgentFeatureResponseMessageSchema` in `packages/protocol/src/messages.ts`),
 * real and wired: `DaemonClient.setAgentFeature(agentId, featureId, value)`
 * exists (`packages/client/src/daemon-client.ts`) and the daemon session
 * handles it (`packages/server/src/server/session.ts` dispatches
 * `set_agent_feature_request` to
 * `AgentConfigSession.handleSetAgentFeatureRequest` in
 * `packages/server/src/server/session/agent-config/agent-config-session.ts`,
 * which calls `AgentManager.setAgentFeature`). It is NOT a usable closing
 * seam for either setting today: `AgentManager.setAgentFeature` requires
 * `agent.session.setFeature`, an OPTIONAL member of `AgentSession`
 * (declared on the `AgentSession` interface in
 * `packages/server/src/server/agent/agent-sdk-types.ts`) that the real Pi
 * provider class, `PiRpcAgentSession`, never implements — `grep -n "setFeature"
 * packages/server/src/server/agent/providers/pi/agent.ts` is zero, so
 * every `setAgentFeature` call against a live Pi agent rejects with
 * "Agent session does not support setting features" regardless of
 * `featureId`. `rpc-command-web-parity.ts`'s `set_steering_mode_request`
 * gap entry records this exact precedent for a different capability
 * ("A prior attempt via the generic
 * set_agent_feature_request was tried and reverted because every provider
 * session rejects it"). Wiring this feature's controls through
 * `setAgentFeature` would therefore look supported (the method exists on
 * a real `DaemonClient`) while failing every single call for Pi — exactly
 * the "enabled control whose only outcome is doing nothing" shape this
 * codebase has shipped and then reverted before. This port deliberately
 * does NOT use it; see `daemon-settings-client.ts`'s doc comment for how
 * the "renders truthfully" criterion is proven instead.
 *
 * Given all of the above, this file defines a purely INJECTED port —
 * `SettingsClient` — modeled directly on `agent-turn-client.ts`'s
 * `AgentTurnClient` (four independently-optional methods, the same
 * "a client that omits a method leaves the control in its own explained
 * unsupported state rather than throwing" contract `use-queue-modes.ts`
 * and `use-model-thinking.ts` already establish). No shipped
 * `@picompanion/client` `DaemonClient` implements any of these four
 * method names — `daemon-settings-client.ts` proves that against the
 * real class, not a hand-rolled stand-in.
 */
export interface SettingsClient {
  /**
   * Reads whether auto-compaction is currently enabled for this agent.
   * Daemon-side default, once this round-trips for real: `true` — see
   * `DAEMON_DEFAULT_AUTO_COMPACTION_ENABLED`'s doc comment below for the
   * exact citation.
   */
  getAutoCompaction?(agentId: string): Promise<boolean>;
  /** Changes whether auto-compaction is enabled for this agent. */
  setAutoCompaction?(agentId: string, enabled: boolean): Promise<void>;
  /**
   * Reads whether auto-retry is currently enabled for this agent. No real
   * provider can ever report `false` here today — see this file's header
   * comment on why auto-retry has no daemon-internal off-switch at all —
   * so a real implementation of this method does not exist to disagree
   * with that; `DAEMON_AUTO_RETRY_ALWAYS_ON` documents it instead.
   */
  getAutoRetry?(agentId: string): Promise<boolean>;
  /** Changes whether auto-retry is enabled for this agent. */
  setAutoRetry?(agentId: string, enabled: boolean): Promise<void>;
}

/**
 * Pi's real default for a fresh session, before any `/autocompact` command
 * or (future) `set_auto_compaction_request` runs — cited from the fake Pi
 * runtime double that stands in for a live Pi process in every server-side
 * test of this behaviour: `FakePiSession`'s constructor sets
 * `autoCompactionEnabled: true` unconditionally
 * (`packages/server/src/server/agent/providers/pi/test-utils/fake-pi.ts`),
 * matching how that same constructor's neighbouring `steeringMode`/
 * `followUpMode` defaults are documented there as "matched here so a test
 * that never calls setSteeringMode/setFollowUpMode still sees a real Pi
 * session's actual default, not an untouched... absence" — the identical
 * convention applies to `autoCompactionEnabled`.
 */
export const DAEMON_DEFAULT_AUTO_COMPACTION_ENABLED = true;

/**
 * Auto-retry's real daemon behaviour today: always on, with no
 * configuration point anywhere server-side — see this file's header
 * comment (`agent.ts`'s `handleSessionEvent` forwards every retry
 * lifecycle unconditionally; no `PiRuntimeSession` method or Pi CLI
 * runtime call exists to disable it). This is not "defaults to true and can be turned
 * off later" the way auto-compaction is — there is currently no daemon
 * concept of auto-retry being off at all.
 */
export const DAEMON_AUTO_RETRY_ALWAYS_ON = true;
