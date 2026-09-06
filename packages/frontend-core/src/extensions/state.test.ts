import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentStreamEvent, AgentTimelineItem } from "@picompanion/protocol/agent-types";
import type { PiUiElement, PiUiState } from "@picompanion/protocol/pi-ui-bridge/schema";
import { piUiElementKey } from "./identity.js";
import {
  PiUiElementStore,
  ingestPiUiReplayBatch,
  piUiSnapshotState,
  type PiUiResyncReason,
} from "./state.js";

/**
 * Pi UI element state and revision handling (T21B). Acceptance criteria
 * exercised here:
 *
 * - "Canonical payload parsed for all ten kinds; v1 projection still
 *   accepted" — covered per-kind in `normalize.test.ts`; this file proves
 *   the store attaches normalization on every ingested element.
 * - "Stale and jumped revisions handled per plan §4.2" — `revision.test.ts`
 *   covers the pure rule; this file proves the store wires that rule to
 *   real `pi_ui_delta`/`pi_ui_state` events without corrupting element
 *   state on a discarded/resync-requested delta.
 * - "Ephemeral state never persisted as history" — this store has no
 *   storage/offline write path at all (it only ever holds an in-memory
 *   `Map`), and `resetAgent`/`removeAgent` prove nothing survives a reset
 *   without a fresh authoritative full state.
 */

const here = dirname(fileURLToPath(import.meta.url));
const DAEMON_WS_FIXTURES_DIR = join(here, "../../../protocol/src/fixtures/daemon-ws");
const PI_UI_BRIDGE_FIXTURES_DIR = join(here, "../../../protocol/src/fixtures/pi-ui-bridge");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

type FixtureFrame = { wireType: string; message: unknown };
type PiUiBridgeFixture = { frames: FixtureFrame[] };

/** Extracts every `pi_ui_delta` `AgentStreamEvent` from a recorded fixture, in order. */
function piUiDeltaEventsOf(
  fixture: PiUiBridgeFixture,
): Extract<AgentStreamEvent, { type: "pi_ui_delta" }>[] {
  const events: Extract<AgentStreamEvent, { type: "pi_ui_delta" }>[] = [];
  for (const frame of fixture.frames) {
    if (!frame.wireType.includes("agent_stream:pi_ui_delta")) continue;
    const message = frame.message as {
      message?: { payload?: { event?: AgentStreamEvent } };
    };
    const event = message.message?.payload?.event;
    if (event?.type === "pi_ui_delta") events.push(event);
  }
  return events;
}

function loadDaemonWsFixture(scenario: string): { frames: FixtureFrame[] } {
  return readJson(join(DAEMON_WS_FIXTURES_DIR, `${scenario}.json`)) as { frames: FixtureFrame[] };
}

function loadPiUiBridgeFixture(kind: string): PiUiBridgeFixture {
  return readJson(join(PI_UI_BRIDGE_FIXTURES_DIR, `${kind}.json`)) as PiUiBridgeFixture;
}

describe("PiUiElementStore — element identity keyed by ns:id", () => {
  it("keeps two namespaces' elements with the same bare id distinct", () => {
    const store = new PiUiElementStore();
    const a: PiUiElement = { id: "main", ns: "loop", kind: "status", placement: "status" };
    const b: PiUiElement = { id: "main", ns: "advisor", kind: "status", placement: "status" };

    store.ingestFullState({
      agentId: "agt_1",
      revision: 1,
      elements: [a, b],
      updatedAt: "2026-08-31T00:00:00.000Z",
    });

    expect(store.getElements("agt_1")).toHaveLength(2);
    expect(store.getElement("agt_1", "loop", "main")).toMatchObject({ ns: "loop", id: "main" });
    expect(store.getElement("agt_1", "advisor", "main")).toMatchObject({
      ns: "advisor",
      id: "main",
    });
  });

  it("upsert-in-place preserves original element order", () => {
    const store = new PiUiElementStore();
    store.ingestFullState({
      agentId: "agt_1",
      revision: 1,
      elements: [
        { id: "a", ns: "n", kind: "status", placement: "status", title: "A" },
        { id: "b", ns: "n", kind: "status", placement: "status", title: "B" },
      ],
      updatedAt: "2026-08-31T00:00:00.000Z",
    });

    store.ingestDelta("agt_1", 2, {
      op: "upsert",
      element: { id: "a", ns: "n", kind: "status", placement: "status", title: "A2" },
    });

    expect(store.getElements("agt_1").map((el) => el.id)).toEqual(["a", "b"]);
    expect(store.getElement("agt_1", "n", "a")?.title).toBe("A2");
  });
});

