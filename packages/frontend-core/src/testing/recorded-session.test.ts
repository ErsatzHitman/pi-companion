import { describe, expect, it } from "vitest";
import type {
  AgentStreamMessage,
  FetchAgentTimelineResponseMessage,
} from "@picompanion/protocol/messages";
import type { WebSocketFactory, WebSocketLike } from "@picompanion/client";
import type { AgentStreamEvent } from "@picompanion/protocol/agent-types";
import type { PiUiDelta } from "@picompanion/protocol/pi-ui-bridge/schema";
import { DaemonClientLifecycle } from "../connection/daemon-client-lifecycle.js";
import {
  createEmptyTimelineState,
  getVisibleTimelineRows,
  ingestAgentStreamMessage,
  ingestTimelineWindow,
  planGapBackfillRequest,
} from "../timeline/index.js";
import { PiUiElementStore } from "../extensions/state.js";
import { ExtensionActionController } from "../extensions/action-controller.js";
import type { Clock, TimerHandle } from "../platform/clock.js";
import { loadRecordedSessionFixture } from "./fixtures/recorded-session.js";
import type { FixtureFrame, RecordedSessionChapter } from "./fixtures/types.js";

/**
 * The plan.md §13 Phase 2 exit test:
 *
 * > node tests can drive a complete recorded session from hello through
 * > reconnect, gap recovery, extension action, and final correction without
 * > React.
 *
 * Drives the real `frontend-core` modules that own each behavior —
 * `DaemonClientLifecycle` (hello, reconnect), the timeline reducer (gap
 * recovery, final correction), `PiUiElementStore` and
 * `ExtensionActionController` (extension action) — through
 * `loadRecordedSessionFixture()`'s five chapters, in order, as one
 * continuous session. Nothing here imports React, React Native, Expo, or
 * any DOM/browser API; this file runs under plain Node via Vitest.
 */

function chapterByName(chapters: RecordedSessionChapter[], name: string): RecordedSessionChapter {
  const found = chapters.find((chapter) => chapter.chapter === name);
  if (!found) throw new Error(`recorded-session fixture is missing chapter "${name}"`);
  return found;
}

function frameById(frames: FixtureFrame[], id: string): FixtureFrame {
  const frame = frames.find((candidate) => candidate.id === id);
  if (!frame) throw new Error(`recorded-session fixture is missing frame "${id}"`);
  return frame;
}

/** Unwraps one recorded frame's `{type: "session", message: <T>}` envelope. */
function sessionMessage<T>(frame: FixtureFrame): T {
  return (frame.message as { message: T }).message;
}

/** Minimal in-memory `WebSocketLike` double, driven by the test (mirrors
 * `connection/daemon-client-lifecycle.fixture.test.ts`'s FakeWebSocket). */
