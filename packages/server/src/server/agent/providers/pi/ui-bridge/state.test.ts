import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PiUiElementSchema,
  type PiUiDelta,
  type PiUiElement,
} from "@picompanion/protocol/pi-ui-bridge/schema";
import type { AgentStreamEvent, AgentTimelineItem } from "../../../agent-sdk-types.js";
import { normalizePiUiElementInput } from "./payload-compat.js";
import {
  PIUI_MAX_LOG_LINES,
  PIUI_MAX_REPLAY_DELTAS,
  PIUI_TTL_MAX_MS,
  PIUI_TTL_MIN_MS,
  PiUiStateStore,
  clampAdvisoryTtlMs,
  type PiUiDurableSnapshotOptions,
  type PiUiResyncReason,
} from "./state.js";

const AGENT = "agent-1";

type Notice = { level: string; message: string };
type Resync = { agentId: string; reason?: PiUiResyncReason };
type Rec = Record<string, unknown>;

function makeStore(durableSnapshots: PiUiDurableSnapshotOptions = {}) {
  const events: AgentStreamEvent[] = [];
  const resyncs: Resync[] = [];
  const notices: Notice[] = [];
  const store = new PiUiStateStore(
    (event) => events.push(event),
    (agentId, reason) => resyncs.push({ agentId, reason }),
    (level, message) => notices.push({ level, message }),
    durableSnapshots,
  );
  return { store, events, resyncs, notices };
}

function element(raw: Rec): PiUiElement {
  return PiUiElementSchema.parse(normalizePiUiElementInput(raw));
}

const logElement = (overrides: Rec = {}): PiUiElement =>
  element({ id: "out", ns: "loop", kind: "log", placement: "inline", lines: ["a"], ...overrides });

describe("PiUiStateStore identity (plan.md §4.2)", () => {
  it("keys state by ns:id so two namespaces can share an id", () => {
    const { store } = makeStore();
    store.applySet(
      AGENT,
      element({ id: "main", ns: "loop", kind: "status", placement: "status", text: "loop" }),
    );
    store.applySet(
      AGENT,
      element({ id: "main", ns: "btw", kind: "status", placement: "status", text: "btw" }),
    );

    expect(store.getElements(AGENT)).toHaveLength(2);
    expect(store.getElement(AGENT, "loop", "main")?.ns).toBe("loop");
    expect(store.getElement(AGENT, "btw", "main")?.ns).toBe("btw");
  });

  it("emits removals with the resolved ns, never a bare id", () => {
    const { store, events } = makeStore();
    store.applySet(AGENT, element({ id: "main", ns: "loop", kind: "status", placement: "status" }));
    store.applyRemove(AGENT, "main");

    const removal = events.at(-1) as Extract<AgentStreamEvent, { type: "pi_ui_delta" }>;
    expect(removal.delta).toEqual({ op: "remove", id: "main", ns: "loop" });
  });

  it("refuses a bare-id removal that is ambiguous across namespaces", () => {
    const { store, notices } = makeStore();
    store.applySet(AGENT, element({ id: "main", ns: "loop", kind: "status", placement: "status" }));
    store.applySet(AGENT, element({ id: "main", ns: "btw", kind: "status", placement: "status" }));

    store.applyRemove(AGENT, "main");

    expect(store.getElements(AGENT)).toHaveLength(2);
    expect(notices.at(-1)?.message).toMatch(/ambiguous/i);
  });

  it("keeps ns:id immutable across a patch", () => {
    const { store } = makeStore();
    store.applySet(AGENT, element({ id: "main", ns: "loop", kind: "status", placement: "status" }));
    store.applyPatch(AGENT, "main", "loop", { id: "hijack", ns: "evil", title: "t" });

    expect(store.getElements(AGENT)).toHaveLength(1);
    const updated = store.getElement(AGENT, "loop", "main")!;
    expect(updated.id).toBe("main");
    expect(updated.ns).toBe("loop");
    expect(updated.title).toBe("t");
  });
});

describe("PiUiStateStore patch rules (plan.md §4.2)", () => {
  it("rejects a patch for a missing element and requests a full resync", () => {
    const { store, events, resyncs, notices } = makeStore();

    store.applyPatch(AGENT, "ghost", "loop", { title: "invented" });

    expect(store.getElements(AGENT)).toEqual([]);
    expect(events).toEqual([]);
    expect(resyncs).toEqual([{ agentId: AGENT, reason: "patch-missing-element" }]);
    expect(notices.at(-1)?.message).toMatch(/unknown element loop:ghost/);
    expect(store.getRevision(AGENT)).toBe(0);
  });

  it("never invents a markdown placeholder for an unknown patch", () => {
    const { store } = makeStore();
    store.applyPatch(AGENT, "ghost", "loop", { text: "hello" });
    expect(store.getElements(AGENT)).toEqual([]);
  });

  it("rejects a patch that would change the payload kind", () => {
    const { store, notices } = makeStore();
    store.applySet(
      AGENT,
      element({ id: "s", ns: "loop", kind: "status", placement: "status", text: "x" }),
    );

    store.applyPatch(AGENT, "s", "loop", { kind: "log", lines: ["a"] });

    expect(store.getElement(AGENT, "loop", "s")?.kind).toBe("status");
    expect(notices.at(-1)?.message).toMatch(/cannot change kind/);
  });

  it("merges v1 top-level patch fields back into the canonical payload", () => {
    const { store } = makeStore();
    store.applySet(
      AGENT,
      element({ id: "s", ns: "loop", kind: "status", placement: "status", text: "old" }),
    );

    store.applyPatch(AGENT, "s", "loop", { text: "new" });

    const updated = store.getElement(AGENT, "loop", "s") as unknown as Rec;
    expect(updated.text).toBe("new");
    expect(updated.payload).toMatchObject({ kind: "status", text: "new" });
  });
});

