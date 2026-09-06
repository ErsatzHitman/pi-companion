/**
 * §11.1 command-parity registry (T38A5, plan.md §11.1's "Pi's 32 RPC
 * commands" list).
 *
 * "Working on web" here means the user action reaches the client and a
 * *value comes back* — not that a handler exists, a type is exported, or
 * a button renders (plan.md's own "Registration is not receipt" rule).
 * Every `"covered"` entry below names the real, non-fake round trip that
 * proves it (a fixture test driving the real `@picompanion/client`
 * `DaemonClient` class over a fake WebSocket, never a hand-rolled test
 * double standing in for the daemon). Every `"gap"` entry names the
 * exact seam that is missing and, where this wave has already filed it,
 * the task that owns closing it.
 *
 * This registry is cross-checked against plan.md itself by
 * `rpc-command-web-parity.test.ts` — see `plan-section-11-1-commands.ts`
 * for the parser. Verified as of this task's commit against `main` at
 * `81a972a` plus this wave's own concurrent, uncommitted work; a stale
 * entry here (plan.md changed, this file did not) fails that test by
 * name, in both directions.
 */

import type { PlanRpcCommand } from "./plan-section-11-1-commands.js";

export type CommandCoverageStatus = "covered" | "gap";

export interface CommandCoverageEntry {
  readonly command: string;
  readonly status: CommandCoverageStatus;
  /**
   * For `"covered"`: the real client call and the test that proves a
   * value round-trips. For `"gap"`: the exact missing seam, and who
   * owns closing it when this wave has already filed that as a task.
   */
  readonly note: string;
}

