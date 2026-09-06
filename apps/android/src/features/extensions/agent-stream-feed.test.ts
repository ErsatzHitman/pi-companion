import { describe, expect, it, vi } from "vitest";

import type { AgentStreamEventPayload } from "@picompanion/protocol/messages";
import type { Clock, TimerHandle } from "@picompanion/frontend-core";

/**
 * T34A6 — proves the one thing `pi-ui-session.test.ts` (T34A5) does not:
 * that a live `agent_stream` delta, fed through the exact wire-message
 * shape `@picompanion/client`'s `DaemonClient.on("agent_stream", ...)`
 * delivers (`{ payload: { agentId, event } }`), both reaches
 * `PiUiSession.store` *and* would actually render — not merely sit in the
 * store unread. T34A5's own suite proves store mechanics (ordering,
 * gap/resync, action settlement) directly against `AgentStreamEvent`
 * objects and `ingestPiUiAgentStreamEvent`; this file starts one layer
 * further out, at `ingestPiUiAgentStreamMessage` (`registry-index.ts`,
 * T34A6), and carries one delta all the way through
 * `resolvePiUiElementRenderDecision` (`registry-plan.ts`, T34A1) and
 * `selectPinnedElements`/`resolvePinnedAreaVisibility` (`pinned-model.ts`,
 * T34A4) — the exact pure decisions `PinnedLiveExtensionArea` renders
 * from — to prove the fed element clears every gate between "in the
 * store" and "on screen" (real painting remains for T37/T59, per this
 * directory's standing disclosure; nothing here touches React Native).
 *
 * The scripted messages below are plain objects shaped like
 * `DaemonClient`'s real `agent_stream` payload — never a live
 * `DaemonClient`, never a socket. See `registry-index.ts`'s
 * `ingestPiUiAgentStreamMessage` doc comment for the router call site
 * that turns this into a live feed: T32S8 (P5-W12) made it in
 * `app-shell/core.ts`, and one subscription there now feeds both this
 * store and the transcript batcher. The one gap this file still cannot
 * close from `features/extensions/` alone is the outbound half — no
 * `pi.ui.action.request` sender exists in `@picompanion/client`.
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

const { createPiUiSession, ingestPiUiAgentStreamMessage, piUiRendererRegistry } =
  await import("./registry-index");
const { resolvePiUiElementRenderDecision } = await import("./registry-plan");
const { DiffRenderer } = await import("./renderers/diff");
const { PanelRenderer } = await import("./renderers/panel");
const { selectPinnedElements, resolvePinnedAreaVisibility } = await import("./pinned-model");

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

/** One scripted `agent_stream` wire message, shaped exactly like `DaemonClient.on("agent_stream", handler)`'s `message.payload`. */
function streamMessage(
  agentId: string,
  event: Record<string, unknown>,
): { agentId: string; event: AgentStreamEventPayload } {
  return { agentId, event: event as unknown as AgentStreamEventPayload };
}