describe("PiUiStateStore append rules (plan.md §4.2)", () => {
  it("appends to a log payload", () => {
    const { store } = makeStore();
    store.applySet(AGENT, logElement());

    store.applyAppend(AGENT, "out", "loop", "b");

    const updated = store.getElement(AGENT, "loop", "out") as unknown as Rec;
    expect((updated.payload as Rec).lines).toEqual(["a", "b"]);
    expect(updated.lines).toEqual(["a", "b"]);
  });

  it("accepts array and {lines} append data", () => {
    const { store } = makeStore();
    store.applySet(AGENT, logElement());

    store.applyAppend(AGENT, "out", "loop", ["b", "c"]);
    store.applyAppend(AGENT, "out", "loop", { lines: ["d"] });

    const payload = (store.getElement(AGENT, "loop", "out") as unknown as Rec).payload as Rec;
    expect(payload.lines).toEqual(["a", "b", "c", "d"]);
  });

  it("rejects append for kinds that do not support it", () => {
    const { store, events, notices } = makeStore();
    const status = element({ id: "s", ns: "loop", kind: "status", placement: "status", text: "x" });
    store.applySet(AGENT, status);
    const revisionBefore = store.getRevision(AGENT);
    const eventsBefore = events.length;

    for (const kind of ["status", "widget", "progress", "roster", "markdown"] as const) {
      const el = element(
        kind === "roster"
          ? { id: kind, ns: "loop", kind, placement: "inline", rows: [] }
          : kind === "markdown"
            ? { id: kind, ns: "loop", kind, placement: "inline", text: "x" }
            : { id: kind, ns: "loop", kind, placement: "inline" },
      );
      store.applySet(AGENT, el);
      const rev = store.getRevision(AGENT);
      store.applyAppend(AGENT, kind, "loop", "line");
      expect(store.getRevision(AGENT)).toBe(rev);
    }

    expect(notices.filter((n) => /does not support append/.test(n.message))).toHaveLength(5);
    expect(store.getElement(AGENT, "loop", "s")).toEqual(status);
    expect(store.getRevision(AGENT)).toBeGreaterThan(revisionBefore);
    expect(events.length).toBeGreaterThan(eventsBefore);
  });

  it("rejects append for a missing element and requests a resync", () => {
    const { store, resyncs } = makeStore();

    store.applyAppend(AGENT, "ghost", "loop", "line");

    expect(store.getElements(AGENT)).toEqual([]);
    expect(resyncs).toEqual([{ agentId: AGENT, reason: "append-missing-element" }]);
  });

  it("rejects unsupported append data", () => {
    const { store, notices } = makeStore();
    store.applySet(AGENT, logElement());

    store.applyAppend(AGENT, "out", "loop", { nope: 1 });

    expect(notices.at(-1)?.message).toMatch(/unsupported append data/);
    const payload = (store.getElement(AGENT, "loop", "out") as unknown as Rec).payload as Rec;
    expect(payload.lines).toEqual(["a"]);
  });

  it("bounds retained log lines", () => {
    const { store } = makeStore();
    store.applySet(AGENT, logElement({ lines: [] }));

    const many = Array.from({ length: PIUI_MAX_LOG_LINES + 10 }, (_, i) => `line-${i}`);
    store.applyAppend(AGENT, "out", "loop", many);

    const payload = (store.getElement(AGENT, "loop", "out") as unknown as Rec).payload as Rec;
    expect((payload.lines as string[]).length).toBe(PIUI_MAX_LOG_LINES);
    expect((payload.lines as string[])[0]).toBe("line-10");
  });
});

