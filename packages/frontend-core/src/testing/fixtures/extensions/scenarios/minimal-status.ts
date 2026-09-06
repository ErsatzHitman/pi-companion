import type { ExtensionFixtureScenario } from "../types.js";

/**
 * `minimal-status` — plan.md §11.7: "native status information, not a
 * copied terminal footer".
 *
 * Modelled on the Phase 0 re-audit (`docs/pi-extension-compatibility.md`
 * §3.3 `minimal-status`): a single-line status composed from mode, working
 * directory, branch, model, and thinking level, placed in the session
 * status strip. Read-only — no actions. All ids/paths are synthetic
 * (plan.md §14.2).
 */
export const minimalStatusFixture: ExtensionFixtureScenario = {
  extension: "minimal-status",
  description:
    "The minimal-status extension's native status-strip line composing mode, directory, branch, model, and thinking level. Read-only.",
  planRef: "plan.md §11.3 (status), §11.5 (status strip), §11.7 (minimal-status)",
  frames: [
    {
      id: "mode-status-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0005",
            timestamp: "2026-09-04T10:20:00.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a1_0005",
              revision: 1,
              delta: {
                op: "upsert",
                element: {
                  id: "!mode",
                  ns: "status",
                  kind: "status",
                  placement: "status",
                  durable: true,
                  payload: {
                    kind: "status",
                    text: "Build · /tmp/synthetic-dir · main · opencode/deepseek · high",
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
