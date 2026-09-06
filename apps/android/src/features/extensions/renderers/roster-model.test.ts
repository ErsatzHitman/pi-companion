import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extensions } from "@picompanion/frontend-core";
import { PiUiElementSchema, type PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import type { PiUiPayloadForKind } from "../registry";
import {
  buildRosterRenderModel,
  buildRosterRowActionsModel,
  formatElapsedSeconds,
  resolveRosterActive,
} from "./roster-model";

/**
 * T34B1 — the Android `roster` kind renderer's model. Acceptance criteria
 * exercised here:
 *
 * - "Roster rows render every documented field": one suite replays the
 *   real recorded `roster.json` fixture element enriched with the exact
 *   row shape `docs/pi-extension-compatibility.md`'s `subagents` line
 *   documents (`{id, label, state, model, elapsedSec}` per row, plus
 *   payload-level `active`/`selected`) through the real client-side
 *   normalizer, then asserts every one of those fields reaches the render
 *   model; a second suite does the same for the `switchboard` line's
 *   sparser `{id, label, detail}` row shape, proving the renderer degrades
 *   cleanly rather than assuming fleet-only fields are always present.
 * - "The fleet roster stays pinned while active": `resolveRosterActive`'s
 *   transition is tested in both directions (all-done -> a row starts
 *   running, and running -> all rows settle), plus the explicit
 *   payload-level `active` extra taking precedence over the derived value.
 * - "Row actions dispatch with visible pending state":
 *   `buildRosterRowActionsModel` is exercised with an idle, a pending, and
 *   a settled `getActionState` for the same row action id across two
 *   different rows, proving one row's pending dispatch never bleeds into
 *   another row's same-named action (the composite `${element.id}#${row.id}`
 *   routing this model exists for).
 *
 * As with `renderers-model.test.ts`, only the RN-free model is exercised
 * here — `roster.tsx` cannot be rendered under this workspace's `vitest`
 * (`RolldownError` on `node_modules/react-native/index.js:1:0`); render
 * proof belongs to the T37 Maestro flows.
 */

const here = dirname(fileURLToPath(import.meta.url));
const PI_UI_BRIDGE_FIXTURES_DIR = join(
  here,
  "../../../../../../packages/protocol/src/fixtures/pi-ui-bridge",
);

type FixtureFrame = { wireType: string; message: unknown };
type PiUiBridgeFixture = { kind: string; frames: FixtureFrame[] };

function loadRosterFixture(): PiUiBridgeFixture {
  const path = join(PI_UI_BRIDGE_FIXTURES_DIR, "roster.json");
  return JSON.parse(readFileSync(path, "utf8")) as PiUiBridgeFixture;
}

/** The recorded `roster.json` fixture's one `upsert` element. */
function recordedRosterElement(): Record<string, unknown> {
  const fixture = loadRosterFixture();
  for (const frame of fixture.frames) {
    if (!frame.wireType.includes("pi_ui_delta")) continue;
    const message = frame.message as {
      message?: { payload?: { event?: { delta?: { op?: string; element?: unknown } } } };
    };
    const delta = message.message?.payload?.event?.delta;
    if (delta?.op === "upsert" && delta.element) {
      return delta.element as Record<string, unknown>;
    }
  }
  throw new Error("roster.json fixture has no recorded upsert element");
}

/**
 * The recorded roster element, enriched with the exact fields a `payload`
 * -aware helper (the pi-bridge `subagents`/`switchboard` sources this
 * repo ported, plan.md's provenance docs) would send: `payload.rows`
 * carrying whatever row shape `payloadFields` supplies, plus any
 * payload-level extras (`active`/`selected`). Run through the real wire
 * schema and the real client-side normalizer — exactly the element
 * `registry-view.tsx` hands `RosterRenderer`.
 */
function rosterElement(payloadFields: Record<string, unknown>): PiUiElement {
  const recorded = recordedRosterElement();
  const envelope = PiUiElementSchema.parse({
    ...recorded,
    payload: { kind: "roster", ...payloadFields },
  });
  return extensions.normalizePiUiElementTyped(envelope);
}

function rosterPayloadOf(element: PiUiElement): PiUiPayloadForKind<"roster"> {
  expect(element.payload).toBeDefined();
  expect(element.payload?.kind).toBe("roster");
  return element.payload as PiUiPayloadForKind<"roster">;
}

function idleState(): extensions.ExtensionActionState {
  return { status: "idle" };
}

function pendingState(target: extensions.ExtensionActionTarget): extensions.ExtensionActionState {
  return { status: "pending", target, requestId: "req_pending", dispatchedAt: 0 };
}

function settledState(
  target: extensions.ExtensionActionTarget,
  overrides: Partial<extensions.SettledExtensionAction> & {
    status: extensions.SettledExtensionAction["status"];
  },
): extensions.ExtensionActionState {
  return {
    target,
    requestId: "req_settled",
    staleRevision: false,
    source: "response",
    settledAt: 0,
    ...overrides,
  };
}

describe("buildRosterRenderModel: subagents fleet fixture (docs/pi-extension-compatibility.md 'subagents' line)", () => {
  it("renders id, label, state, model, and elapsedSec for every row, plus the payload-level selected row", () => {
    const element = rosterElement({
      rows: [
        {
          id: "job-1",
          label: "research: synthetic query on /tmp/synthetic.ts",
          state: "running",
          model: "opencode/deepseek-v4-flash",
          elapsedSec: 42,
        },
        {
          id: "job-2",
          label: "build: synthetic bundle",
          state: "done",
          model: "opencode/deepseek-v4-flash",
          elapsedSec: 130,
        },
      ],
      active: true,
      selected: "job-1",
    });
    const payload = rosterPayloadOf(element);
    const model = buildRosterRenderModel(element, payload);

    expect(model.rows).toHaveLength(2);

    const [job1, job2] = model.rows;
    expect(job1).toMatchObject({
      key: "job-1",
      label: "research: synthetic query on /tmp/synthetic.ts",
      state: "running",
      stateLabel: "Running",
      tone: "info",
      model: "opencode/deepseek-v4-flash",
      selected: true,
    });
    expect(job1!.elapsed).toEqual({
      text: "42s",
      accessibilityLabel: "research: synthetic query on /tmp/synthetic.ts elapsed: 42s",
      accessibilityLiveRegion: "polite",
    });
    expect(job1!.accessibilityLabel).toBe(
      "research: synthetic query on /tmp/synthetic.ts, Running, opencode/deepseek-v4-flash, 42s, Selected",
    );

    expect(job2).toMatchObject({
      key: "job-2",
      state: "done",
      stateLabel: "Done",
      tone: "success",
      model: "opencode/deepseek-v4-flash",
      selected: false,
    });
    expect(job2!.elapsed?.text).toBe("2m 10s");

    // The payload-level `active` extra survives passthrough onto the
    // canonical payload, so the explicit fleet-active flag is honoured.
    expect(model.active).toBe(true);
  });

  it("degrades cleanly for switchboard's sparser {id, label, detail} row shape", () => {
    const element = rosterElement({
      rows: [{ id: "key-1", label: "sk-synthetic-***1234 · healthy", detail: "cooldown 0m" }],
    });
    const payload = rosterPayloadOf(element);
    const model = buildRosterRenderModel(element, payload);

    expect(model.rows).toHaveLength(1);
    const row = model.rows[0]!;
    expect(row.state).toBeUndefined();
    expect(row.stateLabel).toBeUndefined();
    expect(row.tone).toBeUndefined();
    expect(row.model).toBeUndefined();
    expect(row.elapsed).toBeUndefined();
    expect(row.detail).toBe("cooldown 0m");
    expect(row.selected).toBe(false);
    expect(row.accessibilityLabel).toBe("sk-synthetic-***1234 · healthy, cooldown 0m");

    // No payload-level `active` extra and no in-flight row state: inactive.
    expect(model.active).toBe(false);
  });

  it("falls back to an empty-rows notice and a humanized title when the element has no title", () => {
    const element = rosterElement({ rows: [] });
    const payload = rosterPayloadOf(element);
    const model = buildRosterRenderModel({ ns: "subagents", title: undefined }, payload);

    expect(model.rows).toHaveLength(0);
    expect(model.emptyText).toBe("No rows to show.");
    expect(model.title).toBe("Subagents");
    expect(model.active).toBe(false);
  });
});

describe("resolveRosterActive: the fleet-active predicate, both transition directions", () => {
  it("is false when every row is done/idle/error and no explicit active extra is present", () => {
    expect(
      resolveRosterActive({
        rows: [
          { id: "a", label: "A", state: "done" },
          { id: "b", label: "B", state: "error" },
        ],
      }),
    ).toBe(false);
  });

  it("flips to true the moment a row starts running (inactive -> active)", () => {
    const settled = { rows: [{ id: "a", label: "A", state: "done" as const }] };
    expect(resolveRosterActive(settled)).toBe(false);

    const nowRunning = { rows: [{ id: "a", label: "A", state: "running" as const }] };
    expect(resolveRosterActive(nowRunning)).toBe(true);
  });

  it("flips back to false once every row settles (active -> inactive)", () => {
    const running = { rows: [{ id: "a", label: "A", state: "blocked" as const }] };
    expect(resolveRosterActive(running)).toBe(true);

    const settled = { rows: [{ id: "a", label: "A", state: "done" as const }] };
    expect(resolveRosterActive(settled)).toBe(false);
  });

  it("honours an explicit payload-level active extra over the derived row-state value", () => {
    // Built through the real wire schema + normalizer (like the render-model
    // suite above) rather than a hand-typed object literal, since `active`
    // is a passthrough extra the `PiUiPayloadForKind<"roster">` type itself
    // does not declare a field for.
    const doneButActive = rosterPayloadOf(
      rosterElement({ rows: [{ id: "a", label: "A", state: "done" }], active: true }),
    );
    expect(resolveRosterActive(doneButActive)).toBe(true);

    const runningButNotActive = rosterPayloadOf(
      rosterElement({ rows: [{ id: "a", label: "A", state: "running" }], active: false }),
    );
    expect(resolveRosterActive(runningButNotActive)).toBe(false);
  });
});

describe("formatElapsedSeconds", () => {
  it.each([
    [0, "0s"],
    [42, "42s"],
    [59, "59s"],
    [60, "1m 0s"],
    [130, "2m 10s"],
    [-5, "0s"],
  ])("formats %i seconds as %s", (seconds, expected) => {
    expect(formatElapsedSeconds(seconds)).toBe(expected);
  });
});

describe("buildRosterRowActionsModel: per-row pending state, isolated per row", () => {
  const rowAction = {
    id: "kill",
    label: "Kill",
    variant: "danger" as const,
    confirm: "Kill this subagent?",
  };

  it("shows one row's action as pending while a same-id action on another row stays idle", () => {
    const job1Target: extensions.ExtensionActionTarget = {
      agentId: "agt_1",
      namespace: "subagents",
      elementId: "fleet#job-1",
      actionId: "kill",
    };

    const job1Model = buildRosterRowActionsModel(
      "fleet",
      { id: "job-1", actions: [rowAction] },
      (actionId, elementId) => {
        expect(actionId).toBe("kill");
        expect(elementId).toBe("fleet#job-1");
        return pendingState(job1Target);
      },
    );
    const job2Model = buildRosterRowActionsModel(
      "fleet",
      { id: "job-2", actions: [rowAction] },
      () => idleState(),
    );

    expect(job1Model.rowElementId).toBe("fleet#job-1");
    expect(job1Model.actions[0]).toMatchObject({ id: "kill", disabled: true });
    expect(job1Model.actions[0]!.feedback?.text).toBe("Working…");

    expect(job2Model.rowElementId).toBe("fleet#job-2");
    expect(job2Model.actions[0]).toMatchObject({ id: "kill", disabled: false });
    expect(job2Model.actions[0]!.feedback).toBeUndefined();
  });

  it("shows a settled row action's outcome and re-enables it", () => {
    const target: extensions.ExtensionActionTarget = {
      agentId: "agt_1",
      namespace: "subagents",
      elementId: "fleet#job-1",
      actionId: "kill",
    };
    const model = buildRosterRowActionsModel("fleet", { id: "job-1", actions: [rowAction] }, () =>
      settledState(target, { status: "success" }),
    );

    expect(model.actions[0]).toMatchObject({ id: "kill", disabled: false });
    expect(model.actions[0]!.feedback?.text).toBe("Done");
  });

  /**
   * T34B2's coverage-gap fix: `ExtensionActionController.settle()` clears
   * `pending` unconditionally before branching on the settled status
   * (proven at the controller level in T34A5's `pi-ui-session.test.ts`),
   * but until now only a `{ status: "success" }` row action was ever
   * exercised at this model's own level — a rejected or timed-out row
   * dispatch was untested here. Both are asserted below to come back
   * re-enabled (`disabled: false`) with a named, non-empty feedback
   * string, exactly like the settled-success case above: a rejected or
   * timed-out row action must never look identical to one still pending.
   */
  it("shows a rejected row action's server error and re-enables it", () => {
    const target: extensions.ExtensionActionTarget = {
      agentId: "agt_1",
      namespace: "subagents",
      elementId: "fleet#job-1",
      actionId: "kill",
    };
    const model = buildRosterRowActionsModel("fleet", { id: "job-1", actions: [rowAction] }, () =>
      settledState(target, { status: "rejected", error: "Subagent already exited" }),
    );

    expect(model.actions[0]).toMatchObject({ id: "kill", disabled: false });
    expect(model.actions[0]!.feedback?.text).toBe("Subagent already exited");
  });

  it("shows 'Failed' for a rejected row action with no server-provided error, still re-enabled", () => {
    const target: extensions.ExtensionActionTarget = {
      agentId: "agt_1",
      namespace: "subagents",
      elementId: "fleet#job-1",
      actionId: "kill",
    };
    const model = buildRosterRowActionsModel("fleet", { id: "job-1", actions: [rowAction] }, () =>
      settledState(target, { status: "rejected" }),
    );

    expect(model.actions[0]).toMatchObject({ id: "kill", disabled: false });
    expect(model.actions[0]!.feedback?.text).toBe("Failed");
  });

  it("shows 'Timed out' for a timed-out row action and re-enables it, never stranding the row pending", () => {
    const target: extensions.ExtensionActionTarget = {
      agentId: "agt_1",
      namespace: "subagents",
      elementId: "fleet#job-1",
      actionId: "kill",
    };
    const model = buildRosterRowActionsModel("fleet", { id: "job-1", actions: [rowAction] }, () =>
      settledState(target, { status: "timeout" }),
    );

    expect(model.actions[0]).toMatchObject({ id: "kill", disabled: false });
    expect(model.actions[0]!.feedback?.text).toBe("Timed out");
  });

  it("yields no actions for a row with none (switchboard's plain key rows)", () => {
    const model = buildRosterRowActionsModel("keys", { id: "key-1", actions: undefined }, () =>
      idleState(),
    );
    expect(model.actions).toHaveLength(0);
  });
});