class FakeWebSocket implements WebSocketLike {
  readyState = 0;
  binaryType?: string;
  sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(event: string, listener: (event: unknown) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  removeEventListener(event: string, listener: (event: unknown) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  send(data: string | Uint8Array | ArrayBuffer): void {
    if (typeof data !== "string") {
      throw new Error("FakeWebSocket only expects text frames in this fixture");
    }
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", { code: 1000, reason: "test close" });
  }

  open(): void {
    this.readyState = 1;
    this.emit("open");
  }

  receiveJson(message: unknown): void {
    this.emit("message", JSON.stringify(message));
  }

  private emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? new Set()) {
      listener(payload);
    }
  }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/** Deterministic, manually-advanced `Clock` (no real timers). */
class FakeClock implements Clock {
  private time = 0;
  private nextId = 1;
  now(): number {
    return this.time;
  }
  setTimeout(): TimerHandle {
    return this.nextId++ as unknown as TimerHandle;
  }
  clearTimeout(): void {}
  setInterval(): TimerHandle {
    return this.nextId++ as unknown as TimerHandle;
  }
  clearInterval(): void {}
}

describe("recorded session (plan.md §13 Phase 2 exit)", () => {
  it("drives hello, reconnect, gap recovery, an extension action, and a final correction in one continuous session", async () => {
    const chapters = loadRecordedSessionFixture();
    expect(chapters.map((chapter) => chapter.chapter)).toEqual([
      "hello",
      "reconnect",
      "gapRecovery",
      "extensionAction",
      "correction",
    ]);

    // --- Chapter 1: hello -------------------------------------------------
    const sockets: FakeWebSocket[] = [];
    const webSocketFactory: WebSocketFactory = (_url) => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket;
    };
    const lifecycle = new DaemonClientLifecycle({
      url: "ws://fixture.invalid/ws",
      clientId: "clid_fixture_recorded_session_0001",
      clientType: "browser",
      appVersion: "0.1.0-fixture",
      webSocketFactory,
      connectTimeoutMs: 5_000,
    });

    const helloChapter = chapterByName(chapters, "hello");
    let connectPromise = lifecycle.connect();
    await flushMicrotasks();
    let socket = sockets[0];
    if (!socket) throw new Error("expected a socket for the hello chapter");
    expect(socket.sent).toHaveLength(1);
    const sentHello = JSON.parse(socket.sent[0] ?? "{}") as {
      type: string;
      clientId: string;
      capabilities: Record<string, boolean>;
    };
    const fixtureHello = frameById(helloChapter.frames, "hello-1").message as {
      clientId: string;
      capabilities: Record<string, boolean>;
    };
    expect(sentHello.type).toBe("hello");
    expect(sentHello.clientId).toBe(fixtureHello.clientId);
    for (const [capabilityId, expected] of Object.entries(fixtureHello.capabilities)) {
      expect(sentHello.capabilities[capabilityId]).toBe(expected);
    }

    socket.receiveJson(frameById(helloChapter.frames, "server-info-1").message);
    await connectPromise;
    expect(lifecycle.getStatus()).toBe("connected");
    let gates = lifecycle.getFeatureGates();
    expect(gates.negotiated).toBe(true);
    expect(gates.serverId).toBe("srv_fixture_recorded_session_0001");
    expect(lifecycle.isFeatureEnabled("piUiBridge")).toBe(true);

    // --- Chapter 2: reconnect ----------------------------------------------
    const reconnectChapter = chapterByName(chapters, "reconnect");
    await lifecycle.disconnect();
    expect(lifecycle.getStatus()).toBe("disconnected");

    connectPromise = lifecycle.connect();
    await flushMicrotasks();
    socket = sockets[1];
    if (!socket) throw new Error("expected a second socket for the reconnect chapter");
    const resumedSentHello = JSON.parse(socket.sent[0] ?? "{}") as {
      clientId: string;
    };
    const fixtureResumedHello = frameById(reconnectChapter.frames, "hello-resumed-1").message as {
      clientId: string;
    };
    expect(resumedSentHello.clientId).toBe(fixtureResumedHello.clientId);
    expect(resumedSentHello.clientId).toBe(fixtureHello.clientId); // same clientId: a resumed hello, not a new session

    socket.receiveJson(frameById(reconnectChapter.frames, "server-info-resumed-1").message);
    await connectPromise;
    expect(lifecycle.getStatus()).toBe("connected");
    gates = lifecycle.getFeatureGates();
    expect(gates.negotiated).toBe(true);
    expect(lifecycle.isFeatureEnabled("workspaceMultiplicity")).toBe(true);

    await lifecycle.dispose();

    // --- Chapter 3: gap recovery --------------------------------------------
    const gapChapter = chapterByName(chapters, "gapRecovery");
    let timelineState = createEmptyTimelineState();
    const liveSeq10 = sessionMessage<AgentStreamMessage>(
      frameById(gapChapter.frames, "live-seq-10"),
    );
    const liveSeq20 = sessionMessage<AgentStreamMessage>(
      frameById(gapChapter.frames, "live-seq-20"),
    );
    timelineState = ingestAgentStreamMessage(timelineState, liveSeq10);
    timelineState = ingestAgentStreamMessage(timelineState, liveSeq20);
    expect(timelineState.gap).not.toBeNull();

    let backfillRequest = planGapBackfillRequest(timelineState, {
      agentId: "agt_fixture_t20b_0001",
      requestId: "req_recorded_session_gap_0001",
    });
    expect(backfillRequest).not.toBeNull();
    const page1 = sessionMessage<FetchAgentTimelineResponseMessage>(
      frameById(gapChapter.frames, "gap-backfill-page-1"),
    );
    timelineState = ingestTimelineWindow(timelineState, page1);
    expect(timelineState.gap).not.toBeNull(); // first page narrows the gap but does not close it

    backfillRequest = planGapBackfillRequest(timelineState, {
      agentId: "agt_fixture_t20b_0001",
      requestId: "req_recorded_session_gap_0002",
    });
    expect(backfillRequest).not.toBeNull();
    const page2 = sessionMessage<FetchAgentTimelineResponseMessage>(
      frameById(gapChapter.frames, "gap-backfill-page-2"),
    );
    timelineState = ingestTimelineWindow(timelineState, page2);
    expect(timelineState.gap).toBeNull(); // gap fully closed after the second page
    expect(getVisibleTimelineRows(timelineState).map((row) => row.seqStart)).toEqual([
      10, 11, 15, 20,
    ]);

    // --- Chapter 4: extension action -----------------------------------------
    const extensionChapter = chapterByName(chapters, "extensionAction");
    const composerDeltaEnvelope = sessionMessage<{
      payload: { agentId: string; event: Extract<AgentStreamEvent, { type: "pi_ui_delta" }> };
    }>(frameById(extensionChapter.frames, "composer-delta-1"));
    const { agentId } = composerDeltaEnvelope.payload;
    const { revision, delta } = composerDeltaEnvelope.payload.event;

    const elementStore = new PiUiElementStore();
    const applyOutcome = elementStore.ingestDelta(agentId, revision, delta as PiUiDelta);
    expect(applyOutcome.action).toBe("applied");
    expect(
      elementStore.getElement(agentId, "prompt-arbitrage", "arbitrage-suggestion"),
    ).toBeDefined();

    const sentActionRequests: unknown[] = [];
    const actionController = new ExtensionActionController({
      clock: new FakeClock(),
      sendRequest: (message) => sentActionRequests.push(message),
      getElementRevision: elementStore.getRevision.bind(elementStore),
    });

    const fixtureActionRequest = sessionMessage<{
      agentId: string;
      actionId: string;
      elementId: string;
      payload: Record<string, unknown>;
      requestId: string;
    }>(frameById(extensionChapter.frames, "action-request-1"));

    const dispatchPromise = actionController.dispatch({
      agentId: fixtureActionRequest.agentId,
      namespace: "prompt-arbitrage",
      elementId: fixtureActionRequest.elementId,
      actionId: fixtureActionRequest.actionId,
      payload: fixtureActionRequest.payload,
      requestId: fixtureActionRequest.requestId,
    });
    expect(sentActionRequests).toEqual([
      {
        type: "pi.ui.action.request",
        agentId: fixtureActionRequest.agentId,
        actionId: fixtureActionRequest.actionId,
        elementId: fixtureActionRequest.elementId,
        payload: fixtureActionRequest.payload,
        requestId: fixtureActionRequest.requestId,
      },
    ]);

    const actionResponse = sessionMessage<{
      payload: { requestId: string; ok: boolean; error: string | null };
    }>(frameById(extensionChapter.frames, "action-response-1"));
    actionController.ingestActionResponse(actionResponse.payload);

    const actionResultEnvelope = sessionMessage<{
      payload: { agentId: string; event: AgentStreamEvent };
    }>(frameById(extensionChapter.frames, "action-result-1"));
    actionController.ingestAgentStreamEvent(
      actionResultEnvelope.payload.agentId,
      actionResultEnvelope.payload.event,
    );

    const settled = await dispatchPromise;
    expect(settled.status).toBe("success");
    expect(settled.source).toBe("result");

    // --- Chapter 5: final correction -----------------------------------------
    const correctionChapter = chapterByName(chapters, "correction");
    let correctionTimelineState = createEmptyTimelineState();
    for (const id of ["assistant-delta-1", "assistant-delta-1-resend", "assistant-correction-1"]) {
      const message = sessionMessage<AgentStreamMessage>(frameById(correctionChapter.frames, id));
      correctionTimelineState = ingestAgentStreamMessage(correctionTimelineState, message);
    }
    const finalRows = getVisibleTimelineRows(correctionTimelineState);
    expect(finalRows).toHaveLength(1); // the resend deduped and the correction replaced in place
    const finalItem = finalRows[0]!.item as { type: string; text: string; messageId: string };
    expect(finalItem.messageId).toBe("msg_t20a_0002");
    expect(finalItem.text).toBe("Final answer for /synthetic/workspace/demo-repo/README.md.");
  });
});
