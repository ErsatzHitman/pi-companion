import { describe, expect, it, vi } from "vitest";

import type { AgentStreamEvent } from "@picompanion/protocol/agent-types";
import type { Clock, TimerHandle } from "@picompanion/frontend-core";

/**
 * T34A5 — proves the two things `registry-index.ts`'s doc comment now
 * promises: `createPiUiSession` (1) makes renderer registration
 * unconditional the moment a screen holds a store, and (2) wires a real,
 * deterministic `PiUiElementStore` and a real `ExtensionActionController`
 * (both `@picompanion/frontend-core`, T21B/T21C — not redeclared here)
 * together correctly for Android.
 *
 * This file imports `./registry-index` (unlike every other test in this
 * directory except `registry-index.test.ts`, whose doc comment explains
 * why that import is normally avoided), because that import IS the thing
 * under test for (1): `createPiUiSession` only proves it closes the dead-
 * registration defect if constructing a session, through the same module
 * a router will actually import, is what pulls the renderers in. So this
 * file mocks `react-native`/`react-native-reanimated` the same way
 * `registry-index.test.ts` does — see that file's doc comment for why the
 * stand-ins are an enumerated set and why an uncalled stub is sufficient
 * for an import-only concern.
 */
vi.mock("react-native", () => {
  function Stub(): null {
    return null;
  }
  return {
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: Stub,
    View: Stub,
    Pressable: Stub,
    ScrollView: Stub,
    Modal: Stub,
    TextInput: Stub,
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => false,
      addEventListener: () => ({ remove: () => undefined }),
    },
    BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
    findNodeHandle: () => null,
    useColorScheme: () => "light",
    Linking: { openURL: async () => true },
  };
});

vi.mock("react-native-reanimated", () => {
  function Stub(): null {
    return null;
  }
  const Animated = { View: Stub, Text: Stub, createAnimatedComponent: (c: unknown) => c };
  return {
    default: Animated,
    Easing: { ease: (v: number) => v, out: (fn: unknown) => fn, linear: (v: number) => v },
    useAnimatedStyle: () => ({}),
    useSharedValue: (value: unknown) => ({ value }),
    withTiming: (value: unknown) => value,
    withRepeat: (value: unknown) => value,
  };
});

// T349: `ui/primitives/index.ts` now also exports `VectorIcon`
// (`vector-icons.tsx`), whose `react-native-svg` import carries the same
// unparseable-by-plain-vitest source every `react-native` package in this
// file's chain does. Stood in for exactly like the two mocks above, and
// for the same reason: nothing here renders, so an inert stand-in is
// enough for an import-only test. Enumerated, not generic -- the members
// are the ones `vector-icons.tsx` actually imports today, so adding a new
// SVG element there is a deliberate two-file change, not a silent one.
vi.mock("react-native-svg", () => {
  function Stub(): null {
    return null;
  }
  return { default: Stub, Circle: Stub, Path: Stub, Rect: Stub };
});

const {
  createExtensionsClock,
  createPiUiSession,
  ingestPiUiAgentStreamEvent,
  piUiRendererRegistry,
} = await import("./registry-index");

/** Deterministic, manually-advanced `Clock` — no real timers (plan.md §7.3). */
class FakeClock implements Clock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }
  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delayMs, callback });
    return id as unknown as TimerHandle;
  }
  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }
  setInterval(callback: () => void, intervalMs: number): TimerHandle {
    return this.setTimeout(callback, intervalMs);
  }
  clearInterval(handle: TimerHandle): void {
    this.clearTimeout(handle);
  }
}

function upsertEvent(
  agentId: string,
  revision: number,
  element: { id: string; ns: string; kind: string; placement: string; title?: string },
): AgentStreamEvent {
  return {
    type: "pi_ui_delta",
    provider: "pi",
    agentId,
    revision,
    delta: { op: "upsert", element: element as never },
  } as AgentStreamEvent;
}

function removeEvent(agentId: string, revision: number, id: string, ns: string): AgentStreamEvent {
  return {
    type: "pi_ui_delta",
    provider: "pi",
    agentId,
    revision,
    delta: { op: "remove", id, ns },
  } as AgentStreamEvent;
}

function actionResultEvent(
  elementId: string,
  actionId: string,
  ok: boolean,
  error?: string,
): AgentStreamEvent {
  return {
    type: "pi_ui_action_result",
    provider: "pi",
    result: { elementId, actionId, ok, error },
  } as AgentStreamEvent;
}