describe("PiUiStateStore TTL (daemon-enforced, helper TTL advisory)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clamps advisory helper TTLs into the daemon-owned range", () => {
    expect(clampAdvisoryTtlMs(0)).toBeNull();
    expect(clampAdvisoryTtlMs(-5)).toBeNull();
    expect(clampAdvisoryTtlMs(undefined)).toBeNull();
    expect(clampAdvisoryTtlMs("5000")).toBeNull();
    expect(clampAdvisoryTtlMs(1)).toBe(PIUI_TTL_MIN_MS);
    expect(clampAdvisoryTtlMs(PIUI_TTL_MAX_MS * 10)).toBe(PIUI_TTL_MAX_MS);
    expect(clampAdvisoryTtlMs(5_000)).toBe(5_000);
  });

  it("removes an element when its TTL expires, in the daemon", () => {
    const { store, events } = makeStore();
    store.applySet(
      AGENT,
      element({ id: "s", ns: "loop", kind: "status", placement: "status", text: "x", ttl: 5_000 }),
    );
    const revision = store.getRevision(AGENT);

    vi.advanceTimersByTime(4_999);
    expect(store.getElements(AGENT)).toHaveLength(1);

    vi.advanceTimersByTime(2);
    expect(store.getElements(AGENT)).toHaveLength(0);
    expect(store.getRevision(AGENT)).toBe(revision + 1);
    const last = events.at(-1) as Extract<AgentStreamEvent, { type: "pi_ui_delta" }>;
    expect(last.delta).toEqual({ op: "remove", id: "s", ns: "loop" });
  });

  it("re-arms the TTL on a later set and cancels it on explicit removal", () => {
    const { store } = makeStore();
    const el = element({ id: "s", ns: "loop", kind: "status", placement: "status", ttl: 5_000 });
    store.applySet(AGENT, el);

    vi.advanceTimersByTime(4_000);
    store.applySet(AGENT, el); // re-arms
    vi.advanceTimersByTime(4_000);
    expect(store.getElements(AGENT)).toHaveLength(1);

    store.applyRemove(AGENT, "s", "loop");
    const eventsAfterRemove = store.getRevision(AGENT);
    vi.advanceTimersByTime(60_000);
    expect(store.getRevision(AGENT)).toBe(eventsAfterRemove);
  });

  it("never expires an element without a positive helper TTL", () => {
    const { store } = makeStore();
    store.applySet(AGENT, element({ id: "s", ns: "loop", kind: "status", placement: "status" }));
    store.applySet(
      AGENT,
      element({ id: "z", ns: "loop", kind: "status", placement: "status", ttl: 0 }),
    );

    vi.advanceTimersByTime(PIUI_TTL_MAX_MS + 1_000);
    expect(store.getElements(AGENT)).toHaveLength(2);
  });

  it("cancels timers on clear, sync, and agent teardown", () => {
    const { store } = makeStore();
    const ttlEl = element({ id: "s", ns: "loop", kind: "status", placement: "status", ttl: 5_000 });

    store.applySet(AGENT, ttlEl);
    store.applyClear(AGENT);
    let revision = store.getRevision(AGENT);
    vi.advanceTimersByTime(10_000);
    expect(store.getRevision(AGENT)).toBe(revision);

    store.applySet(AGENT, ttlEl);
    store.applySync(AGENT, [element({ id: "k", ns: "loop", kind: "status", placement: "status" })]);
    revision = store.getRevision(AGENT);
    vi.advanceTimersByTime(10_000);
    expect(store.getRevision(AGENT)).toBe(revision);
    expect(store.getElements(AGENT).map((el) => el.id)).toEqual(["k"]);

    store.applySet(AGENT, ttlEl);
    store.clearAgent(AGENT);
    vi.advanceTimersByTime(10_000);
    expect(store.getElements(AGENT)).toEqual([]);
  });

  it("expires elements restored through sync", () => {
    const { store } = makeStore();
    store.applySync(AGENT, [
      element({ id: "s", ns: "loop", kind: "status", placement: "status", ttl: 2_000 }),
    ]);

    vi.advanceTimersByTime(2_500);
    expect(store.getElements(AGENT)).toEqual([]);
  });
});

