import type { ExtensionFixtureScenario } from "../types.js";

/**
 * `workflows` — plan.md §11.7: "approval form, progress, roster, and logs".
 *
 * Two of this table cell's four required pieces travel differently:
 *
 * 1. **Approval form, roster, and logs** come from the workflow's own
 *    `panel` (the Phase 0 re-audit's `tryWorkflowsBridgePanel(ctx, model)`,
 *    `docs/pi-extension-compatibility.md` §3.3 `workflows`: "placement
 *    `panel` inline/sheet; `roster` inline; `log` tail-30"), a direct
 *    `pi_ui_delta` upsert exactly like `loop`'s or `advisor`'s panel. The
 *    audit records approval as going through `ctx.ui.select` in the TUI
 *    with a bridge/RPC fallback; this fixture models that fallback as an
 *    ordinary `form` section with an `approve`/`reject` element action,
 *    the same shape every other bridge-routed approval in this directory
 *    uses (e.g. `loop`'s `stop`, `subagents`' `cancel`) — the required-UI
 *    cell names "approval form", not a specific field layout.
 * 2. **Progress** is published over the `workflow:progress` channel and
 *    only reaches the client as the daemon's *synthesized* shape
 *    (`packages/server/src/server/agent/providers/pi/ui-bridge/state.ts`'s
 *    `applyChannel` `"workflow:progress"` case), verified
 *    directly against that production code rather than a doc claim, the
 *    same treatment `subagents`/`pi-goal` got in T40A1.
 *
 * **Gap T40A2 disclosed here, closed by T40A3:** `applyChannel` used to
 * spread the raw channel payload (`status`, `phase`, `step`, `total`, ...)
 * directly onto the synthesized *element* without lifting any of it into
 * the typed `progress` payload — `V1_PAYLOAD_FIELDS.progress`
 * (`payload-compat.ts`) only lifts `label`/`detail`/`value`/`max`/
 * `indeterminate`, and none of those are among the fields `workflow:progress`
 * actually sends. T40A3 widened scope into `packages/server` (uncontested
 * this wave) and taught `applyChannel`'s `"workflow:progress"` case to alias
 * `step`/`total` to `value`/`max` before normalization runs, so the
 * synthesized element's typed `progress` payload now carries real numeric
 * progress (proven by a mutation in `state.test.ts`: reverting the alias
 * makes the new assertion fail). `step`/`total`/`phase`/`status` still also
 * land as untyped passthrough top-level fields on the element (harmless,
 * unchanged) — only the typed `payload` gained `value`/`max`. This fixture's
 * `workflow-progress-channel-upsert-1` element reflects the now-fixed
 * production shape.
 *
 * All ids/paths are synthetic (plan.md §14.2); nothing here was captured
 * from a real daemon or copied from `D:\paseo`.
 */
