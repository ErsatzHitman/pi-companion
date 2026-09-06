export const CLIENT_CAPS = {
  // COMPAT(selectiveAgentTimeline): added in v0.1.106. Capable clients receive
  // agent streams only for their explicit viewed set. Remove after 2027-01-12
  // once the supported client floor is >= v0.1.106.
  selectiveAgentTimeline: "selective_agent_timeline",
  reasoningMergeEnum: "reasoning_merge_enum",
  // COMPAT(customModeIcons): added in v0.1.84. Old clients pin AgentModeIcon to
  // a closed enum and crash rendering unknown values; daemon downgrades icons
  // outside the legacy set to "ShieldCheck" when this cap is absent. Drop the
  // gate when floor >= v0.1.84.
  customModeIcons: "custom_mode_icons",
  // COMPAT(terminalReflowableSnapshot): added in v0.1.88. The daemon attaches
  // per-row soft-wrap flags (gridWrapped/scrollbackWrapped) to terminal snapshots
  // only when the client advertises this, so restored content can reflow on resize.
  // Old clients use a strict TerminalState schema and would reject the extra fields.
  // Drop the gate (always send the flags) when floor >= v0.1.88.
  terminalReflowableSnapshot: "terminal_reflowable_snapshot",
  // COMPAT(providerSubagents): added in v0.1.107. The daemon emits provider-owned
  // child descriptors and timelines only to clients that understand the new messages.
  providerSubagents: "provider_subagents",
  // COMPAT(projectUpdates): added in v0.1.109, remove gate after 2027-01-15.
  projectUpdates: "project_updates",
  // COMPAT(compactProviderSnapshots): added in v0.2.X. Capable clients receive
  // provider catalogs with shared thinking sets and may revalidate by content hash.
  // Remove the legacy snapshot encoding after 2027-02-04.
  compactProviderSnapshots: "compact_provider_snapshots",
  browserHost: "browser_host",
  // COMPAT(piUiBridge): added in v0.3 fork, always true for now
  piUiBridge: "pi_ui_bridge",
  // COMPAT(piUiPayloadV2): added 2026-08-31, remove after 2027-02-28. Capable
  // clients read the canonical typed `payload` on Pi UI elements. This is a
  // separate gate from piUiBridge: a client may support the bridge (v1
  // top-level fields) without understanding canonical payloads, so the daemon
  // keeps emitting the legacy top-level projection until this cap is present.
  piUiPayloadV2: "pi_ui_payload_v2",
} as const;

export type ClientCapability = (typeof CLIENT_CAPS)[keyof typeof CLIENT_CAPS];