describe("PiUiElementStore — delta revision handling (plan.md §4.2)", () => {
  it("applies a sequence of upserts from a recorded fixture (progress.json)", () => {
    const store = new PiUiElementStore();
    const events = piUiDeltaEventsOf(loadPiUiBridgeFixture("progress"));
    expect(events.length).toBeGreaterThanOrEqual(2);

    // The recorded fixture's first delta is revision 4 (it was captured
    // mid-session, after other elements were upserted). Prime the store to
    // revision 3 first, exactly as a prior `pi_ui_state`/earlier deltas
    // would have, so this fixture's deltas are consecutive from the store's
    // point of view.
    store.ingestFullState({
      agentId: events[0]!.agentId,
      revision: events[0]!.revision - 1,
      elements: [],
      updatedAt: "2026-08-31T10:07:59.000Z",
    });

    const outcomes = events.map((event) =>
      store.ingestDelta(event.agentId, event.revision, event.delta),
    );
    expect(outcomes.every((o) => o.action === "applied")).toBe(true);

    const agentId = events[0]!.agentId;
    expect(store.getRevision(agentId)).toBe(events.at(-1)!.revision);
    const element = store.getElement(agentId, "workflows", "deploy-workflow");
    expect(element?.title).toBe("Deploy workflow — step 3 of 5");
  });

  it("discards a stale delta and leaves state untouched", () => {
    const store = new PiUiElementStore();
    store.ingestDelta("agt_1", 1, {
      op: "upsert",
      element: { id: "a", ns: "n", kind: "status", placement: "status", title: "v1" },
    });

    const outcome = store.ingestDelta("agt_1", 1, {
      op: "upsert",
      element: { id: "a", ns: "n", kind: "status", placement: "status", title: "STALE" },
    });

    expect(outcome).toEqual({ action: "discarded", reason: "stale" });
    expect(store.getRevision("agt_1")).toBe(1);
    expect(store.getElement("agt_1", "n", "a")?.title).toBe("v1");
  });

  it("requests a resync on a jumped delta and leaves state untouched", () => {
    const store = new PiUiElementStore();
    const resyncs: Array<[string, PiUiResyncReason]> = [];
    store.onResyncNeeded((agentId, reason) => resyncs.push([agentId, reason]));

    store.ingestDelta("agt_1", 1, {
      op: "upsert",
      element: { id: "a", ns: "n", kind: "status", placement: "status", title: "v1" },
    });

    const outcome = store.ingestDelta("agt_1", 5, {
      op: "upsert",
      element: { id: "a", ns: "n", kind: "status", placement: "status", title: "SHOULD_NOT_APPLY" },
    });

    expect(outcome).toEqual({ action: "resync-requested", reason: "gap" });
    expect(resyncs).toEqual([["agt_1", "gap"]]);
    expect(store.getRevision("agt_1")).toBe(1);
    expect(store.getElement("agt_1", "n", "a")?.title).toBe("v1");
  });

  it("applies remove by composite ns:id", () => {
    const store = new PiUiElementStore();
    store.ingestFullState({
      agentId: "agt_1",
      revision: 1,
      elements: [{ id: "a", ns: "n", kind: "status", placement: "status" }],
      updatedAt: "2026-08-31T00:00:00.000Z",
    });

    store.ingestDelta("agt_1", 2, { op: "remove", id: "a", ns: "n" });
    expect(store.getElement("agt_1", "n", "a")).toBeUndefined();
    expect(store.getElements("agt_1")).toHaveLength(0);
  });

  it("resolves a legacy bare-id remove only when the id is unambiguous", () => {
    const store = new PiUiElementStore();
    store.ingestFullState({
      agentId: "agt_1",
      revision: 1,
      elements: [{ id: "main", ns: "n", kind: "status", placement: "status" }],
      updatedAt: "2026-08-31T00:00:00.000Z",
    });
    store.ingestDelta("agt_1", 2, { op: "remove", id: "main" });
    expect(store.getElements("agt_1")).toHaveLength(0);
  });

  it("ignores an ambiguous legacy bare-id remove rather than guessing", () => {
    const store = new PiUiElementStore();
    store.ingestFullState({
      agentId: "agt_1",
      revision: 1,
      elements: [
        { id: "main", ns: "loop", kind: "status", placement: "status" },
        { id: "main", ns: "advisor", kind: "status", placement: "status" },
      ],
      updatedAt: "2026-08-31T00:00:00.000Z",
    });
    store.ingestDelta("agt_1", 2, { op: "remove", id: "main" });
    expect(store.getElements("agt_1")).toHaveLength(2);
  });

  it("applies reset by clearing and replacing every element", () => {
    const store = new PiUiElementStore();
    store.ingestFullState({
      agentId: "agt_1",
      revision: 1,
      elements: [{ id: "a", ns: "n", kind: "status", placement: "status" }],
      updatedAt: "2026-08-31T00:00:00.000Z",
    });

    store.ingestDelta("agt_1", 2, {
      op: "reset",
      revision: 2,
      elements: [{ id: "b", ns: "n", kind: "status", placement: "status" }],
    });

    expect(store.getElement("agt_1", "n", "a")).toBeUndefined();
    expect(store.getElement("agt_1", "n", "b")).toBeDefined();
    expect(store.getRevision("agt_1")).toBe(2);
  });
});

