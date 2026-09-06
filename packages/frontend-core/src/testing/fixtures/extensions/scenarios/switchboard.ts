import type { ExtensionFixtureScenario } from "../types.js";

/**
 * `switchboard` — plan.md §11.7: "key-health roster, cooldown state, and
 * management form".
 *
 * Modelled on the Phase 0 re-audit (`docs/pi-extension-compatibility.md`
 * §3.3 `switchboard`): a `panel` placed as a `sheet` composing a `roster`
 * of keys (health/cooldown in each row's `state`/`detail`, with per-row
 * `use`/`remove` actions — the audit's `add`, `remove`, `reset`, `use`,
 * and cycle actions), a `log` for the active-key status line, and a `form`
 * for adding a new key. All ids/paths are synthetic (plan.md §14.2);
 * nothing here was captured from a real daemon or copied from `D:\paseo`.
 */
export const switchboardFixture: ExtensionFixtureScenario = {
  extension: "switchboard",
  description:
    "The switchboard extension's panel: a key-health roster with cooldown detail and per-row use/remove actions, a status log, and an add-key management form.",
  planRef: "plan.md §11.3 (panel/roster/log/form), §11.5 (sheet), §11.7 (switchboard)",
  frames: [
    {
      id: "switchboard-panel-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a2_0002",
            timestamp: "2026-09-05T09:05:00.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a2_0002",
              revision: 1,
              delta: {
                op: "upsert",
                element: {
                  id: "switchboard",
                  ns: "switchboard",
                  kind: "panel",
                  placement: "sheet",
                  title: "switchboard · opencode-go · ON · 3 keys",
                  durable: true,
                  actions: [{ id: "reset", label: "Reset", variant: "secondary" }],
                  payload: {
                    kind: "panel",
                    sections: [
                      {
                        id: "keys",
                        ns: "switchboard",
                        kind: "roster",
                        title: "Keys",
                        payload: {
                          kind: "roster",
                          rows: [
                            {
                              id: "key-1",
                              label: "sk-synthetic-***1234",
                              state: "running",
                              detail: "healthy · cooldown 0m",
                              actions: [
                                {
                                  id: "remove",
                                  label: "Remove",
                                  variant: "danger",
                                  confirm: "Remove this key?",
                                },
                              ],
                            },
                            {
                              id: "key-2",
                              label: "sk-synthetic-***5678",
                              state: "blocked",
                              detail: "cooling down · 4m remaining",
                              actions: [
                                { id: "use", label: "Use" },
                                { id: "remove", label: "Remove", variant: "danger" },
                              ],
                            },
                            {
                              id: "key-3",
                              label: "sk-synthetic-***9012",
                              state: "idle",
                              detail: "healthy · cooldown 0m",
                              actions: [
                                { id: "use", label: "Use" },
                                { id: "remove", label: "Remove", variant: "danger" },
                              ],
                            },
                          ],
                        },
                      },
                      {
                        id: "status",
                        ns: "switchboard",
                        kind: "log",
                        payload: {
                          kind: "log",
                          lines: ["active sk-synthetic-***1234 · synthetic check ok"],
                          tail: 30,
                        },
                      },
                      {
                        id: "add-key",
                        ns: "switchboard",
                        kind: "form",
                        title: "Add key",
                        payload: {
                          kind: "form",
                          fields: [
                            {
                              kind: "text",
                              id: "key",
                              label: "API key",
                              placeholder: "sk-...",
                              required: true,
                            },
                          ],
                          submitLabel: "Add",
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
      id: "switchboard-use-request-1",
      direction: "client_to_daemon",
      wireType: "session(pi.ui.action.request)",
      note: "The user switches the active key to key-2's row.",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.request",
          agentId: "agt_fixture_t40a2_0002",
          actionId: "use",
          elementId: "switchboard",
          payload: { rowId: "key-2" },
          requestId: "req_fixture_t40a2_switchboard_0001",
        },
      },
    },
    {
      id: "switchboard-use-response-1",
      direction: "daemon_to_client",
      wireType: "session(pi.ui.action.response)",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.response",
          payload: { requestId: "req_fixture_t40a2_switchboard_0001", ok: true, error: null },
        },
      },
    },
    {
      id: "switchboard-use-result-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_action_result)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a2_0002",
            timestamp: "2026-09-05T09:05:02.000Z",
            event: {
              type: "pi_ui_action_result",
              provider: "pi",
              result: { actionId: "use", elementId: "switchboard", ok: true },
            },
          },
        },
      },
    },
    {
      id: "switchboard-panel-upsert-2",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      note: "key-2 becomes the active key after the switch settles; key-1 goes to cooldown.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a2_0002",
            timestamp: "2026-09-05T09:05:03.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a2_0002",
              revision: 2,
              delta: {
                op: "upsert",
                element: {
                  id: "switchboard",
                  ns: "switchboard",
                  kind: "panel",
                  placement: "sheet",
                  title: "switchboard · opencode-go · ON · 3 keys",
                  durable: true,
                  actions: [{ id: "reset", label: "Reset", variant: "secondary" }],
                  payload: {
                    kind: "panel",
                    sections: [
                      {
                        id: "keys",
                        ns: "switchboard",
                        kind: "roster",
                        title: "Keys",
                        payload: {
                          kind: "roster",
                          rows: [
                            {
                              id: "key-1",
                              label: "sk-synthetic-***1234",
                              state: "blocked",
                              detail: "cooling down · 4m remaining",
                              actions: [
                                { id: "use", label: "Use" },
                                { id: "remove", label: "Remove", variant: "danger" },
                              ],
                            },
                            {
                              id: "key-2",
                              label: "sk-synthetic-***5678",
                              state: "running",
                              detail: "healthy · cooldown 0m",
                              actions: [
                                {
                                  id: "remove",
                                  label: "Remove",
                                  variant: "danger",
                                  confirm: "Remove this key?",
                                },
                              ],
                            },
                            {
                              id: "key-3",
                              label: "sk-synthetic-***9012",
                              state: "idle",
                              detail: "healthy · cooldown 0m",
                              actions: [
                                { id: "use", label: "Use" },
                                { id: "remove", label: "Remove", variant: "danger" },
                              ],
                            },
                          ],
                        },
                      },
                      {
                        id: "status",
                        ns: "switchboard",
                        kind: "log",
                        payload: {
                          kind: "log",
                          lines: [
                            "active sk-synthetic-***1234 · synthetic check ok",
                            "active sk-synthetic-***5678 · synthetic check ok",
                          ],
                          tail: 30,
                        },
                      },
                      {
                        id: "add-key",
                        ns: "switchboard",
                        kind: "form",
                        title: "Add key",
                        payload: {
                          kind: "form",
                          fields: [
                            {
                              kind: "text",
                              id: "key",
                              label: "API key",
                              placeholder: "sk-...",
                              required: true,
                            },
                          ],
                          submitLabel: "Add",
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
  ],
};