describe("PiUiStateStore action routing (composite identity)", () => {
  const roster = () =>
    element({
      id: "fleet",
      ns: "subagents",
      kind: "roster",
      placement: "pinned",
      rows: [
        { id: "r1", label: "one", actions: [{ id: "stop", label: "Stop" }] },
        { id: "r2", label: "two" },
      ],
      actions: [{ id: "refresh", label: "Refresh" }],
    });

  it("resolves ns:id and produces composite action identity", () => {
    const { store } = makeStore();
    store.applySet(AGENT, roster());

    const resolution = store.resolveActionTarget(AGENT, {
      elementId: "subagents:fleet",
      actionId: "refresh",
    });

    expect(resolution).toEqual({
      ok: true,
      target: {
        ns: "subagents",
        id: "fleet",
        elementKey: "subagents:fleet",
        kind: "roster",
        actionId: "refresh",
        actionKey: "subagents:fleet:refresh",
      },
    });
  });

  it("resolves a per-row action", () => {
    const { store } = makeStore();
    store.applySet(AGENT, roster());

    const resolution = store.resolveActionTarget(AGENT, {
      elementId: "subagents:fleet#r1",
      actionId: "stop",
    });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.target.rowId).toBe("r1");
    expect(resolution.target.actionKey).toBe("subagents:fleet#r1:stop");
    expect(store.compositeIdFor(resolution.target)).toBe("subagents:fleet#r1");
  });

  it("resolves a nested panel>section>row action across one hop per segment", () => {
    const { store } = makeStore();
    store.applySet(
      AGENT,
      element({
        id: "board",
        ns: "ext",
        kind: "panel",
        placement: "pinned",
        sections: [
          {
            id: "team",
            kind: "roster",
            actions: [{ id: "refresh-team", label: "Refresh" }],
            payload: {
              kind: "roster",
              rows: [{ id: "r1", label: "one", actions: [{ id: "stop", label: "Stop" }] }],
            },
          },
        ],
        actions: [{ id: "refresh-all", label: "Refresh all" }],
      }),
    );

    const nested = store.resolveActionTarget(AGENT, {
      elementId: "ext:board#team#r1",
      actionId: "stop",
    });
    expect(nested.ok).toBe(true);
    if (!nested.ok) return;
    expect(nested.target.rowId).toBe("team#r1");
    expect(nested.target.actionKey).toBe("ext:board#team#r1:stop");

    // Every level's own actions stay addressable: the section's via one
    // hop, the panel's with no hop at all.
    expect(
      store.resolveActionTarget(AGENT, {
        elementId: "ext:board#team",
        actionId: "refresh-team",
      }).ok,
    ).toBe(true);
    expect(
      store.resolveActionTarget(AGENT, {
        elementId: "ext:board",
        actionId: "refresh-all",
      }).ok,
    ).toBe(true);
  });

  it("rejects an unknown nested segment without resolving a prefix of it", () => {
    const { store } = makeStore();
    store.applySet(
      AGENT,
      element({
        id: "board",
        ns: "ext",
        kind: "panel",
        placement: "pinned",
        sections: [
          {
            id: "team",
            kind: "roster",
            payload: {
              kind: "roster",
              rows: [{ id: "r1", label: "one", actions: [{ id: "stop", label: "Stop" }] }],
            },
          },
        ],
      }),
    );

    expect(
      store.resolveActionTarget(AGENT, {
        elementId: "ext:board#team#nope",
        actionId: "stop",
      }),
    ).toMatchObject({ ok: false });
    expect(
      store.resolveActionTarget(AGENT, {
        elementId: "ext:board#nope#r1",
        actionId: "stop",
      }),
    ).toMatchObject({ ok: false });
  });

  it("rejects an unknown row, unknown action, and unknown element", () => {
    const { store } = makeStore();
    store.applySet(AGENT, roster());

    expect(
      store.resolveActionTarget(AGENT, { elementId: "subagents:fleet#nope", actionId: "stop" }),
    ).toMatchObject({ ok: false });
    expect(
      store.resolveActionTarget(AGENT, { elementId: "subagents:fleet", actionId: "nope" }),
    ).toMatchObject({ ok: false });
    expect(
      store.resolveActionTarget(AGENT, { elementId: "other:fleet", actionId: "refresh" }),
    ).toMatchObject({ ok: false });
  });

  it("accepts a bare id only when exactly one namespace owns it", () => {
    const { store } = makeStore();
    store.applySet(AGENT, roster());

    const unique = store.resolveActionTarget(AGENT, { elementId: "fleet", actionId: "refresh" });
    expect(unique.ok).toBe(true);
    if (unique.ok) expect(unique.target.ns).toBe("subagents");

    store.applySet(
      AGENT,
      element({
        id: "fleet",
        ns: "other",
        kind: "roster",
        placement: "pinned",
        rows: [],
        actions: [{ id: "refresh", label: "Refresh" }],
      }),
    );

    const ambiguous = store.resolveActionTarget(AGENT, { elementId: "fleet", actionId: "refresh" });
    expect(ambiguous).toMatchObject({ ok: false });
    if (!ambiguous.ok) expect(ambiguous.error).toMatch(/ambiguous/i);
  });

  it("builds an envelope that carries ns and id, not just a bare element id", () => {
    const { store } = makeStore();
    store.applySet(AGENT, roster());
    const resolution = store.resolveActionTarget(AGENT, {
      elementId: "subagents:fleet#r1",
      actionId: "stop",
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    const envelope = store.buildActionEnvelope({
      target: resolution.target,
      value: { confirm: true },
      requestId: "req-9",
    });

    expect(envelope).toMatchObject({
      ns: "subagents",
      id: "fleet",
      elementKey: "subagents:fleet",
      rowId: "r1",
      actionKey: "subagents:fleet#r1:stop",
      requestId: "req-9",
    });
  });

  it("refuses to route when the agent has no state", () => {
    const { store } = makeStore();
    expect(
      store.resolveActionTarget("unknown-agent", { elementId: "loop:main", actionId: "stop" }),
    ).toMatchObject({ ok: false });
  });
});

describe("PiUiStateStore channel elements", () => {
  it("produces schema-valid typed payloads instead of cast passthrough", () => {
    const { store, notices } = makeStore();

    store.applyChannel(AGENT, "subagents:fleet", {
      header: "Fleet",
      entries: [{ id: "a", label: "agent a", state: "running" }],
    });
    store.applyChannel(AGENT, "workflow:progress", {
      name: "build",
      phase: "compile",
      active: true,
    });
    store.applyChannel(AGENT, "pi-goal:status", {
      status: "running",
      detail: "step 2",
      active: true,
    });

    expect(notices).toEqual([]);
    for (const el of store.getElements(AGENT)) {
      expect(PiUiElementSchema.safeParse(el).success).toBe(true);
      expect((el as unknown as Rec).payload).toMatchObject({ kind: el.kind });
    }
    const fleet = store.getElement(AGENT, "subagents", "fleet") as unknown as Rec;
    expect((fleet.payload as Rec).rows).toEqual([{ id: "a", label: "agent a", state: "running" }]);
  });

  // T40A3: closes the gap T40A2 filed and the P6-W2 gate confirmed — this
  // exact input (`step`/`total`, no `value`/`max`) previously produced a
  // typed payload of bare `{ kind: "progress" }`, because
  // `V1_PAYLOAD_FIELDS.progress` (`payload-compat.ts`) only lifts
  // `label`/`detail`/`value`/`max`/`indeterminate`. `applyChannel` now
  // aliases `step`/`total` to `value`/`max` before normalization runs.
  it("lifts workflow:progress's step/total into the typed payload's value/max", () => {
    const { store, notices } = makeStore();

    store.applyChannel(AGENT, "workflow:progress", {
      name: "build",
      phase: "implement",
      step: 2,
      total: 5,
      active: true,
    });

    expect(notices).toEqual([]);
    const progress = store.getElement(AGENT, "workflow", "progress") as unknown as Rec;
    expect(progress.payload).toMatchObject({ kind: "progress", value: 2, max: 5 });
  });

  it("still prefers an explicit value/max the channel payload provides directly", () => {
    const { store } = makeStore();

    store.applyChannel(AGENT, "workflow:progress", {
      name: "build",
      step: 2,
      total: 5,
      value: 9,
      max: 10,
    });

    const progress = store.getElement(AGENT, "workflow", "progress") as unknown as Rec;
    expect(progress.payload).toMatchObject({ kind: "progress", value: 9, max: 10 });
  });

  // T40A4: pi-goal's real `pi-goal:status` publish always carries a numeric
  // `startedAt` (epoch ms; confirmed against the installed extension's own
  // source, `C:\Users\aksha\.pi\agent\extensions\pi-goal\index.ts`), but this
  // case previously read only `status`/`detail`/`text`/`tone`/`active`/
  // `running` — `startedAt` never reached either synthesized element, so a
  // renderer had no way to compute live elapsed time. Both the `status` and
  // the pinned `goal-progress` element must now carry it through to their
  // typed payload (not just the envelope) so a renderer reading
  // `payload.startedAt` can see it.
  it("carries pi-goal:status's startedAt through to both synthesized elements' typed payload", () => {
    const { store, notices } = makeStore();

    store.applyChannel(AGENT, "pi-goal:status", {
      status: "active",
      detail: "round 2",
      active: true,
      startedAt: 1_725_000_000_000,
    });

    expect(notices).toEqual([]);
    const status = store.getElement(AGENT, "goal", "status") as unknown as Rec;
    const progress = store.getElement(AGENT, "goal", "goal-progress") as unknown as Rec;
    expect(status.payload).toMatchObject({ kind: "status", startedAt: 1_725_000_000_000 });
    expect(progress.payload).toMatchObject({ kind: "progress", startedAt: 1_725_000_000_000 });
  });

  it("omits startedAt entirely when pi-goal:status does not send one, rather than inventing a value", () => {
    const { store } = makeStore();

    store.applyChannel(AGENT, "pi-goal:status", { status: "active", active: true });

    const status = store.getElement(AGENT, "goal", "status") as unknown as Rec;
    const progress = store.getElement(AGENT, "goal", "goal-progress") as unknown as Rec;
    expect((status.payload as Rec).startedAt).toBeUndefined();
    expect((progress.payload as Rec).startedAt).toBeUndefined();
  });
});

/**
 * T40A4 — what a real `applyChannel` call for each of plan.md §11.7's three
 * published channels actually hands the web right rail (`apps/web/src/
 * features/rail/`, which only ever renders `placement: "pinned"` elements —
 * `select-rail-elements.ts`). This drives the real `PiUiStateStore` (no
 * daemon, no socket: the same in-process class this file already tests) with
 * the exact payload shapes `docs/pi-extension-compatibility.md` §4/§5
 * records as captured from the real installed extensions, and asserts the
 * literal upsert deltas that reach `emit` — the client-side proof in
 * `apps/web/src/features/rail/published-channels.test.tsx` reuses these same
 * literal element shapes to prove the rail renders them, so the two halves
 * of the pipeline (daemon synthesis, client rendering) are checked against
 * one shared, real value rather than two independently-invented fixtures.
 */
describe("PiUiStateStore published channels -> what reaches the pinned rail (T40A4)", () => {
  it("subagents:fleet always synthesizes one pinned roster", () => {
    const { store, events } = makeStore();

    // docs/pi-extension-compatibility.md §3.1/§5 recorded fixture.
    store.applyChannel(AGENT, "subagents:fleet", {
      entries: [
        {
          id: "job-1",
          label: "research: synthetic query on /tmp/synthetic.ts",
          state: "running",
          model: "opencode/deepseek-v4-flash",
          elapsedSec: 42,
        },
      ],
      active: true,
      selected: "main",
    });

    const deltas = events.filter(
      (e): e is Extract<AgentStreamEvent, { type: "pi_ui_delta" }> => e.type === "pi_ui_delta",
    );
    expect(deltas).toHaveLength(1);
    const fleet = deltas[0]!.delta as Extract<PiUiDelta, { op: "upsert" }>;
    expect(fleet.element.placement).toBe("pinned");
    expect(fleet.element).toMatchObject({
      id: "fleet",
      ns: "subagents",
      kind: "roster",
      placement: "pinned",
      payload: {
        kind: "roster",
        rows: [
          {
            id: "job-1",
            label: "research: synthetic query on /tmp/synthetic.ts",
            state: "running",
          },
        ],
      },
    });
  });

  // "workflows" §11.7 required UI is "approval form, progress, roster, and
  // logs" delivered through `workflows/ui/bridge-panel.ts`'s own `panel`
  // element (outside this channel entirely, per docs/pi-extension-
  // compatibility.md §3.5/§5) — the `workflow:progress` channel itself
  // synthesizes a `placement: "status"` progress element (header/status
  // strip territory, plan.md §11.5, never the rail) plus, gated behind
  // `payload.active === true`, a *separate* pinned `progress` element that
  // T113 taught to carry the same `step`/`total` as the status element,
  // closing the gap T40A4 disclosed (a plain-text `widget` that dropped
  // `step`/`total` entirely, so the rail could only ever show a title, never
  // a bar). Proven here rather than assumed, because the pre-existing
  // `pi-extension-rail.test.tsx` fixture for "workflow" (a hand-authored
  // `placement: "pinned"` `progress` element under a different `ns`/`id`) is
  // an illustrative approximation, not what this channel actually produces —
  // see that file's own header comment.
  it("workflow:progress synthesizes no pinned content at all when the channel omits active", () => {
    const { store } = makeStore();

    // docs/pi-extension-compatibility.md §3.1/§5 recorded fixture — no
    // `active` key.
    store.applyChannel(AGENT, "workflow:progress", {
      status: "running",
      phase: "implement",
      step: 2,
      total: 5,
    });

    const progress = store.getElement(AGENT, "workflow", "progress");
    expect(progress?.placement).toBe("status");
    expect(store.getElement(AGENT, "workflow", "workflow-widget")).toBeUndefined();
    // From the rail's point of view (only `placement: "pinned"` elements),
    // this channel produced literally nothing to show — not an error, not a
    // diagnostic, just silence. This is unrelated to T113's fix: `active`
    // still gates whether anything pinned appears at all, only its *shape*
    // changed.
    expect(store.getElements(AGENT).some((el) => el.placement === "pinned")).toBe(false);
  });

  it("workflow:progress synthesizes one pinned determinate progress element (step/total, not plain text) once active is true", () => {
    const { store } = makeStore();

    store.applyChannel(AGENT, "workflow:progress", {
      status: "running",
      phase: "implement",
      step: 2,
      total: 5,
      active: true,
    });

    const widget = store.getElement(AGENT, "workflow", "workflow-widget") as unknown as Rec;
    expect(widget.placement).toBe("pinned");
    // T113: this used to be a plain-text `widget` that could never reach a
    // progress renderer at all; it is now the same `progress` kind the
    // status-placement sibling above uses, so the already-registered
    // `progress` renderer (`apps/web/.../renderers/progress.tsx`) draws a
    // real determinate bar for it on the rail.
    expect(widget.kind).toBe("progress");
    expect(widget.payload).toMatchObject({ kind: "progress", label: "workflow · implement" });
    // The exact assertion T113's acceptance criteria require: `step`/`total`
    // reach THIS pinned element's typed payload — not merely the other,
    // status-placement one the rail can never show.
    expect((widget.payload as Rec).value).toBe(2);
    expect((widget.payload as Rec).max).toBe(5);
  });

  // T113 acceptance: "dropping either field fails a named test", proven by
  // two independent mutations rather than asserted:
  //
  //   1. delete the `step !== undefined ? { value: step } : {}` spread from
  //      the pinned element in `state.ts`'s `workflow:progress` case ->
  //      `expect((widget.payload as Rec).value).toBe(2)` above fails
  //      (`value` is `undefined`), 1 failed test observed.
  //   2. delete the `total !== undefined ? { max: total } : {}` spread ->
  //      `expect((widget.payload as Rec).max).toBe(5)` above fails (`max` is
  //      `undefined`), 1 failed test observed.
  //
  // Both mutations were run against the committed tree and restored
  // byte-identically afterward; see this task's report for the exact
  // command and failure output.
  it("an absent total still renders something truthful: the pinned element is marked indeterminate instead of a fabricated fraction", () => {
    const { store } = makeStore();

    // `total` genuinely absent (not just falsy) — e.g. a workflow that knows
    // its current step but not yet how many steps there will be.
    store.applyChannel(AGENT, "workflow:progress", {
      status: "running",
      phase: "implement",
      step: 2,
      active: true,
    });

    const widget = store.getElement(AGENT, "workflow", "workflow-widget") as unknown as Rec;
    const payload = widget.payload as Rec;
    expect(payload.value).toBe(2);
    expect(payload.max).toBeUndefined();
    // The synthesized payload itself does not fabricate an `indeterminate`
    // flag (state.ts only ever forwards fields it actually has) — the
    // renderer-side truthfulness (`progress.tsx` treating a missing `max`
    // as indeterminate rather than clamping the raw step count into
    // `[0, 1]`) is proven in the web test suite
    // (`apps/web/src/features/extensions/renderers/progress.test.tsx`)
    // against this exact payload shape.
    expect(payload.indeterminate).toBeUndefined();
  });

  it("pi-goal:status synthesizes one pinned progress element while active, carrying startedAt", () => {
    const { store } = makeStore();

    // docs/pi-extension-compatibility.md §3.1/§5 recorded fixture, plus the
    // real extension's own `startedAt` (epoch ms) field.
    store.applyChannel(AGENT, "pi-goal:status", {
      id: "goal-synthetic",
      text: "Synthetic objective — /tmp/synthetic.ts",
      status: "active",
      rounds: 2,
      budget: "1.2k/100k",
      active: true,
      startedAt: 1_725_000_000_000,
    });

    const pinned = store.getElements(AGENT).filter((el) => el.placement === "pinned");
    expect(pinned).toHaveLength(1);
    expect(pinned[0]).toMatchObject({
      id: "goal-progress",
      ns: "goal",
      kind: "progress",
      placement: "pinned",
      payload: { kind: "progress", indeterminate: true, startedAt: 1_725_000_000_000 },
    });
  });
});

/**
 * Deterministic revision rules, reconnect replay, close, agent shutdown, and
 * durable snapshots (plan.md §4.2). The rules themselves are unit tested in
 * isolation in `revision.test.ts`; this section exercises them wired into the
 * store that actually produces and buffers them.
 */
describe("PiUiStateStore revision handling (plan.md §4.2)", () => {
  it("advances the revision by exactly one per committed delta", () => {
    const { store } = makeStore();
    expect(store.getRevision(AGENT)).toBe(0);
    store.applySet(AGENT, element({ id: "a", ns: "ns", kind: "status", placement: "status" }));
    expect(store.getRevision(AGENT)).toBe(1);
    store.applySet(AGENT, element({ id: "b", ns: "ns", kind: "status", placement: "status" }));
    expect(store.getRevision(AGENT)).toBe(2);
  });

  it("stamps every emitted delta and full state with the new revision", () => {
    const { store, events } = makeStore();
    store.applySet(AGENT, element({ id: "a", ns: "ns", kind: "status", placement: "status" }));
    const delta = events.at(-1) as Extract<AgentStreamEvent, { type: "pi_ui_delta" }>;
    expect(delta.revision).toBe(1);

    store.applySync(AGENT, [element({ id: "a", ns: "ns", kind: "status", placement: "status" })]);
    const full = events.at(-1) as Extract<AgentStreamEvent, { type: "pi_ui_state" }>;
    expect(full.state.revision).toBe(2);
  });
});

describe("PiUiStateStore reconnect replay (plan.md §4.2)", () => {
  function seed(store: PiUiStateStore, count: number) {
    for (let i = 0; i < count; i++) {
      store.applySet(
        AGENT,
        element({ id: `e${i}`, ns: "ns", kind: "status", placement: "status", text: `t${i}` }),
      );
    }
  }

  it("reports up-to-date when the client already has the current revision", () => {
    const { store } = makeStore();
    seed(store, 3);
    expect(store.planReplay(AGENT, 3)).toEqual({ mode: "up-to-date", revision: 3 });
  });

  it("reports up-to-date for a never-seen agent when the client also claims revision 0", () => {
    const { store } = makeStore();
    expect(store.planReplay("no-such-agent", 0)).toEqual({ mode: "up-to-date", revision: 0 });
  });

  it("replays only the buffered deltas the client is missing", () => {
    const { store } = makeStore();
    seed(store, 5);
    const plan = store.planReplay(AGENT, 2);
    if (plan.mode !== "deltas") throw new Error(`expected deltas, got ${plan.mode}`);
    expect(plan.revision).toBe(5);
    expect(plan.entries.map((e) => e.revision)).toEqual([3, 4, 5]);
  });

  it("emits exactly the missing deltas, each stamped with its own historical revision", () => {
    const { store, events } = makeStore();
    seed(store, 5);
    events.length = 0;

    const plan = store.replayFor(AGENT, 2);

    expect(plan.mode).toBe("deltas");
    const deltas = events.filter(
      (e): e is Extract<AgentStreamEvent, { type: "pi_ui_delta" }> => e.type === "pi_ui_delta",
    );
    expect(deltas.map((d) => d.revision)).toEqual([3, 4, 5]);
    expect(events.some((e) => e.type === "pi_ui_state")).toBe(false);
  });

  it("falls back to an empty full state for an unknown agent claiming a nonzero revision", () => {
    const { store } = makeStore();
    const plan = store.planReplay("no-such-agent", 5);
    expect(plan).toEqual({
      mode: "full",
      revision: 0,
      state: expect.objectContaining({ agentId: "no-such-agent", revision: 0, elements: [] }),
    });
  });

  it("falls back to a full state for a stale/invalid client revision", () => {
    const { store } = makeStore();
    seed(store, 2);
    for (const bad of [-1, 1.5, Number.NaN, "1", null, undefined]) {
      expect(store.planReplay(AGENT, bad).mode).toBe("full");
    }
  });

  it("falls back to a full state when the client claims to be ahead of the server", () => {
    const { store } = makeStore();
    seed(store, 2);
    expect(store.planReplay(AGENT, 99).mode).toBe("full");
  });

  it("falls back to a full state once the gap exceeds the bounded replay buffer", () => {
    const { store } = makeStore();
    const total = PIUI_MAX_REPLAY_DELTAS + 10;
    seed(store, total);

    // Revision 1 fell out of the buffer long ago; only the newest
    // PIUI_MAX_REPLAY_DELTAS deltas are still retained.
    const plan = store.planReplay(AGENT, 1);
    if (plan.mode !== "full") throw new Error(`expected full, got ${plan.mode}`);
    expect(plan.state.revision).toBe(total);
    expect(plan.state.elements).toHaveLength(total);
  });

  it("emits a full state (not deltas) once the replay buffer can no longer cover the gap", () => {
    const { store, events } = makeStore();
    seed(store, PIUI_MAX_REPLAY_DELTAS + 10);
    events.length = 0;

    const plan = store.replayFor(AGENT, 1);

    expect(plan.mode).toBe("full");
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("pi_ui_state");
  });

  it("a full state clears the replay buffer, so nothing before it is ever replayed across it", () => {
    const { store } = makeStore();
    seed(store, 3);
    store.applySync(AGENT, [
      element({ id: "only", ns: "ns", kind: "status", placement: "status" }),
    ]);

    // applySync bumps the revision once more (to 4); nothing before it is
    // in the buffer any more.
    expect(store.planReplay(AGENT, 1).mode).toBe("full");
  });
});

describe("PiUiStateStore close and agent shutdown (plan.md §4.2)", () => {
  it("agent shutdown (clearAgent) resets that agent to the initial revision without touching others", () => {
    const { store } = makeStore();
    store.applySet(AGENT, element({ id: "a", ns: "ns", kind: "status", placement: "status" }));
    store.applySet("agent-2", element({ id: "a", ns: "ns", kind: "status", placement: "status" }));
    expect(store.getRevision(AGENT)).toBe(1);

    store.clearAgent(AGENT);

    expect(store.getRevision(AGENT)).toBe(0);
    expect(store.getElements(AGENT)).toEqual([]);
    expect(store.getRevision("agent-2")).toBe(1);

    store.applySet(AGENT, element({ id: "b", ns: "ns", kind: "status", placement: "status" }));
    expect(store.getRevision(AGENT)).toBe(1);
  });

  it("a reconnecting client sees an empty full state after its agent shuts down", () => {
    const { store } = makeStore();
    store.applySet(AGENT, element({ id: "a", ns: "ns", kind: "status", placement: "status" }));
    store.clearAgent(AGENT);

    expect(store.planReplay(AGENT, 1)).toEqual({
      mode: "full",
      revision: 0,
      state: expect.objectContaining({ agentId: AGENT, revision: 0, elements: [] }),
    });
  });

  it("close (dispose) latches the store: every mutating method becomes a silent no-op", () => {
    const { store, events } = makeStore();
    store.applySet(AGENT, element({ id: "a", ns: "ns", kind: "status", placement: "status" }));

    store.dispose();
    events.length = 0;

    store.applySet(AGENT, element({ id: "b", ns: "ns", kind: "status", placement: "status" }));
    store.applyRemove(AGENT, "a", "ns");
    store.applyClear(AGENT);
    store.applySync(AGENT, [element({ id: "c", ns: "ns", kind: "status", placement: "status" })]);
    store.applyAppend(AGENT, "a", "ns", "line");
    store.applyChannel(AGENT, "pi-goal:status", { status: "running" });

    expect(events).toEqual([]);
    expect(store.getElements(AGENT)).toEqual([]);
  });

  it("close (dispose) is idempotent and cancels pending TTL timers", () => {
    vi.useFakeTimers();
    try {
      const { store, events } = makeStore();
      store.applySet(
        AGENT,
        element({ id: "a", ns: "ns", kind: "status", placement: "status", ttl: 5_000 }),
      );

      store.dispose();
      store.dispose();
      events.length = 0;
      vi.advanceTimersByTime(60_000);

      expect(events).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PiUiStateStore durable snapshots (plan.md §4.2)", () => {
  function timelineSnapshots(
    events: AgentStreamEvent[],
  ): Extract<AgentTimelineItem, { type: "pi_ui_snapshot" }>[] {
    return events
      .filter((e): e is Extract<AgentStreamEvent, { type: "timeline" }> => e.type === "timeline")
      .map((e) => e.item)
      .filter(
        (item): item is Extract<AgentTimelineItem, { type: "pi_ui_snapshot" }> =>
          item.type === "pi_ui_snapshot",
      );
  }

  it("never persists anything when durable snapshots are disabled (the default)", () => {
    const { store, events } = makeStore();
    store.applySet(
      AGENT,
      element({ id: "a", ns: "ns", kind: "status", placement: "status", durable: true }),
    );
    expect(timelineSnapshots(events)).toEqual([]);
  });

  it("persists only elements explicitly marked durable, never ephemeral state", () => {
    const { store, events } = makeStore({ enabled: true });
    store.applySet(
      AGENT,
      element({ id: "keep", ns: "ns", kind: "status", placement: "status", durable: true }),
    );
    store.applySet(
      AGENT,
      element({ id: "ephemeral", ns: "ns", kind: "status", placement: "status" }),
    );

    const snapshots = timelineSnapshots(events);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.state.elements.map((el) => el.id)).toEqual(["keep"]);
  });

  it("bounds a durable snapshot to maxElements", () => {
    const { store, events } = makeStore({ enabled: true, maxElements: 1 });
    store.applySet(
      AGENT,
      element({ id: "a", ns: "ns", kind: "status", placement: "status", durable: true }),
    );
    store.applySet(
      AGENT,
      element({ id: "b", ns: "ns", kind: "status", placement: "status", durable: true }),
    );

    const snapshots = timelineSnapshots(events);
    expect(snapshots.at(-1)!.state.elements).toHaveLength(1);
  });

  it("bounds a durable snapshot to maxBytes by trimming from the retained set", () => {
    const bigA = element({
      id: "a",
      ns: "ns",
      kind: "status",
      placement: "status",
      durable: true,
      title: "x".repeat(200),
    });
    const bigB = element({
      id: "b",
      ns: "ns",
      kind: "status",
      placement: "status",
      durable: true,
      title: "y".repeat(200),
    });
    const sizeOfOne = Buffer.byteLength(JSON.stringify([bigA]), "utf8");

    const { store, events } = makeStore({
      enabled: true,
      maxElements: 10,
      maxBytes: sizeOfOne + 1,
    });
    store.applySet(AGENT, bigA);
    store.applySet(AGENT, bigB);

    const snapshots = timelineSnapshots(events);
    expect(snapshots.at(-1)!.state.elements.map((el) => el.id)).toEqual(["a"]);
  });

  it("never emits an empty durable snapshot for an agent that never had a durable element", () => {
    const { store, events } = makeStore({ enabled: true, maxElements: 10, maxBytes: 1 });
    store.applySet(
      AGENT,
      element({ id: "a", ns: "ns", kind: "status", placement: "status", durable: true }),
    );

    // maxBytes: 1 means even a single durable element never fits.
    expect(timelineSnapshots(events)).toEqual([]);
  });

  it("dedupes: does not re-emit an unchanged durable snapshot", () => {
    const { store, events } = makeStore({ enabled: true });
    store.applySet(
      AGENT,
      element({ id: "a", ns: "ns", kind: "status", placement: "status", durable: true }),
    );
    events.length = 0;

    // A non-durable element changes; the durable set is unaffected.
    store.applySet(AGENT, element({ id: "b", ns: "ns", kind: "status", placement: "status" }));

    expect(timelineSnapshots(events)).toEqual([]);
  });

  it("emits an updated durable snapshot when the durable set actually changes", () => {
    const { store, events } = makeStore({ enabled: true });
    store.applySet(
      AGENT,
      element({ id: "a", ns: "ns", kind: "status", placement: "status", durable: true }),
    );
    store.applySet(
      AGENT,
      element({ id: "b", ns: "ns", kind: "status", placement: "status", durable: true }),
    );

    const snapshots = timelineSnapshots(events);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]!.state.elements.map((el) => el.id)).toEqual(["a"]);
    expect(snapshots[1]!.state.elements.map((el) => el.id)).toEqual(["a", "b"]);
  });
});