describe("PiUiElementStore — full-state revision handling (plan.md §4.2)", () => {
  it("accepts a full state at or ahead of current and adopts its revision", () => {
    const store = new PiUiElementStore();
    store.ingestDelta("agt_1", 1, {
      op: "upsert",
      element: { id: "a", ns: "n", kind: "status", placement: "status" },
    });

    const state: PiUiState = {
      agentId: "agt_1",
      revision: 9,
      elements: [{ id: "b", ns: "n", kind: "status", placement: "status" }],
      updatedAt: "2026-08-31T00:00:00.000Z",
    };
    const outcome = store.ingestFullState(state);
    expect(outcome).toEqual({ action: "applied", revision: 9 });
    expect(store.getRevision("agt_1")).toBe(9);
    expect(store.getElement("agt_1", "n", "a")).toBeUndefined();
    expect(store.getElement("agt_1", "n", "b")).toBeDefined();
  });

  it("discards a stale full state", () => {
    const store = new PiUiElementStore();
    store.ingestFullState({
      agentId: "agt_1",
      revision: 9,
      elements: [{ id: "a", ns: "n", kind: "status", placement: "status" }],
      updatedAt: "2026-08-31T00:00:00.000Z",
    });

    const outcome = store.ingestFullState({
      agentId: "agt_1",
      revision: 3,
      elements: [{ id: "b", ns: "n", kind: "status", placement: "status" }],
      updatedAt: "2026-08-31T00:00:01.000Z",
    });

    expect(outcome).toEqual({ action: "discarded", reason: "stale" });
    expect(store.getRevision("agt_1")).toBe(9);
    expect(store.getElement("agt_1", "n", "a")).toBeDefined();
  });
});

