import type { ExtensionFixtureScenario } from "../types.js";

/**
 * `todo` — plan.md §11.7: "pinned task widget with collapse and item
 * state".
 *
 * Modelled on the Phase 0 re-audit (`docs/pi-extension-compatibility.md`
 * §3.3 `todo`): legacy `ctx.ui.setWidget("rpiv-todos")` maps onto the
 * bridge `widget` kind, `id:"rpiv-todos"` preserved for replay, `placement`
 * pinned. Rows carry per-item state via `label`/`detail`/`tone`
 * (`PiUiWidgetRowSchema`); collapse is a per-element action, not something
 * the model drives. All ids/paths are synthetic (plan.md §14.2).
 */
export const todoFixture: ExtensionFixtureScenario = {
  extension: "todo",
  description:
    "The todo extension's pinned task widget: item rows with checked/pending state and a collapse action.",
  planRef: "plan.md §11.3 (widget), §11.5 (pinned), §11.7 (todo)",
  frames: [
    {
      id: "todo-widget-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0003",
            timestamp: "2026-09-04T10:10:00.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a1_0003",
              revision: 1,
              delta: {
                op: "upsert",
                element: {
                  id: "rpiv-todos",
                  ns: "todo",
                  kind: "widget",
                  placement: "pinned",
                  title: "Todos (1/3)",
                  durable: true,
                  actions: [{ id: "collapse", label: "Collapse", variant: "secondary" }],
                  payload: {
                    kind: "widget",
                    rows: [
                      {
                        id: "item-1",
                        label: "synthetic task 1",
                        detail: "/tmp/synthetic.ts:10",
                        tone: "success",
                      },
                      { id: "item-2", label: "synthetic task 2", tone: "default" },
                      { id: "item-3", label: "synthetic task 3", tone: "default" },
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
      id: "todo-collapse-request-1",
      direction: "client_to_daemon",
      wireType: "session(pi.ui.action.request)",
      note: "The user collapses the pinned todo widget.",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.request",
          agentId: "agt_fixture_t40a1_0003",
          actionId: "collapse",
          elementId: "rpiv-todos",
          payload: {},
          requestId: "req_fixture_t40a1_todo_0001",
        },
      },
    },
    {
      id: "todo-collapse-response-1",
      direction: "daemon_to_client",
      wireType: "session(pi.ui.action.response)",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.response",
          payload: { requestId: "req_fixture_t40a1_todo_0001", ok: true, error: null },
        },
      },
    },
  ],
};