describe("ingestPiUiAgentStreamMessage — a scripted fake agent_stream reaches the store and would render (T34A6)", () => {
  it("moves the store and clears every render gate for a pinned widget upsert", () => {
    const session = createPiUiSession({ sendRequest: () => undefined, clock: new FakeClock() });

    // A scripted fake stream: two wire-shaped messages, never a socket.
    const scriptedStream = [
      streamMessage("agt_1", {
        type: "pi_ui_delta",
        provider: "pi",
        agentId: "agt_1",
        revision: 1,
        delta: {
          op: "upsert",
          element: {
            id: "todo-summary",
            ns: "todo",
            kind: "widget",
            placement: "pinned",
            title: "Today's plan",
            payload: { kind: "widget", text: "3 tasks remaining" },
          },
        },
      }),
    ];

    for (const message of scriptedStream) {
      ingestPiUiAgentStreamMessage(session, message);
    }

    // 1. Reached the store.
    const elements = session.store.getElements("agt_1");
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ id: "todo-summary", kind: "widget" });
    expect(session.store.getRevision("agt_1")).toBe(1);

    // 2. Clears the pinned-area visibility gate (`pinned-model.ts`, T34A4).
    expect(resolvePinnedAreaVisibility(elements)).toBe("visible");
    const pinned = selectPinnedElements(elements);
    expect(pinned.map((el) => el.id)).toEqual(["todo-summary"]);

    // 3. Clears the per-element render decision gate (`registry-plan.ts`,
    // T34A1) as "ok", not a diagnostic — the registered `widget` renderer
    // and its validated payload, exactly what `PiUiElementView` would hand
    // to a real renderer on screen.
    const decision = resolvePiUiElementRenderDecision(pinned[0]!, piUiRendererRegistry);
    expect(decision.status).toBe("ok");
    if (decision.status === "ok") {
      expect(decision.payload).toEqual({ kind: "widget", text: "3 tasks remaining" });
    }
  });

  // P5-W12 merge gate: the same end-to-end path for `kind: "diff"`.
  // T34B3 registered `DiffRenderer` (`./renderers/index.ts`) and proved its
  // model in isolation (`./renderers/diff-model.test.ts`), but until this
  // test no element of that kind had ever travelled the full route — a
  // scripted `agent_stream` message, into the store, past the pinned-area
  // and render-decision gates, out as the registered `diff` renderer with a
  // validated payload. Registration alone (`registry-index.test.ts` asserts
  // `has("diff")`) does not prove a real element resolves to it.
  it("carries a diff element the whole way, so the registered DiffRenderer is what a real message resolves to", () => {
    const session = createPiUiSession({ sendRequest: () => undefined, clock: new FakeClock() });
    const unifiedDiff = "--- a/notes.ts\n+++ b/notes.ts\n@@ -1 +1 @@\n-old line\n+new line\n";

    ingestPiUiAgentStreamMessage(
      session,
      streamMessage("agt_1", {
        type: "pi_ui_delta",
        provider: "pi",
        agentId: "agt_1",
        revision: 1,
        delta: {
          op: "upsert",
          element: {
            id: "edit-preview",
            ns: "edit",
            kind: "diff",
            placement: "pinned",
            title: "notes.ts",
            payload: { kind: "diff", unifiedDiff, filePath: "notes.ts" },
          },
        },
      }),
    );

    const elements = session.store.getElements("agt_1");
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ id: "edit-preview", kind: "diff" });

    expect(resolvePinnedAreaVisibility(elements)).toBe("visible");
    const pinned = selectPinnedElements(elements);
    expect(pinned.map((el) => el.id)).toEqual(["edit-preview"]);

    const decision = resolvePiUiElementRenderDecision(pinned[0]!, piUiRendererRegistry);
    expect(decision.status).toBe("ok");
    if (decision.status === "ok") {
      // The validated payload `PiUiElementView` would hand a real renderer...
      expect(decision.payload).toMatchObject({ kind: "diff", unifiedDiff });
      // ...and the renderer it resolves to is T34B3's registered DiffRenderer
      // itself, not merely "some function is registered for this kind".
      expect(piUiRendererRegistry.get("diff")).toBe(DiffRenderer);
    }
  });

  // T34B4 (P5-W13): the same end-to-end path for `kind: "panel"`, the last
  // link in the T34 chain — including a panel carrying nested children, so
  // this proves not just that the panel itself resolves to the registered
  // `PanelRenderer`, but that its own sections' kinds (here `status` and
  // `widget`) are the real leaf payloads a section-level render would
  // resolve to as well, via `panel-model.ts`'s `resolvePanelChildDecision`.
  it("carries a panel element — with nested sections — the whole way, so the registered PanelRenderer and each section's own kind are what a real message resolves to", async () => {
    const session = createPiUiSession({ sendRequest: () => undefined, clock: new FakeClock() });
    const { resolvePanelChildDecision } = await import("./renderers/panel-model");

    ingestPiUiAgentStreamMessage(
      session,
      streamMessage("agt_1", {
        type: "pi_ui_delta",
        provider: "pi",
        agentId: "agt_1",
        revision: 1,
        delta: {
          op: "upsert",
          element: {
            id: "run-4",
            ns: "loop",
            kind: "panel",
            placement: "sheet",
            title: "Loop run #4",
            payload: {
              kind: "panel",
              text: "Deploy workflow, step 3 of 5.",
              sections: [
                {
                  id: "head",
                  kind: "status",
                  payload: { kind: "status", text: "Running step 3 of 5" },
                },
                {
                  id: "notes",
                  kind: "widget",
                  payload: { kind: "widget", text: "3 subtasks remaining" },
                },
              ],
            },
          },
        },
      }),
    );

    const elements = session.store.getElements("agt_1");
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ id: "run-4", kind: "panel" });

    // The panel itself resolves to "ok" with the registered PanelRenderer —
    // exactly what `PiUiElementView` would hand a real render, not merely
    // "some function is registered for this kind".
    const decision = resolvePiUiElementRenderDecision(elements[0]!, piUiRendererRegistry);
    expect(decision.status).toBe("ok");
    expect(piUiRendererRegistry.get("panel")).toBe(PanelRenderer);
    if (decision.status !== "ok") return;
    expect(decision.payload.kind).toBe("panel");
    const panelPayload = decision.payload as { sections: unknown[] };
    expect(panelPayload.sections).toHaveLength(2);

    // Each nested section resolves to its own registered leaf renderer, not
    // a diagnostic — proving the panel's own children, not only the panel
    // envelope, travel the same store -> decision route a real render would.
    const sectionDecisions = (
      panelPayload.sections as { id: string; kind: string; payload?: unknown }[]
    ).map((section) =>
      resolvePanelChildDecision(
        { id: "run-4", ns: "loop" },
        section as never,
        piUiRendererRegistry,
      ),
    );
    expect(sectionDecisions.map((d) => d.status)).toEqual(["ok", "ok"]);
    expect(sectionDecisions.map((d) => d.kind)).toEqual(["status", "widget"]);
    if (sectionDecisions[0]!.status === "ok") {
      expect(sectionDecisions[0]!.Renderer).toBe(piUiRendererRegistry.get("status"));
    }
    if (sectionDecisions[1]!.status === "ok") {
      expect(sectionDecisions[1]!.Renderer).toBe(piUiRendererRegistry.get("widget"));
    }
  });

  it("ignores a message for a different agent — the pinned area for the watched agent stays collapsed", () => {
    const session = createPiUiSession({ sendRequest: () => undefined, clock: new FakeClock() });

    ingestPiUiAgentStreamMessage(
      session,
      streamMessage("agt_other", {
        type: "pi_ui_delta",
        provider: "pi",
        agentId: "agt_other",
        revision: 1,
        delta: {
          op: "upsert",
          element: {
            id: "x",
            ns: "todo",
            kind: "widget",
            placement: "pinned",
            payload: { kind: "widget", text: "irrelevant" },
          },
        },
      }),
    );

    const watchedElements = session.store.getElements("agt_1");
    expect(watchedElements).toEqual([]);
    expect(resolvePinnedAreaVisibility(watchedElements)).toBe("collapsed");
  });

  it("removes a pinned element on a scripted remove delta, collapsing the area again", () => {
    const session = createPiUiSession({ sendRequest: () => undefined, clock: new FakeClock() });

    ingestPiUiAgentStreamMessage(
      session,
      streamMessage("agt_1", {
        type: "pi_ui_delta",
        provider: "pi",
        agentId: "agt_1",
        revision: 1,
        delta: {
          op: "upsert",
          element: {
            id: "todo-summary",
            ns: "todo",
            kind: "widget",
            placement: "pinned",
            payload: { kind: "widget", text: "3 tasks remaining" },
          },
        },
      }),
    );
    expect(resolvePinnedAreaVisibility(session.store.getElements("agt_1"))).toBe("visible");

    ingestPiUiAgentStreamMessage(
      session,
      streamMessage("agt_1", {
        type: "pi_ui_delta",
        provider: "pi",
        agentId: "agt_1",
        revision: 2,
        delta: { op: "remove", id: "todo-summary", ns: "todo" },
      }),
    );

    const elements = session.store.getElements("agt_1");
    expect(elements).toEqual([]);
    expect(resolvePinnedAreaVisibility(elements)).toBe("collapsed");
  });

  it("also forwards through the action-controller half: an action-result message settles a pending dispatch", async () => {
    const sent: unknown[] = [];
    const session = createPiUiSession({
      sendRequest: (message) => sent.push(message),
      clock: new FakeClock(),
    });

    const target = { agentId: "agt_1", namespace: "todo", elementId: "a", actionId: "complete" };
    const settled = session.actionController.dispatch(target);
    const requestId = (sent[0] as { requestId: string }).requestId;
    session.actionController.ingestActionResponse({ requestId, ok: true, error: null });

    ingestPiUiAgentStreamMessage(
      session,
      streamMessage("agt_1", {
        type: "pi_ui_action_result",
        provider: "pi",
        result: { elementId: "a", actionId: "complete", ok: true },
      }),
    );

    const outcome = await settled;
    expect(outcome.status).toBe("success");
    expect(session.actionController.isPending(target)).toBe(false);
  });
});