describe("PiUiElementStore — ingestEvent dispatch (plan.md §12.2 frontend-core event parser)", () => {
  it("routes pi_ui_state and pi_ui_delta, and ignores everything else (e.g. pi_ui_action_result — T21C's scope)", () => {
    const store = new PiUiElementStore();

    const fullState: AgentStreamEvent = {
      type: "pi_ui_state",
      provider: "pi",
      state: {
        agentId: "agt_1",
        revision: 1,
        elements: [{ id: "a", ns: "n", kind: "status", placement: "status" }],
        updatedAt: "2026-08-31T00:00:00.000Z",
      },
    };
    expect(store.ingestEvent(fullState)).toEqual({ action: "applied", revision: 1 });

    const delta: AgentStreamEvent = {
      type: "pi_ui_delta",
      provider: "pi",
      agentId: "agt_1",
      revision: 2,
      delta: { op: "remove", id: "a", ns: "n" },
    };
    expect(store.ingestEvent(delta)).toEqual({ action: "applied", revision: 2 });

    const actionResult: AgentStreamEvent = {
      type: "pi_ui_action_result",
      provider: "pi",
      result: { actionId: "stop", elementId: "run-4", ok: true },
    };
    expect(store.ingestEvent(actionResult)).toBeNull();

    const unrelated: AgentStreamEvent = { type: "turn_started", provider: "pi" };
    expect(store.ingestEvent(unrelated)).toBeNull();
  });

  it("replays a batch of events in order via ingestPiUiReplayBatch", () => {
    const store = new PiUiElementStore();
    const events = piUiDeltaEventsOf(loadPiUiBridgeFixture("progress"));
    store.ingestFullState({
      agentId: events[0]!.agentId,
      revision: events[0]!.revision - 1,
      elements: [],
      updatedAt: "2026-08-31T10:07:59.000Z",
    });
    const outcomes = ingestPiUiReplayBatch(store, events);
    expect(outcomes.every((o) => o.action === "applied")).toBe(true);
    expect(store.getRevision(events[0]!.agentId)).toBe(events.at(-1)!.revision);
  });
});

describe("PiUiElementStore — reconnect replay (plan.md §4.2, §11.5)", () => {
  it("replays the recorded reconnect-with-gap fixture's pi_ui_snapshot as a full state", () => {
    // Simulate the client's pre-restart state, at a much lower revision than
    // what the daemon will send back after the restart.
    const store = new PiUiElementStore();
    store.ingestFullState({
      agentId: "agt_fixture_0001",
      revision: 2,
      elements: [{ id: "stale", ns: "old-ns", kind: "status", placement: "status" }],
      updatedAt: "2026-08-31T09:00:00.000Z",
    });

    const fixture = loadDaemonWsFixture("reconnect-with-gap");
    const frame = fixture.frames.find((f) => f.wireType.includes("fetch_agent_timeline_response"));
    expect(frame).toBeDefined();
    const message = frame!.message as {
      message: { payload: { entries: Array<{ item: AgentTimelineItem }> } };
    };
    const snapshotItem = message.message.payload.entries
      .map((entry) => entry.item)
      .find((item) => item.type === "pi_ui_snapshot");
    expect(snapshotItem).toBeDefined();

    const state = piUiSnapshotState(snapshotItem!);
    expect(state).not.toBeNull();
    expect(state!.revision).toBe(9);

    const outcome = store.ingestFullState(state!);
    expect(outcome).toEqual({ action: "applied", revision: 9 });
    expect(store.getRevision("agt_fixture_0001")).toBe(9);
    // The pre-restart element is gone: a full state always replaces every
    // element for the agent.
    expect(store.getElement("agt_fixture_0001", "old-ns", "stale")).toBeUndefined();
    expect(store.getElement("agt_fixture_0001", "subagents", "fleet")).toMatchObject({
      title: "Subagent fleet",
    });
    expect(store.getElement("agt_fixture_0001", "todo", "tasks")).toMatchObject({
      title: "3 of 7 tasks complete",
    });
  });

  it("piUiSnapshotState returns null for a non-snapshot timeline item", () => {
    const item: AgentTimelineItem = { type: "user_message", text: "hi" };
    expect(piUiSnapshotState(item)).toBeNull();
  });
});