export const SECTION_111_COMMAND_WEB_COVERAGE: readonly CommandCoverageEntry[] = [
  // --- conversation ---
  {
    command: "prompt",
    status: "covered",
    note:
      "AgentTurnClient.sendAgentMessage -> DaemonClient.sendAgentMessage (send_agent_message_request). " +
      "Wired into production at routes/screens/host-session-screen.tsx via createDaemonAgentTurnClient.",
  },
  {
    command: "steer",
    status: "covered",
    note:
      "Same send_agent_message_request channel as `prompt`; the daemon decides steer vs. new-turn by " +
      "timing (agent-turn-client.ts's module doc, and the Pi provider's startTurn). No separate client call exists " +
      "or is needed for a plain steer.",
  },
  {
    command: "follow_up",
    status: "covered",
    note:
      "Same send_agent_message_request channel as `prompt`; the daemon queues it as a follow-up when sent " +
      "before a turn starts. Per-message *forced* routing (T38B0a's optional streamingBehavior field) is NOT yet " +
      "exposed by AgentTurnClient — that is T38B1a's gap, tracked separately as `set_steering_mode`/`set_follow_up_mode` below.",
  },
  {
    command: "abort",
    status: "covered",
    note:
      "AgentTurnClient.cancelAgent -> DaemonClient.cancelAgent (cancel_agent_request). Required (non-optional) " +
      "interface member; wired to the composer's Stop control (Composer.test.tsx).",
  },

  // --- session lifecycle ---
  {
    command: "new_session",
    status: "covered",
    note:
      "SessionsClient.createSession -> DaemonAgentClient.createAgent (create_agent_request). Proven against the " +
      "real DaemonClient class over a fake WebSocket replaying the recorded `session-new` fixture in " +
      "daemon-sessions-client.fixture.test.ts.",
  },
  {
    command: "switch_session",
    status: "covered",
    note:
      "SessionResumeClient.resumeSession -> DaemonClient.fetchAgent + fetchAgentTimeline (fetch_agent_request / " +
      "fetch_agent_timeline_request). Proven against the real DaemonClient class in " +
      "daemon-session-resume-client.fixture.test.ts.",
  },
  {
    command: "fork",
    status: "gap",
    note:
      "DISCLOSED GAP (T38A3, still open): zero `forkAgent` method on the real @picompanion/client DaemonClient " +
      "and zero fork_agent_request/response wire message in packages/protocol/src/messages.ts (grep confirms both). " +
      "sessions-client.ts's ForkSessionInput/forkSession exist only as an optional client-interface member exercised " +
      "against a fake in tests; a real DaemonClient never satisfies it. Filed as T110 (depends-on this task). Closing " +
      "seam: fork_agent_request/fork_agent_response in packages/protocol/src/messages.ts, a session.ts handler that " +
      "turns it into the Pi provider's `fork` PiRpcCommand, and a DaemonClient.forkAgent method matching " +
      "daemon-sessions-client.ts's DaemonAgentClient.forkAgent shape.",
  },
  {
    command: "clone",
    status: "gap",
    note:
      "Same shape and same owner as `fork`'s gap (T110): zero `cloneAgent` method on DaemonClient, zero " +
      "clone_agent_request/response wire message. Closing seam: clone_agent_request/clone_agent_response plus a " +
      "DaemonClient.cloneAgent method matching DaemonAgentClient.cloneAgent.",
  },
  {
    command: "get_fork_messages",
    status: "gap",
    note:
      "No wire message of any kind exists for this — grep for get_fork_messages/ForkMessages across " +
      "packages/protocol/src/messages.ts and packages/client/src/daemon-client.ts returns zero. Nothing in web " +
      "previews the messages a fork point would carry before committing to it; CreateSessionDialog/session-tree.tsx " +
      "do not read one. Same natural owner as fork/clone (a protocol+client task), not filed as its own ticket yet.",
  },
  {
    command: "set_session_name",
    status: "gap",
    note:
      "DISCLOSED GAP (T38A4, still open): zero `renameAgent` method on the real DaemonClient and zero " +
      "rename_agent/set_session_name-shaped client wire message (daemon-sessions-client.ts's DaemonAgentClient.renameAgent " +
      "doc names this precisely; T38A0's mirror of Pi's set_session_name RPC command in " +
      "packages/server/.../pi/rpc-types.ts is daemon-internal only). RenameSessionDialog/useRenameSession are real UI " +
      "wired to an optional client member a real DaemonClient never implements, so a rename submitted today reaches " +
      "SESSIONS_ACTION_UNSUPPORTED, not the daemon. Natural owner named in that file's doc: T51A or a follow-up split " +
      "from it.",
  },

  // --- state and history ---
  {
    command: "get_state",
    status: "gap",
    note:
      "Partially reachable, not truly covered: DaemonClient.fetchAgent/fetch_agent_response gives status/model/title " +
      "(used by resumeSession above), but Pi's full get_state (steeringMode, followUpMode, queue depths as a pull, not " +
      "just a push) has no client path — get_queue_modes_request/response exist in packages/protocol/src/messages.ts " +
      "(T38B0c) but grep confirms zero DaemonClient method sends get_queue_modes_request. Same T38B1a gap as " +
      "set_steering_mode/set_follow_up_mode below.",
  },
  {
    command: "get_messages",
    status: "covered",
    note:
      "SessionResumeClient.resumeSession's fetchAgentTimeline call (fetch_agent_timeline_request/response) is the " +
      "web path for reading a session's message history; proven in daemon-session-resume-client.fixture.test.ts.",
  },
  {
    command: "get_entries",
    status: "covered",
    note:
      "Same fetchAgentTimeline round trip as `get_messages` — the daemon's timeline entries are transcript entries; " +
      "no separate wire message distinguishes 'messages' from 'entries' on the client side.",
  },
  {
    command: "get_tree",
    status: "gap",
    note:
      "DISCLOSED GAP, self-documented at session-tree-state.ts's module doc: SessionsScreen's session tree is built " +
      "entirely client-side from the flat SessionSummary list plus a client-tracked fork/clone relationships map — " +
      "there is no daemon get_tree RPC, and AgentSnapshotPayload carries no parent/fork/clone field at all (verified: " +
      "neither schema declares one). A session related to another from before this screen mounted, or via another " +
      "client entirely, always renders as its own root. Closing seam: a parent/fork-source field on " +
      "AgentSnapshotPayload/fetch_agents_response, populated from real Pi lineage — new protocol+server+core work.",
  },
  {
    command: "get_last_assistant_text",
    status: "gap",
    note:
      "No wire message and no client method reach this — grep for get_last_assistant_text/lastAssistantText across " +
      "packages/protocol/src/messages.ts and packages/client/src returns zero. Not filed as its own ticket.",
  },
  {
    command: "get_session_stats",
    status: "gap",
    note:
      "No wire message and no client method reach this — grep for get_session_stats/sessionStats/SessionStats " +
      "across packages/protocol/src/messages.ts and packages/client/src returns zero. No token-usage/turn-count " +
      "display exists in apps/web today. Not filed as its own ticket.",
  },

  // --- model and reasoning ---
  {
    command: "set_model",
    status: "covered",
    note:
      "AgentTurnClient.setAgentModel -> DaemonClient's set_agent_model_request. Proven against the real DaemonClient " +
      "class in composer/daemon-agent-turn-client.fixture.test.ts ('round-trips setAgentModel against a live " +
      "set_agent_model_response').",
  },
  {
    command: "cycle_model",
    status: "gap",
    note:
      "No 'cycle to the next model' action exists in apps/web — the composer only exposes explicit model selection " +
      "(setAgentModel by id) via listAvailableModels; no wire message or client method for a cycle step. Grep for " +
      "cycle_model/cycleModel across packages/protocol/src/messages.ts and packages/client/src returns zero.",
  },
  {
    command: "get_available_models",
    status: "covered",
    note:
      "AgentTurnClient.listAvailableModels -> DaemonClient's list_provider_models_request. Proven against the real " +
      "DaemonClient class in composer/daemon-agent-turn-client.fixture.test.ts ('round-trips listAvailableModels " +
      "against a live list_provider_models_response').",
  },
  {
    command: "set_thinking_level",
    status: "covered",
    note:
      "AgentTurnClient.setAgentThinkingOption -> DaemonClient's set_agent_thinking_request. Proven against the real " +
      "DaemonClient class in composer/daemon-agent-turn-client.fixture.test.ts ('round-trips setAgentThinkingOption " +
      "against a live set_agent_thinking_response').",
  },
  {
    command: "cycle_thinking_level",
    status: "gap",
    note:
      "Same shape as `cycle_model`'s gap: only explicit thinking-option selection exists (setAgentThinkingOption by " +
      "id); no cycle-to-next action or wire message.",
  },
  {
    command: "get_available_thinking_levels",
    status: "covered",
    note:
      "Carried as each AgentModelOption's own `thinkingOptions` array inside listAvailableModels'/" +
      "getAgentModelSnapshot's response — same round trip as `get_available_models`, not a separate wire message.",
  },

  // --- queues and automation ---
  {
    command: "set_steering_mode",
    status: "gap",
    note:
      "DISCLOSED GAP (T38B1a, depends on this task, not yet started): set_steering_mode_request/response exist in " +
      "packages/protocol/src/messages.ts (T38B0a) and the daemon session handles them end-to-end (T38B0c) — but grep " +
      "confirms zero DaemonClient method in packages/client/src/daemon-client.ts sends it, and agent-turn-client.ts's " +
      "own module doc records this explicitly ('no DaemonClient method sends any of them and no client method here " +
      "calls them'). A prior attempt via the generic set_agent_feature_request was tried and reverted because every " +
      "provider session rejects it.",
  },
  {
    command: "set_follow_up_mode",
    status: "gap",
    note:
      "Same gap and same owner (T38B1a) as `set_steering_mode` — set_follow_up_mode_request exists in the " +
      "protocol and the daemon (T38B0c), but no DaemonClient method sends it and no web control calls it.",
  },
  {
    command: "set_auto_compaction",
    status: "covered",
    note:
      "T131: DaemonClient.setAutoCompaction/getAutoCompaction -> set_auto_compaction_request/get_auto_compaction_request " +
      "(packages/protocol/src/messages.ts), handled end-to-end by packages/server/src/server/session.ts -> " +
      "AgentManager -> PiRpcAgentSession -> PiRuntimeSession.setAutoCompaction. Proven against the real DaemonClient " +
      "class in packages/client/src/daemon-client.test.ts, and mounted on web via " +
      "apps/web/src/features/settings/AgentSettingsPanel.tsx (routes/screens/host-settings-screen.tsx).",
  },
  {
    command: "set_auto_retry",
    status: "gap",
    note:
      "No wire message exists at all — grep for auto_retry/autoRetry/AutoRetry across the entire " +
      "packages/protocol/src/messages.ts returns zero (only the observational `pi_retry` event type exists).",
  },
  {
    command: "abort_retry",
    status: "gap",
    note:
      "No wire message exists at all — grep for abort_retry/abortRetry across the entire " +
      "packages/protocol/src/messages.ts returns zero.",
  },

  // --- maintenance and export ---
  {
    command: "compact",
    status: "gap",
    note:
      "No wire message for a user-triggered manual compaction exists — grep for a `compact`-shaped request literal " +
      "across packages/protocol/src/messages.ts returns zero (only the observational `compaction` timeline-entry type " +
      "and compaction_start/compaction_end events exist).",
  },
  {
    command: "export_html",
    status: "gap",
    note:
      "No wire message and no client method reach this — grep for export_html/exportHtml/exportHTML across " +
      "packages/protocol/src/messages.ts and packages/client/src returns zero. " +
      "No SESSION-export action exists in apps/web. (Qualified at the P6-W14 gate: T41B2 shipped a " +
      "diagnostics export — `useDiagnosticsExport`, `buildDiagnosticsExportBundle`, and a visible " +
      "`Export diagnostics (.json)` button — which is a different capability from `export_html`'s " +
      "session-transcript export. The unqualified sentence this replaced became literally false the " +
      "moment that landed. CORRECTED (T151): this previously said the sentence was kept on ONE " +
      "literal line so the guard entry above could still see it, because flattenProse joined " +
      "wrapped lines but not adjacent string literals. T151 (`c1888ec`) added " +
      "joinAdjacentStringLiterals in the very next wave, so a denying phrase split across a `+` " +
      "boundary is now caught and that rationale no longer applies. This note is its own proof: " +
      "it spans several literals and the guard still reads it as one sentence.)",
  },
  {
    command: "get_commands",
    status: "covered",
    note:
      "AgentTurnClient.listCommands -> DaemonClient's list_commands_request. Proven against the real DaemonClient " +
      "class in composer/daemon-agent-turn-client.fixture.test.ts ('round-trips listCommands against a live " +
      "list_commands_response, in daemon order'), and drives the composer's slash-command completion.",
  },

  // --- shell ---
  {
    command: "bash",
    status: "gap",
    note:
      "No client-reachable wire message for a standalone bash RPC command exists — grep for a bash-request literal " +
      "across packages/protocol/src/messages.ts returns zero. This is distinct from bash *tool-call* rendering during " +
      "a normal turn (transcript/tool-call-row.tsx already renders `tool.command` for the bash tool) — that is tool " +
      "execution streaming, not this RPC command, and is out of this list's scope.",
  },
  {
    command: "abort_bash",
    status: "gap",
    note: "Same shape as `bash`'s gap — no wire message exists to cancel a standalone bash RPC command specifically.",
  },
];

