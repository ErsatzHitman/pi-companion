import type { ExtensionFixtureScenario } from "../types.js";

/**
 * `advisor` — plan.md §11.7: "widget/panel with status, markdown, tool
 * activity, and logs".
 *
 * Modelled on the Phase 0 re-audit (`docs/pi-extension-compatibility.md`
 * §3.3 `advisor`): a view-only panel (no channel; the answer returns as the
 * `advisor` tool's result) composing `status` (consult phase), `markdown`
 * (the streamed answer), and two `log` sections — tool activity the advisor
 * ran on the caller's behalf, and the raw event tail — with a `cancel`
 * action (Esc aborts the child). The audit notes `advisor` and `loop` share
 * `loop/overlay.ts`'s stream-block engine; this fixture is nonetheless a
 * distinct, self-contained shape for `advisor`'s own required-UI columns
 * (no roster/progress, unlike `loop`). All ids/paths are synthetic
 * (plan.md §14.2).
 */
export const advisorFixture: ExtensionFixtureScenario = {
  extension: "advisor",
  description:
    "The advisor extension's view-only panel: status, the streamed markdown answer, tool-activity log, and raw event log, with a cancel action.",
  planRef: "plan.md §11.3 (panel/status/markdown/log), §11.7 (advisor)",
  frames: [
    {
      id: "advisor-panel-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0004",
            timestamp: "2026-09-04T10:15:00.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a1_0004",
              revision: 1,
              delta: {
                op: "upsert",
                element: {
                  id: "advisor-panel",
                  ns: "advisor",
                  kind: "panel",
                  placement: "inline",
                  title: "Advisor · synthetic-model · 6s",
                  actions: [{ id: "cancel", label: "Cancel", variant: "secondary" }],
                  payload: {
                    kind: "panel",
                    sections: [
                      {
                        id: "phase",
                        ns: "advisor",
                        kind: "status",
                        payload: { kind: "status", text: "consulting", tone: "accent" },
                      },
                      {
                        id: "answer",
                        ns: "advisor",
                        kind: "markdown",
                        payload: {
                          kind: "markdown",
                          text: "Synthetic advisor answer about `/tmp/synthetic.ts`.",
                        },
                      },
                      {
                        id: "activity",
                        ns: "advisor",
                        kind: "log",
                        title: "Tool activity",
                        payload: {
                          kind: "log",
                          lines: ["read /tmp/synthetic.ts", "grep synthetic-pattern"],
                        },
                      },
                      {
                        id: "events",
                        ns: "advisor",
                        kind: "log",
                        title: "Log",
                        payload: {
                          kind: "log",
                          lines: ["reply: 512 chars streamed"],
                          tail: 200,
                        },
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
      id: "advisor-cancel-request-1",
      direction: "client_to_daemon",
      wireType: "session(pi.ui.action.request)",
      note: "The user cancels the running advisor consult (Esc).",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.request",
          agentId: "agt_fixture_t40a1_0004",
          actionId: "cancel",
          elementId: "advisor-panel",
          payload: {},
          requestId: "req_fixture_t40a1_advisor_0001",
        },
      },
    },
    {
      id: "advisor-cancel-result-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_action_result)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0004",
            timestamp: "2026-09-04T10:15:02.000Z",
            event: {
              type: "pi_ui_action_result",
              provider: "pi",
              result: { actionId: "cancel", elementId: "advisor-panel", ok: true },
            },
          },
        },
      },
    },
  ],
};
