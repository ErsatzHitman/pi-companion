import type { ExtensionFixtureScenario } from "../types.js";

/**
 * `subagents` — plan.md §11.7: "prominent roster with running, blocked,
 * done, usage, and cancel/open actions".
 *
 * Published over the `subagents:fleet` channel. This fixture carries the
 * shape the client actually receives *after* daemon synthesis
 * (`packages/server/src/server/agent/providers/pi/ui-bridge/state.ts`'s
 * `applyChannel` `"subagents:fleet"` case, lines ~558-577): a `roster`
 * element `id:"fleet"`, `ns:"subagents"`, `placement:"pinned"`, whose rows
 * carry `state`/`detail`/per-row `actions` — never the extension-internal
 * channel payload, which never reaches the client directly. All ids/paths
 * are synthetic (plan.md §14.2).
 */
export const subagentsFixture: ExtensionFixtureScenario = {
  extension: "subagents",
  description:
    "The subagents extension's fleet roster (subagents:fleet channel, daemon-synthesized): running, blocked, and done rows with usage detail and per-row cancel/open actions.",
  planRef: "plan.md §11.3 (roster), §11.5 (pinned), §11.7 (subagents, subagents:fleet channel)",
  channel: "subagents:fleet",
  frames: [
    {
      id: "fleet-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0002",
            timestamp: "2026-09-04T10:05:00.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a1_0002",
              revision: 1,
              delta: {
                op: "upsert",
                element: {
                  id: "fleet",
                  ns: "subagents",
                  kind: "roster",
                  placement: "pinned",
                  title: "Subagent fleet (1 running)",
                  durable: true,
                  payload: {
                    kind: "roster",
                    rows: [
                      {
                        id: "job-1",
                        label: "research: synthetic query on /tmp/synthetic.ts",
                        state: "running",
                        detail: "opencode/deepseek-v4-flash · 42s · 1.2k tokens",
                        actions: [
                          {
                            id: "cancel",
                            label: "Cancel",
                            variant: "danger",
                            confirm: "Cancel this subagent?",
                          },
                          { id: "open", label: "Open" },
                        ],
                      },
                      {
                        id: "job-2",
                        label: "lint: synthetic sweep",
                        state: "blocked",
                        detail: "waiting on job-1",
                        actions: [{ id: "open", label: "Open" }],
                      },
                      {
                        id: "job-3",
                        label: "docs: synthetic summary",
                        state: "done",
                        detail: "12.3k tokens · 8s",
                        actions: [{ id: "open", label: "Open" }],
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      id: "fleet-cancel-request-1",
      direction: "client_to_daemon",
      wireType: "session(pi.ui.action.request)",
      note: "The user cancels the running job-1 row.",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.request",
          agentId: "agt_fixture_t40a1_0002",
          actionId: "cancel",
          elementId: "fleet",
          payload: { rowId: "job-1" },
          requestId: "req_fixture_t40a1_subagents_0001",
        },
      },
    },
    {
      id: "fleet-cancel-response-1",
      direction: "daemon_to_client",
      wireType: "session(pi.ui.action.response)",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.response",
          payload: { requestId: "req_fixture_t40a1_subagents_0001", ok: true, error: null },
        },
      },
    },
    {
      id: "fleet-cancel-result-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_action_result)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0002",
            timestamp: "2026-09-04T10:05:03.000Z",
            event: {
              type: "pi_ui_action_result",
              provider: "pi",
              result: { actionId: "cancel", elementId: "fleet", ok: true },
            },
          },
        },
      },
    },
    {
      id: "fleet-upsert-2",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      note: "job-1 moves to done after cancellation settles.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0002",
            timestamp: "2026-09-04T10:05:04.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a1_0002",
              revision: 2,
              delta: {
                op: "upsert",
                element: {
                  id: "fleet",
                  ns: "subagents",
                  kind: "roster",
                  placement: "pinned",
                  title: "Subagent fleet (0 running)",
                  durable: true,
                  payload: {
                    kind: "roster",
                    rows: [
                      {
                        id: "job-1",
                        label: "research: synthetic query on /tmp/synthetic.ts",
                        state: "done",
                        detail: "cancelled · 45s",
                        actions: [{ id: "open", label: "Open" }],
                      },
                      {
                        id: "job-2",
                        label: "lint: synthetic sweep",
                        state: "done",
                        detail: "9.1k tokens · 6s",
                        actions: [{ id: "open", label: "Open" }],
                      },
                      {
                        id: "job-3",
                        label: "docs: synthetic summary",
                        state: "done",
                        detail: "12.3k tokens · 8s",
                        actions: [{ id: "open", label: "Open" }],
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
  ],
};
