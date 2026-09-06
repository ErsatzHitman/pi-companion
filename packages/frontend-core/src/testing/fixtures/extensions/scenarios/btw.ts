import type { ExtensionFixtureScenario } from "../types.js";

/**
 * `btw` — plan.md §11.7: "secondary conversation screen with markdown and
 * composer".
 *
 * Modelled on the Phase 0 re-audit (`docs/pi-extension-compatibility.md`
 * §3.3 `btw`): a `panel` placed as a `screen` (a full-screen route, not a
 * sheet or inline element) composing a `status` (busy/idle), a `markdown`
 * thread transcript, and a `form` section standing in for the composer (a
 * single multiline `text` field, since the wire's `composer` payload kind
 * replaces the *primary* draft rather than hosting a secondary
 * conversation's own input — `btw`'s own input box is therefore a form
 * field, matching the audit's `bridge.form`/`fields:[{id:"prompt",kind:"text",...}]`
 * call, not a `composer` payload). Element-level actions carry `stop`
 * (abort the sub-session), `history` (Alt+H toggle) and `thinking` (Alt+T
 * picker) alongside the form's own `submit`. All ids/paths are synthetic
 * (plan.md §14.2); nothing here was captured from a real daemon or copied
 * from `D:\paseo`.
 */
export const btwFixture: ExtensionFixtureScenario = {
  extension: "btw",
  description:
    "The btw extension's secondary conversation screen: a full-screen panel with a busy/idle status, the markdown thread, and a composer form, plus stop/history/thinking actions.",
  planRef: "plan.md §11.3 (panel/status/markdown/form), §11.5 (screen), §11.7 (btw)",
  frames: [
    {
      id: "btw-panel-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a2_0001",
            timestamp: "2026-09-05T09:00:00.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a2_0001",
              revision: 1,
              delta: {
                op: "upsert",
                element: {
                  id: "btw",
                  ns: "btw",
                  kind: "panel",
                  placement: "screen",
                  title: "btw · opencode/deepseek-v4-flash · high",
                  durable: true,
                  actions: [
                    { id: "stop", label: "Stop", variant: "danger", confirm: "Stop btw?" },
                    { id: "history", label: "History" },
                    { id: "thinking", label: "Thinking level" },
                    { id: "close", label: "Close", variant: "secondary" },
                  ],
                  payload: {
                    kind: "panel",
                    sections: [
                      {
                        id: "btw-status",
                        ns: "btw",
                        kind: "status",
                        payload: { kind: "status", text: "busy · 4s", tone: "accent" },
                      },
                      {
                        id: "btw-thread",
                        ns: "btw",
                        kind: "markdown",
                        payload: {
                          kind: "markdown",
                          text: "**you** · 10:21 — synthetic question about `/tmp/synthetic-file.ts`\n\n**btw** — synthetic answer",
                        },
                      },
                      {
                        id: "btw-composer",
                        ns: "btw",
                        kind: "form",
                        title: "Ask btw",
                        payload: {
                          kind: "form",
                          fields: [
                            {
                              kind: "text",
                              id: "prompt",
                              label: "Ask btw",
                              placeholder: "Ask about /tmp/synthetic-file.ts",
                              multiline: true,
                            },
                          ],
                          submitLabel: "Ask",
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
      id: "btw-submit-request-1",
      direction: "client_to_daemon",
      wireType: "session(pi.ui.action.request)",
      note: "The user submits a follow-up question from the btw composer form.",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.request",
          agentId: "agt_fixture_t40a2_0001",
          actionId: "submit",
          elementId: "btw",
          payload: { prompt: "What does /tmp/synthetic-file.ts export?" },
          requestId: "req_fixture_t40a2_btw_0001",
        },
      },
    },
    {
      id: "btw-submit-response-1",
      direction: "daemon_to_client",
      wireType: "session(pi.ui.action.response)",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.response",
          payload: { requestId: "req_fixture_t40a2_btw_0001", ok: true, error: null },
        },
      },
    },
    {
      id: "btw-submit-result-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_action_result)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a2_0001",
            timestamp: "2026-09-05T09:00:03.000Z",
            event: {
              type: "pi_ui_action_result",
              provider: "pi",
              result: { actionId: "submit", elementId: "btw", ok: true },
            },
          },
        },
      },
    },
  ],
};