describe("PiUiElementStore — reset and removal are the only ways elements disappear (ephemeral, never persisted)", () => {
  it("resetAgent clears elements and rewinds revision to 0", () => {
    const store = new PiUiElementStore();
    store.ingestFullState({
      agentId: "agt_1",
      revision: 4,
      elements: [{ id: "a", ns: "n", kind: "status", placement: "status" }],
      updatedAt: "2026-08-31T00:00:00.000Z",
    });

    store.resetAgent("agt_1");

    expect(store.getRevision("agt_1")).toBe(0);
    expect(store.getElements("agt_1")).toHaveLength(0);

    // Nothing resurrects the pre-reset element on its own: only a fresh
    // authoritative full state (or the delta-at-revision-1 that would follow
    // it) can populate the store again.
    const outcome = store.ingestFullState({
      agentId: "agt_1",
      revision: 0,
      elements: [],
      updatedAt: "2026-08-31T00:00:01.000Z",
    });
    expect(outcome).toEqual({ action: "applied", revision: 0 });
  });

  it("removeAgent drops the agent entirely", () => {
    const store = new PiUiElementStore();
    store.ingestFullState({
      agentId: "agt_1",
      revision: 1,
      elements: [{ id: "a", ns: "n", kind: "status", placement: "status" }],
      updatedAt: "2026-08-31T00:00:00.000Z",
    });

    store.removeAgent("agt_1");

    expect(store.getAgentIds()).toEqual([]);
    expect(store.getRevision("agt_1")).toBe(0);
    expect(store.getElements("agt_1")).toEqual([]);
  });

  it("notifies subscribers on every element/revision change", () => {
    const store = new PiUiElementStore();
    const changed: string[] = [];
    store.subscribe((agentId) => changed.push(agentId));

    store.ingestFullState({
      agentId: "agt_1",
      revision: 1,
      elements: [],
      updatedAt: "2026-08-31T00:00:00.000Z",
    });
    store.ingestDelta("agt_1", 2, {
      op: "upsert",
      element: { id: "a", ns: "n", kind: "status", placement: "status" },
    });
    store.resetAgent("agt_1");
    store.removeAgent("agt_1");

    expect(changed).toEqual(["agt_1", "agt_1", "agt_1", "agt_1"]);
  });
});

describe("PiUiElementStore — canonical payload attached on every ingest (plan.md §4.2)", () => {
  it("normalizes an upserted element's payload from v1 top-level fields", () => {
    const store = new PiUiElementStore();
    store.ingestDelta("agt_1", 1, {
      op: "upsert",
      element: {
        id: "activity",
        ns: "advisor",
        kind: "log",
        placement: "inline",
        lines: ["one", "two"],
        tail: 50,
      },
    });

    const element = store.getElement("agt_1", "advisor", "activity") as PiUiElement & {
      payload?: { lines?: string[] };
    };
    expect(element.payload).toEqual({ kind: "log", lines: ["one", "two"], tail: 50 });
  });

  it("keeps an already-canonical payload as-is", () => {
    const store = new PiUiElementStore();
    store.ingestFullState({
      agentId: "agt_1",
      revision: 1,
      elements: [
        {
          id: "notes",
          ns: "btw",
          kind: "markdown",
          placement: "screen",
          payload: { kind: "markdown", text: "# Notes" },
        },
      ],
      updatedAt: "2026-08-31T00:00:00.000Z",
    });

    const element = store.getElement("agt_1", "btw", "notes") as PiUiElement & {
      payload?: { text?: string };
    };
    expect(element.payload).toEqual({ kind: "markdown", text: "# Notes" });
  });
});

describe("piUiElementKey", () => {
  it("joins ns and id with a colon", () => {
    expect(piUiElementKey("advisor", "activity")).toBe("advisor:activity");
  });
});
