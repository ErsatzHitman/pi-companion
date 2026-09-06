import type { ExtensionFixtureScenario } from "../types.js";

/**
 * `loop` — plan.md §11.7: "panel containing status, markdown, roster,
 * progress, and log; stop/details actions".
 *
 * Modelled on the Phase 0 re-audit (`docs/pi-extension-compatibility.md`
 * §3.3 `loop`): the extension's `ui.widget("advisor-live-panel", ...)`
 * helper call emits one `panel` composing `status` (phase), `markdown`
 * (the request under review), `roster` (participating roles), `progress`
 * (round completion), and `log` (streamed events), placed as a `sheet`.
 * All ids/paths are synthetic (plan.md §14.2); nothing here was captured
 * from a real daemon or copied from `D:\paseo`.
 */
export const loopFixture: ExtensionFixtureScenario = {
  extension: "loop",
  description:
    "The loop extension's live panel: a sheet composing status, markdown, a role roster, progress, and a streaming log, with stop/details actions.",
  planRef: "plan.md §11.3 (panel/status/markdown/roster/progress/log), §11.5 (sheet), §11.7 (loop)",
  frames: [
    {
      id: "loop-panel-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0001",
            timestamp: "2026-09-04T10:00:00.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a1_0001",
              revision: 1,
              delta: {
                op: "upsert",
                element: {
                  id: "loop-panel",
                  ns: "loop",
                  kind: "panel",
                  placement: "sheet",
                  title: "Loop · review · round 2 of 5",
                  durable: true,
                  actions: [
                    {
                      id: "stop",
                      label: "Stop",
                      variant: "danger",
                      confirm: "Stop the running loop?",
                    },
                    { id: "details", label: "Details", variant: "secondary" },
                  ],
                  payload: {
                    kind: "panel",
                    sections: [
                      {
                        id: "phase",
                        ns: "loop",
                        kind: "status",
                        payload: { kind: "status", text: "consulting — review", tone: "accent" },
                      },
                      {
                        id: "request",
                        ns: "loop",
                        kind: "markdown",
                        payload: {
                          kind: "markdown",
                          text: "Review changes to `/tmp/synthetic.ts`",
                        },
                      },
                      {
                        id: "roles",
                        ns: "loop",
                        kind: "roster",
                        title: "Roles",
                        payload: {
                          kind: "roster",
                          rows: [
                            {
                              id: "role-reviewer",
                              label: "reviewer",
                              state: "running",
                              detail: "synthetic-model",
                            },
                            { id: "role-implementer", label: "implementer", state: "idle" },
                          ],
                        },
                      },
                      {
                        id: "progress",
                        ns: "loop",
                        kind: "progress",
                        payload: { kind: "progress", value: 0.4, max: 1, label: "round 2 of 5" },
                      },
                      {
                        id: "events",
                        ns: "loop",
                        kind: "log",
                        payload: {
                          kind: "log",
                          lines: ["reviewer: reply received — 1,234 chars"],
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
      id: "loop-stop-request-1",
      direction: "client_to_daemon",
      wireType: "session(pi.ui.action.request)",
      note: "The user taps Stop on the loop panel.",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.request",
          agentId: "agt_fixture_t40a1_0001",
          actionId: "stop",
          elementId: "loop-panel",
          payload: {},
          requestId: "req_fixture_t40a1_loop_0001",
        },
      },
    },
    {
      id: "loop-stop-response-1",
      direction: "daemon_to_client",
      wireType: "session(pi.ui.action.response)",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.response",
          payload: { requestId: "req_fixture_t40a1_loop_0001", ok: true, error: null },
        },
      },
    },
    {
      id: "loop-stop-result-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_action_result)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0001",
            timestamp: "2026-09-04T10:00:05.000Z",
            event: {
              type: "pi_ui_action_result",
              provider: "pi",
              result: { actionId: "stop", elementId: "loop-panel", ok: true },
            },
          },
        },
      },
    },
  ],
};
