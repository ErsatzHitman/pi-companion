import type { ExtensionFixtureScenario } from "../types.js";

/**
 * `ask-user` — plan.md §11.7: "rich form with search, descriptions,
 * multi-select, and optional comment".
 *
 * Modelled on the Phase 0 re-audit (`docs/pi-extension-compatibility.md`
 * §3.3 `ask-user`): a `panel` placed as a `sheet` composing a `form`
 * (a `select` field with `searchable: true`, `multiple: true`, and
 * per-option `description`s, plus an optional free-text `comment` field —
 * the audit's `{answer, freeform, selections} -> AskResponse` submit
 * shape), a `markdown` preview of the question, and a `log` hint line.
 * The audit's own raw fixture snippet used an informal `title`/`text`
 * shorthand for form options and log lines; this fixture instead satisfies
 * the real typed schemas directly (`PiUiFormOptionSchema`'s
 * `value`/`label`/`description`, `PiUiLogPayloadSchema`'s `lines` array)
 * rather than reproducing the audit's shorthand verbatim. All ids/paths
 * are synthetic (plan.md §14.2); nothing here was captured from a real
 * daemon or copied from `D:\paseo`.
 */
export const askUserFixture: ExtensionFixtureScenario = {
  extension: "ask-user",
  description:
    "The ask-user extension's rich question sheet: a searchable multi-select form with per-option descriptions and an optional comment field, a markdown question preview, and a keybinding hint log.",
  planRef: "plan.md §11.3 (panel/form/markdown/log), §11.5 (sheet), §11.7 (ask-user)",
  frames: [
    {
      id: "ask-user-panel-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a2_0004",
            timestamp: "2026-09-05T09:15:00.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a2_0004",
              revision: 1,
              delta: {
                op: "upsert",
                element: {
                  id: "ask-user",
                  ns: "ask-user",
                  kind: "panel",
                  placement: "sheet",
                  title: "Deploy target? (1/2)",
                  durable: true,
                  actions: [{ id: "cancel", label: "Cancel", variant: "secondary" }],
                  payload: {
                    kind: "panel",
                    sections: [
                      {
                        id: "ask-form",
                        ns: "ask-user",
                        kind: "form",
                        actions: [{ id: "submit", label: "Submit", variant: "primary" }],
                        payload: {
                          kind: "form",
                          fields: [
                            {
                              kind: "select",
                              id: "choice",
                              label: "Pick a target",
                              options: [
                                {
                                  value: "vercel",
                                  label: "Vercel — /tmp/synthetic-app",
                                  description: "synthetic hosting target",
                                },
                                {
                                  value: "fly",
                                  label: "Fly.io — /tmp/synthetic-app",
                                  description: "synthetic alternate target",
                                },
                              ],
                              multiple: true,
                              searchable: true,
                              required: true,
                            },
                            {
                              kind: "text",
                              id: "comment",
                              label: "Comment (optional)",
                              multiline: true,
                              required: false,
                            },
                          ],
                          description: "Synthetic question — /tmp/synthetic.ts",
                          submitLabel: "Submit",
                        },
                      },
                      {
                        id: "preview",
                        ns: "ask-user",
                        kind: "markdown",
                        payload: {
                          kind: "markdown",
                          text: "Synthetic question — `/tmp/synthetic.ts` (1 of 2)",
                        },
                      },
                      {
                        id: "help",
                        ns: "ask-user",
                        kind: "log",
                        payload: {
                          kind: "log",
                          lines: ["Space selects · Enter confirms · Esc cancels"],
                          mono: true,
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
      id: "ask-user-submit-request-1",
      direction: "client_to_daemon",
      wireType: "session(pi.ui.action.request)",
      note: "The user selects Vercel, adds a comment, and submits the form.",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.request",
          agentId: "agt_fixture_t40a2_0004",
          actionId: "submit",
          elementId: "ask-user",
          payload: {
            answer: "vercel",
            selections: ["vercel"],
            freeform: "prefer the synthetic region closest to /tmp/synthetic-app",
          },
          requestId: "req_fixture_t40a2_ask_user_0001",
        },
      },
    },
    {
      id: "ask-user-submit-response-1",
      direction: "daemon_to_client",
      wireType: "session(pi.ui.action.response)",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.response",
          payload: { requestId: "req_fixture_t40a2_ask_user_0001", ok: true, error: null },
        },
      },
    },
    {
      id: "ask-user-submit-result-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_action_result)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a2_0004",
            timestamp: "2026-09-05T09:15:03.000Z",
            event: {
              type: "pi_ui_action_result",
              provider: "pi",
              result: { actionId: "submit", elementId: "ask-user", ok: true },
            },
          },
        },
      },
    },
  ],
};