describe("createPiUiSession — registration is no longer dead once a screen holds a store (T34A5)", () => {
  it("registers every renderer implemented so far as a side effect of construction alone", () => {
    createPiUiSession({ sendRequest: () => undefined, clock: new FakeClock() });
    for (const kind of ["status", "widget", "progress", "log", "markdown", "composer"] as const) {
      expect(piUiRendererRegistry.has(kind)).toBe(true);
    }
  });
});

describe("PiUiSession store — deterministic ordering (T34A5)", () => {
  it("keeps stable first-insertion order across updates to the same id", () => {
    const session = createPiUiSession({ sendRequest: () => undefined, clock: new FakeClock() });
    ingestPiUiAgentStreamEvent(
      session,
      "agt_1",
      upsertEvent("agt_1", 1, {
        id: "a",
        ns: "todo",
        kind: "widget",
        placement: "pinned",
        title: "A1",
      }),
    );
    ingestPiUiAgentStreamEvent(
      session,
      "agt_1",
      upsertEvent("agt_1", 2, {
        id: "b",
        ns: "todo",
        kind: "widget",
        placement: "pinned",
        title: "B1",
      }),
    );
    // Re-upserting "a" must not move it to the end.
    ingestPiUiAgentStreamEvent(
      session,
      "agt_1",
      upsertEvent("agt_1", 3, {
        id: "a",
        ns: "todo",
        kind: "widget",
        placement: "pinned",
        title: "A2",
      }),
    );

    const elements = session.store.getElements("agt_1");
    expect(elements.map((el) => el.id)).toEqual(["a", "b"]);
    expect(elements[0]!.title).toBe("A2");
  });

  it("discards a stale/duplicate revision delta without touching state", () => {
    const session = createPiUiSession({ sendRequest: () => undefined, clock: new FakeClock() });
    ingestPiUiAgentStreamEvent(
      session,
      "agt_1",
      upsertEvent("agt_1", 1, {
        id: "a",
        ns: "todo",
        kind: "widget",
        placement: "pinned",
        title: "A1",
      }),
    );
    // Same revision arriving again (a duplicate delivery) is at-or-below
    // current and must be discarded, not re-applied.
    ingestPiUiAgentStreamEvent(
      session,
      "agt_1",
      upsertEvent("agt_1", 1, {
        id: "a",
        ns: "todo",
        kind: "widget",
        placement: "pinned",
        title: "A2-STALE",
      }),
    );

    expect(session.store.getRevision("agt_1")).toBe(1);
    expect(session.store.getElements("agt_1")[0]!.title).toBe("A1");
  });

  it("requests a resync instead of applying a delta that skips ahead", () => {
    const session = createPiUiSession({ sendRequest: () => undefined, clock: new FakeClock() });
    const resyncs: Array<{ agentId: string; reason: string }> = [];
    session.store.onResyncNeeded((agentId, reason) => resyncs.push({ agentId, reason }));

    ingestPiUiAgentStreamEvent(
      session,
      "agt_1",
      upsertEvent("agt_1", 1, {
        id: "a",
        ns: "todo",
        kind: "widget",
        placement: "pinned",
        title: "A1",
      }),
    );
    // Jumps from revision 1 straight to 3, skipping 2.
    ingestPiUiAgentStreamEvent(
      session,
      "agt_1",
      upsertEvent("agt_1", 3, {
        id: "a",
        ns: "todo",
        kind: "widget",
        placement: "pinned",
        title: "A3-GAP",
      }),
    );

    expect(session.store.getRevision("agt_1")).toBe(1);
    expect(session.store.getElements("agt_1")[0]!.title).toBe("A1");
    expect(resyncs).toEqual([{ agentId: "agt_1", reason: "gap" }]);
  });

  it("treats a remove that precedes any matching upsert as a safe no-op, and a later upsert for that id still succeeds", () => {
    const session = createPiUiSession({ sendRequest: () => undefined, clock: new FakeClock() });

    ingestPiUiAgentStreamEvent(session, "agt_1", removeEvent("agt_1", 1, "a", "todo"));
    expect(session.store.getElements("agt_1")).toEqual([]);

    ingestPiUiAgentStreamEvent(
      session,
      "agt_1",
      upsertEvent("agt_1", 2, {
        id: "a",
        ns: "todo",
        kind: "widget",
        placement: "pinned",
        title: "A1",
      }),
    );
    expect(session.store.getElements("agt_1").map((el) => el.id)).toEqual(["a"]);
  });
});