export const workflowsFixture: ExtensionFixtureScenario = {
  extension: "workflows",
  description:
    "The workflows extension's step panel (approval form, roster, log) plus the workflow:progress channel's daemon-synthesized status-placement and pinned progress elements.",
  planRef:
    "plan.md §11.3 (panel/roster/log/form/progress/widget), §11.5 (sheet, pinned, status), §11.7 (workflows, workflow:progress channel)",
  channel: "workflow:progress",
  frames: [
    {
      id: "workflows-panel-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a2_0003",
            timestamp: "2026-09-05T09:10:00.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a2_0003",
              revision: 1,
              delta: {
                op: "upsert",
                element: {
                  id: "workflows-panel",
                  ns: "workflows",
                  kind: "panel",
                  placement: "sheet",
                  title: "Workflow · issue-graph · implement (step 2 of 5)",
                  durable: true,
                  actions: [
                    {
                      id: "cancel",
                      label: "Cancel",
                      variant: "danger",
                      confirm: "Cancel the running workflow?",
                    },
                  ],
                  payload: {
                    kind: "panel",
                    sections: [
                      {
                        id: "approval",
                        ns: "workflows",
                        kind: "form",
                        title: "Approve next step",
                        actions: [
                          { id: "approve", label: "Approve", variant: "primary" },
                          { id: "reject", label: "Reject", variant: "danger" },
                        ],
                        payload: {
                          kind: "form",
                          fields: [
                            {
                              kind: "toggle",
                              id: "auto-continue",
                              label: "Auto-continue remaining steps",
                              value: false,
                            },
                          ],
                          description: "Approve step 2 of 5: implement /tmp/synthetic.ts",
                          submitLabel: "Approve",
                        },
                      },
                      {
                        id: "steps",
                        ns: "workflows",
                        kind: "roster",
                        title: "Steps",
                        payload: {
                          kind: "roster",
                          rows: [
                            { id: "step-1", label: "plan", state: "done" },
                            {
                              id: "step-2",
                              label: "implement",
                              state: "running",
                              detail: "synthetic-model",
                            },
                            { id: "step-3", label: "test", state: "idle" },
                            { id: "step-4", label: "review", state: "idle" },
                            { id: "step-5", label: "merge", state: "idle" },
                          ],
                        },
                      },
                      {
                        id: "events",
                        ns: "workflows",
                        kind: "log",
                        payload: {
                          kind: "log",
                          lines: ["implement: applying synthetic patch to /tmp/synthetic.ts"],
                          tail: 30,
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
      id: "workflows-approve-request-1",
      direction: "client_to_daemon",
      wireType: "session(pi.ui.action.request)",
      note: "The user approves the pending workflow step.",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.request",
          agentId: "agt_fixture_t40a2_0003",
          actionId: "approve",
          elementId: "workflows-panel",
          payload: { autoContinue: false },
          requestId: "req_fixture_t40a2_workflows_0001",
        },
      },
    },
    {
      id: "workflows-approve-response-1",
      direction: "daemon_to_client",
      wireType: "session(pi.ui.action.response)",
      message: {
        type: "session",
        message: {
          type: "pi.ui.action.response",
          payload: { requestId: "req_fixture_t40a2_workflows_0001", ok: true, error: null },
        },
      },
    },
    {
      id: "workflows-approve-result-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_action_result)",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a2_0003",
            timestamp: "2026-09-05T09:10:02.000Z",
            event: {
              type: "pi_ui_action_result",
              provider: "pi",
              result: { actionId: "approve", elementId: "workflows-panel", ok: true },
            },
          },
        },
      },
    },
    {
      id: "workflow-progress-channel-upsert-1",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      note: "The workflow:progress channel's daemon-synthesized `progress` element (state.ts's `applyChannel` `\"workflow:progress\"` case). See this file's doc comment: T40A3 fixed the value/max gap T40A2 disclosed.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a2_0003",
            timestamp: "2026-09-05T09:10:05.000Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a2_0003",
              revision: 2,
              delta: {
                op: "upsert",
                element: {
                  id: "progress",
                  ns: "workflow",
                  kind: "progress",
                  placement: "status",
                  title: "workflow · implement",
                  status: "running",
                  phase: "implement",
                  step: 2,
                  total: 5,
                  active: true,
                  // P6-W3 merge gate: `applyChannel` spreads its aliased
                  // `value`/`max` onto the ELEMENT as well as lifting them
                  // into `payload` (verified by running the real
                  // `PiUiStateStore.applyChannel` against this exact input
                  // and comparing element-for-element). Recorded here so
                  // this fixture stays what its own doc comment claims —
                  // exactly what production emits, not a tidied subset.
                  value: 2,
                  max: 5,
                  payload: { kind: "progress", value: 2, max: 5 },
                },
              },
            },
          },
        },
      },
    },
    {
      id: "workflow-progress-channel-upsert-2",
      direction: "daemon_to_client",
      wireType: "session(agent_stream:pi_ui_delta)",
      note: "applyChannel also synthesizes a pinned progress element carrying step/total as value/max while payload.active === true (state.ts's workflow:progress case, T113). Before T113 this was a plain-text widget that dropped step/total entirely — never reachable by a progress renderer at all.",
      message: {
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "agt_fixture_t40a2_0003",
            timestamp: "2026-09-05T09:10:05.100Z",
            event: {
              type: "pi_ui_delta",
              provider: "pi",
              agentId: "agt_fixture_t40a2_0003",
              revision: 3,
              delta: {
                op: "upsert",
                element: {
                  id: "workflow-widget",
                  ns: "workflow",
                  kind: "progress",
                  placement: "pinned",
                  title: "workflow · implement",
                  payload: { kind: "progress", label: "workflow · implement", value: 2, max: 5 },
                },
              },
            },
          },
        },
      },
    },
  ],
};