export interface CommandParityDiff {
  /** Commands plan.md's §11.1 list names that this registry does not classify at all. */
  readonly missingFromRegistry: readonly string[];
  /** Commands this registry classifies that plan.md's §11.1 list no longer names. */
  readonly staleInRegistry: readonly string[];
  /** A command plan.md's §11.1 list names more than once (would silently hide a duplicate classification need). */
  readonly duplicatesInPlan: readonly string[];
}

/**
 * Compares the live-parsed plan.md command list against this file's
 * registry. Both `missingFromRegistry` and `staleInRegistry` must be
 * empty for the two to agree — either one being non-empty is the
 * "plan.md and the check disagree" failure this task's acceptance
 * criteria require detecting, in each direction independently.
 */
export function diffPlanCommandsAgainstCoverage(
  planCommands: readonly PlanRpcCommand[],
  coverage: readonly CommandCoverageEntry[],
): CommandParityDiff {
  const planCommandNames = planCommands.map((entry) => entry.command);
  const planCommandSet = new Set(planCommandNames);
  const registrySet = new Set(coverage.map((entry) => entry.command));

  const seen = new Set<string>();
  const duplicatesInPlan: string[] = [];
  for (const name of planCommandNames) {
    if (seen.has(name)) duplicatesInPlan.push(name);
    seen.add(name);
  }

  const missingFromRegistry = [...planCommandSet].filter((name) => !registrySet.has(name));
  const staleInRegistry = [...registrySet].filter((name) => !planCommandSet.has(name));

  return { missingFromRegistry, staleInRegistry, duplicatesInPlan };
}
