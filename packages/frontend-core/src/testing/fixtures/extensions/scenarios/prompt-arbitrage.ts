import type { ExtensionFixtureScenario } from "../types.js";

/**
 * `prompt-arbitrage` — plan.md §11.7: "status plus composer replacement
 * with undo".
 *
 * Modelled on the Phase 0 re-audit (`docs/pi-extension-compatibility.md`
 * §3.3 `prompt-arbitrage`): a transient `status` element announcing the
 * rewriting model, paired with a `composer` element that prefills the
 * rewritten draft and carries `previousText` so `undo` can restore exactly
 * what the user had typed. This is a distinct, payload-bearing companion to
 * `../recorded-session.ts`'s `extensionAction` chapter (T24's Phase 2 exit
 * fixture, recorded before canonical `payload` normalization landed) —
 * both are valid recordings of the same extension at different points in
 * this repository's history; this one is the current canonical shape. All
 * ids/paths are synthetic (plan.md §14.2).
 */
export const promptArbitrageFixture: ExtensionFixtureScenario = {
  extension: "prompt-arbitrage",
  description:
    "The prompt-arbitrage extension's transient status plus a composer prefill carrying previousText, with accept/undo actions.",
  planRef: "plan.md §11.3 (status, composer), §11.7 (prompt-arbitrage)",
  frames: [
    {
      id: "arbitrage-status-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0008",
            timestamp: "2026-09-04T10:35:00.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a1_0008",
              revision: 1,
              delta: {
                op: "upsert",
                element: {
                  id: "prompt-arbitrage",
                  ns: "prompt-arbitrage",
                  kind: "status",
                  placement: "status",
                  ttl: 5_000,
                  payload: {
                    kind: "status",
                    text: "Rewriting with opencode-go/minimax-m3",
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
      id: "arbitrage-composer-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0008",
            timestamp: "2026-09-04T10:35:00.200Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a1_0008",
              revision: 2,
              delta: {
                op: "upsert",
                element: {
                  id: "composer",
                  ns: "composer",
                  kind: "composer",
                  placement: "inline",
                  title: "Composer replacement suggested",
                  actions: [
                    { id: "accept", label: "Use suggestion", variant: "primary" },
                    { id: "undo", label: "Undo", variant: "secondary" },
                  ],
                  ttl: 60_000,
                  payload: {
                    kind: "composer",
                    text: "Synthetic rewritten prompt — /tmp/synthetic.ts",
                    mode: "prefill",
                    previousText: "synthetic original draft",
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      id: "arbitrage-undo-request-1",
      direction: "client_to_daemon",
      wireType: "session(pi.ui.action.request)",
      note: "The user rejects the rewrite and restores their original draft.",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.request",
          agentId: "agt_fixture_t40a1_0008",
          actionId: "undo",
          elementId: "composer",
          payload: {},
          requestId: "req_fixture_t40a1_prompt_arbitrage_0001",
        },
      },
    },
    {
      id: "arbitrage-undo-result-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_action_result)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0008",
            timestamp: "2026-09-04T10:35:03.000Z",
            event: {
              type: "pi_ui_action_result",
              provider: "pi",
              result: { actionId: "undo", elementId: "composer", ok: true },
            },
          },
        },
      },
    },
  ],
};
