import type { ExtensionFixtureScenario } from "../types.js";

/**
 * `pi-goal` — plan.md §11.7: "goal status, rounds, budget, blocked/waiting
 * state".
 *
 * Published over the `pi-goal:status` channel. This fixture carries the
 * shape the client actually receives *after* daemon synthesis
 * (`packages/server/src/server/agent/providers/pi/ui-bridge/state.ts`'s
 * `applyChannel` `"pi-goal:status"` case): a `status`
 * element `id:"status"`, `ns:"goal"` carrying the goal text, plus — only
 * while `payload.active`/`payload.running` is true — an indeterminate
 * `progress` element `id:"goal-progress"`, `ns:"goal"`. Rounds/budget
 * detail rides in the status `text` today (the synthesizer has no
 * dedicated rounds/budget field); this fixture keeps that detail visible
 * rather than inventing wire fields the daemon does not send. All ids/paths
 * are synthetic (plan.md §14.2).
 */
export const piGoalFixture: ExtensionFixtureScenario = {
  extension: "pi-goal",
  description:
    "The pi-goal extension's status (pi-goal:status channel, daemon-synthesized): goal text with rounds/budget detail, plus an indeterminate progress element while the goal is active.",
  planRef: "plan.md §11.3 (status, progress), §11.7 (pi-goal, pi-goal:status channel)",
  channel: "pi-goal:status",
  frames: [
    {
      id: "goal-status-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0007",
            timestamp: "2026-09-04T10:30:00.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a1_0007",
              revision: 1,
              delta: {
                op: "upsert",
                element: {
                  id: "status",
                  ns: "goal",
                  kind: "status",
                  placement: "status",
                  durable: true,
                  payload: {
                    kind: "status",
                    text: "Synthetic objective — /tmp/synthetic.ts (round 2, budget 1.2k/100k)",
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      id: "goal-progress-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      note: "Emitted alongside the status element only while the goal is active/running.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a1_0007",
            timestamp: "2026-09-04T10:30:00.100Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a1_0007",
              revision: 2,
              delta: {
                op: "upsert",
                element: {
                  id: "goal-progress",
                  ns: "goal",
                  kind: "progress",
                  placement: "pinned",
                  payload: {
                    kind: "progress",
                    label: "Synthetic objective — /tmp/synthetic.ts (round 2, budget 1.2k/100k)",
                    indeterminate: true,
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
