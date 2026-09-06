import type { ExtensionFixtureScenario } from "../types.js";

/**
 * `plan-mode` — plan.md §11.7: "mode status with toggle action".
 *
 * **Disclosed gap (not this task's to close):** the Phase 0 re-audit
 * (`docs/pi-extension-compatibility.md` §3.3 `plan-mode`, correction dated
 * 2026-09-04) found the *currently installed* `plan-mode.ts` emits no bridge
 * element of its own — `grep -n "bridge|Bridge|PIUI|emitPiUi|panelBridge"`
 * over it returns zero hits. Its entire UI surface today is
 * `ctx.ui.setStatus(MODE_STATUS_KEY, ...)`, a plain footer string that
 * `minimal-status.ts` composes into its own `!mode` status element (see
 * `./minimal-status.ts`). So the §11.7 requirement is met today through
 * composition, not through a `plan-mode`-owned element.
 *
 * This fixture still fixtures the *required* shape plan.md §11.7 specifies
 * — a `plan-mode`-namespaced `status` element carrying the toggle action —
 * because T40A1's brief is "the first half of the §11.7 UI-bearing
 * extensions" and `plan-mode` is one of that table's rows. A renderer task
 * (T40A3+) or a later extension change may make this fixture's `ns` real;
 * until then, treat it as the target shape, not as recorded daemon
 * behavior, and prefer composing through `minimal-status` for anything that
 * must work against the extensions actually installed today. All ids/paths
 * are synthetic (plan.md §14.2).
 */
export const planModeFixture: ExtensionFixtureScenario = {
  extension: "plan-mode",
  description:
    "The plan-mode extension's required mode-status shape (read-only status + toggle action) per plan.md §11.7; composed today through minimal-status rather than emitted directly (see the doc comment above).",
  planRef: "plan.md §11.3 (status), §11.5 (status strip), §11.7 (plan-mode)",
  frames: [
    {
      id: "plan-mode-status-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0006",
            timestamp: "2026-09-04T10:25:00.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a1_0006",
              revision: 1,
              delta: {
                op: "upsert",
                element: {
                  id: "mode",
                  ns: "plan-mode",
                  kind: "status",
                  placement: "status",
                  durable: true,
                  actions: [{ id: "toggle", label: "Toggle plan mode", variant: "secondary" }],
                  payload: {
                    kind: "status",
                    text: "Plan · read-only · synthetic reasoning",
                    tone: "accent",
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      id: "plan-mode-toggle-request-1",
      direction: "client_to_daemon",
      wireType: "session(pi.ui.action.request)",
      note: "The user toggles out of plan mode (Alt+P / `/plan`).",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.request",
          agentId: "agt_fixture_t40a1_0006",
          actionId: "toggle",
          elementId: "mode",
          payload: {},
          requestId: "req_fixture_t40a1_plan_mode_0001",
        },
      },
    },
    {
      id: "plan-mode-toggle-response-1",
      direction: "daemon_to_client",
      wireType: "session(pi.ui.action.response)",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.response",
          payload: { requestId: "req_fixture_t40a1_plan_mode_0001", ok: true, error: null },
        },
      },
    },
  ],
};
