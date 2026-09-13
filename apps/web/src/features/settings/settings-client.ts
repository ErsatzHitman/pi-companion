/**
 * Auto-compaction / auto-retry settings port (T38B2, plan.md §11.1's
 * "queues and automation" RPC group: `set_auto_compaction`,
 * `set_auto_retry`, `abort_retry`).
 *
 * **wire-apps-followup UPDATE — auto-retry's world changed too.**
 * The `set_auto_retry_request`/`get_auto_retry_request` wire pair
 * (`packages/protocol/src/messages.ts`), the `session.ts` handlers, the
 * `AgentManager`/`PiRpcAgentSession` methods, and
 * `DaemonClient.setAutoRetry`/`getAutoRetry`
 * (`packages/client/src/daemon-client.ts`) have all landed, mirroring
 * T131's auto-compaction shape exactly. Auto-retry is therefore no
 * longer world 3 either: it now has a real wire, mounted on web through
 * `daemon-settings-client.ts`'s `createDaemonSettingsClient` the same way
 * auto-compaction is. CORRECTED (wire-apps-followup): this previously
 * said "Auto-retry still has no daemon-internal path at all (see below)
 * and remains world 3 unchanged". That sentence was true when T131 wrote
 * it and is false now that the auto-retry wire has landed.
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
 * CORRECTED (wire-apps-followup): the preceding two sentences are preserved
 * verbatim as T131 wrote them — auto-retry's wire has since landed (see the
 * wire-apps-followup UPDATE above), so they are historical record, not
 * current claims.
 *
 * The grep evidence immediately below is preserved verbatim as it stood
 * before T131 (auto-compaction's grep lines are now stale by construction
 * — that is what T131 closed — and are kept here only as the historical
 * record of the finding this task corrected, not as a current claim).
 * CORRECTED (wire-apps-followup): auto-retry's two grep lines below are
 * now stale the same way — `set_auto_retry_request`/`_response` and
 * `get_auto_retry_request`/`_response` exist in
 * `packages/protocol/src/messages.ts`, and `DaemonClient.setAutoRetry`/
 * `getAutoRetry` exist in `packages/client/src/daemon-client.ts`. They are
 * kept verbatim as the historical record T131 recorded, not as current
 * claims; `rpc-command-web-parity.ts`'s `set_auto_retry` entry is now
 * `"covered"`, leaving only `abort_retry` as a gap in this group.
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
 * - **Auto-retry now has the same three-layer wire auto-compaction got
 *   in T131.** CORRECTED (wire-apps-followup): this previously said
 *   "**Auto-retry has no daemon-internal path at all**, not even a slash
 *   command: `grep -n \"retry\" ...` returns zero. Retries run
 *   unconditionally" and that closing the gap "needs a NEW
 *   `PiRuntimeSession.setAutoRetry` method (there is no Pi CLI runtime call
 *   to wrap it around yet)". That was true when written and is false now:
 *   `PiRuntimeSession.setAutoRetry` exists, the
 *   `set_auto_retry_request`/`get_auto_retry_request` wire pair exists,
 *   and `DaemonClient.setAutoRetry`/`getAutoRetry` send them — the same
 *   three-layer shape auto-compaction has. The historical grep lines are
 *   preserved above as the record of what T38B2 found, not as current
 *   claims.
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
 * and `use-model-thinking.ts` already establish). CORRECTED
 * (wire-apps-followup): this previously said "No shipped
 * `@picompanion/client` `DaemonClient` implements any of these four
 * method names — `daemon-settings-client.ts` proves that against the
 * real class". That was true when T38B2 wrote it and false now: a current
 * real `DaemonClient` implements all four, and
 * `daemon-settings-client.ts` now proves their PRESENCE (not absence)
 * against the real class — the `"unsupported"` state survives only for
 * partial fakes and stale clients.
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
   * Reads whether auto-retry is currently enabled for this agent.
   * CORRECTED (wire-apps-followup): this previously said "No real
   * provider can ever report `false` here today — see this file's header
   * comment on why auto-retry has no daemon-internal off-switch at all —
   * so a real implementation of this method does not exist". That was
   * true when written and is false now: the daemon has a real off-switch
   * (`PiRuntimeSession.setAutoRetry` + the `set_auto_retry_request` wire),
   * so a real implementation exists and can report `false`;
   * `DAEMON_AUTO_RETRY_ALWAYS_ON` below now documents only the fallback
   * explanation for clients that still omit this pair, not the daemon's
   * real behaviour.
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
 * Auto-retry's fallback explanation for clients that still omit the
 * get/set pair (partial fakes, stale builds). CORRECTED
 * (wire-apps-followup): this previously said "Auto-retry's real daemon
 * behaviour today: always on, with no configuration point anywhere
 * server-side" and "there is currently no daemon concept of auto-retry
 * being off at all". That was true when written and is false now: the
 * daemon has a real configuration point (`PiRuntimeSession.setAutoRetry`
 * + the `set_auto_retry_request`/`get_auto_retry_request` wire), so "off"
 * is a real state a current daemon reports. This constant stays `true`
 * only as the daemon's default for a fresh session (matching
 * auto-compaction's `DAEMON_DEFAULT_AUTO_COMPACTION_ENABLED` convention)
 * and as the truthful `"unsupported"` text for connections that cannot
 * change it yet — not as a claim about what the daemon can do.
 */
export const DAEMON_AUTO_RETRY_ALWAYS_ON = true;