describe("PiUiSession action controller — success and failure (T34A5)", () => {
  it("resolves success once the routed request's pi_ui_action_result reports ok", async () => {
    const sent: unknown[] = [];
    const session = createPiUiSession({
      sendRequest: (message) => sent.push(message),
      clock: new FakeClock(),
    });

    const settled = session.actionController.dispatch({
      agentId: "agt_1",
      namespace: "todo",
      elementId: "a",
      actionId: "complete",
    });

    expect(
      session.actionController.isPending({
        agentId: "agt_1",
        namespace: "todo",
        elementId: "a",
        actionId: "complete",
      }),
    ).toBe(true);

    const requestId = (sent[0] as { requestId: string }).requestId;
    session.actionController.ingestActionResponse({ requestId, ok: true, error: null });
    ingestPiUiAgentStreamEvent(session, "agt_1", actionResultEvent("a", "complete", true));

    const outcome = await settled;
    expect(outcome.status).toBe("success");
    expect(
      session.actionController.isPending({
        agentId: "agt_1",
        namespace: "todo",
        elementId: "a",
        actionId: "complete",
      }),
    ).toBe(false);
  });

  it("settles rejected with a named error and clears pending when the daemon cannot route the request — never strands the row pending", async () => {
    const sent: unknown[] = [];
    const session = createPiUiSession({
      sendRequest: (message) => sent.push(message),
      clock: new FakeClock(),
    });

    const target = { agentId: "agt_1", namespace: "todo", elementId: "a", actionId: "complete" };
    const settled = session.actionController.dispatch(target);
    const requestId = (sent[0] as { requestId: string }).requestId;

    session.actionController.ingestActionResponse({
      requestId,
      ok: false,
      error: "unknown element",
    });

    const outcome = await settled;
    expect(outcome.status).toBe("rejected");
    expect(outcome.error).toBe("unknown element");
    expect(session.actionController.isPending(target)).toBe(false);
    expect(session.actionController.getActionState(target)).toMatchObject({
      status: "rejected",
      error: "unknown element",
    });
  });

  it("settles rejected when the routed action's async result later reports failure", async () => {
    const sent: unknown[] = [];
    const session = createPiUiSession({
      sendRequest: (message) => sent.push(message),
      clock: new FakeClock(),
    });

    const target = { agentId: "agt_1", namespace: "todo", elementId: "a", actionId: "complete" };
    const settled = session.actionController.dispatch(target);
    const requestId = (sent[0] as { requestId: string }).requestId;

    session.actionController.ingestActionResponse({ requestId, ok: true, error: null });
    ingestPiUiAgentStreamEvent(
      session,
      "agt_1",
      actionResultEvent("a", "complete", false, "extension threw"),
    );

    const outcome = await settled;
    expect(outcome.status).toBe("rejected");
    expect(outcome.error).toBe("extension threw");
    expect(session.actionController.isPending(target)).toBe(false);
  });

  it("reports staleRevision when the store's revision moved between dispatch and settlement", async () => {
    const sent: unknown[] = [];
    const session = createPiUiSession({
      sendRequest: (message) => sent.push(message),
      clock: new FakeClock(),
    });

    ingestPiUiAgentStreamEvent(
      session,
      "agt_1",
      upsertEvent("agt_1", 1, { id: "a", ns: "todo", kind: "widget", placement: "pinned" }),
    );

    const target = { agentId: "agt_1", namespace: "todo", elementId: "a", actionId: "complete" };
    const settled = session.actionController.dispatch(target);
    const requestId = (sent[0] as { requestId: string }).requestId;

    // The store moves on (a new delta) while the action is still in flight.
    ingestPiUiAgentStreamEvent(
      session,
      "agt_1",
      upsertEvent("agt_1", 2, { id: "b", ns: "todo", kind: "widget", placement: "pinned" }),
    );

    session.actionController.ingestActionResponse({ requestId, ok: true, error: null });
    ingestPiUiAgentStreamEvent(session, "agt_1", actionResultEvent("a", "complete", true));

    const outcome = await settled;
    expect(outcome.staleRevision).toBe(true);
  });
});

describe("createExtensionsClock (T34A5)", () => {
  it("implements Clock against the ambient ms-epoch and timer globals", () => {
    const clock = createExtensionsClock();
    expect(typeof clock.now()).toBe("number");
    let fired = false;
    const handle = clock.setTimeout(() => {
      fired = true;
    }, 50);
    clock.clearTimeout(handle);
    expect(fired).toBe(false);
  });
});
