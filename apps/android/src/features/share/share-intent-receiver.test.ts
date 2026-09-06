import { composer as coreComposer } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

import {
  createInMemoryStructuredStorage,
  createSystemClock,
} from "../composer/in-memory-outbox-runtime";
import type { RawShareIntent } from "./share-intent-model";
import type { ShareIntentPort } from "./share-intent-port";
import { createShareIntentReceiver, type ShareIntentReceiverEvent } from "./share-intent-receiver";

function makeDraftDeps() {
  const storage = createInMemoryStructuredStorage();
  const clock = createSystemClock();
  return {
    draftStore: new coreComposer.DraftStore(storage, clock),
    outbox: new coreComposer.OutboxController(storage, clock),
  };
}

/** A scripted fake `ShareIntentPort` — a fixed initial intent, plus a way to fire more from the test. */
function makeFakePort(initial: RawShareIntent | null): {
  port: ShareIntentPort;
  fire: (intent: RawShareIntent) => void;
  subscriberCount: () => number;
} {
  const handlers = new Set<(intent: RawShareIntent) => void>();
  return {
    port: {
      async getInitialShareIntent() {
        return initial;
      },
      subscribe(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    },
    fire(intent) {
      for (const handler of handlers) handler(intent);
    },
    subscriberCount: () => handlers.size,
  };
}

const TEXT_INTENT: RawShareIntent = { action: "SEND", mimeType: "text/plain", text: "hello" };
const URL_INTENT: RawShareIntent = {
  action: "SEND",
  mimeType: "text/plain",
  text: "https://example.com/a",
};
const BAD_TYPE_INTENT: RawShareIntent = { action: "SEND", mimeType: "application/zip" };

describe("createShareIntentReceiver — cold start (intent that launched the app)", () => {
  it("reads the initial intent exactly once, end to end into an opened chooser", async () => {
    const { port } = makeFakePort(TEXT_INTENT);
    const events: ShareIntentReceiverEvent[] = [];
    const receiver = createShareIntentReceiver({
      port,
      getCandidateSessionIds: () => ["s1", "s2"],
      draftDeps: makeDraftDeps(),
      onEvent: (e) => events.push(e),
    });

    await receiver.start();

    expect(events).toEqual([
      {
        type: "presented",
        outcome: "opened",
        state: {
          status: "choosing",
          content: { kind: "text", text: "hello", looksSecretShaped: false },
          candidateSessionIds: ["s1", "s2"],
        },
      },
    ]);
    expect(receiver.getState().status).toBe("choosing");
  });

  it("a named refusal when the launch intent fails the allowlist — never silently dropped", async () => {
    const { port } = makeFakePort(BAD_TYPE_INTENT);
    const events: ShareIntentReceiverEvent[] = [];
    const receiver = createShareIntentReceiver({
      port,
      getCandidateSessionIds: () => ["s1"],
      draftDeps: makeDraftDeps(),
      onEvent: (e) => events.push(e),
    });

    await receiver.start();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "refused", refusal: { reason: "unsupported-type" } });
    expect(receiver.getState().status).toBe("idle"); // no chooser opened for a refusal
  });

  it("no launch intent -> no event, idle state", async () => {
    const { port } = makeFakePort(null);
    const events: ShareIntentReceiverEvent[] = [];
    const receiver = createShareIntentReceiver({
      port,
      getCandidateSessionIds: () => ["s1"],
      draftDeps: makeDraftDeps(),
      onEvent: (e) => events.push(e),
    });

    await receiver.start();
    expect(events).toEqual([]);
    expect(receiver.getState()).toEqual({ status: "idle" });
  });

  it("subscribes before reading the initial intent, so nothing delivered in the gap is missed", async () => {
    const { port, subscriberCount } = makeFakePort(TEXT_INTENT);
    let subscribedBeforeInitialResolved = false;
    const wrappedPort: ShareIntentPort = {
      subscribe: port.subscribe,
      async getInitialShareIntent() {
        subscribedBeforeInitialResolved = subscriberCount() === 1;
        return port.getInitialShareIntent();
      },
    };
    const receiver = createShareIntentReceiver({
      port: wrappedPort,
      getCandidateSessionIds: () => ["s1"],
      draftDeps: makeDraftDeps(),
      onEvent: () => {},
    });
    await receiver.start();
    expect(subscribedBeforeInitialResolved).toBe(true);
  });

  it("start() is idempotent — a second call does not re-subscribe or re-read", async () => {
    const { port, subscriberCount } = makeFakePort(null);
    const receiver = createShareIntentReceiver({
      port,
      getCandidateSessionIds: () => ["s1"],
      draftDeps: makeDraftDeps(),
      onEvent: () => {},
    });
    await receiver.start();
    await receiver.start();
    expect(subscriberCount()).toBe(1);
  });
});

describe("createShareIntentReceiver — mid-session (intent arriving while already running)", () => {
  it("a share fired via subscribe reaches classifyShareIntent and opens the chooser", async () => {
    const { port, fire } = makeFakePort(null);
    const events: ShareIntentReceiverEvent[] = [];
    const receiver = createShareIntentReceiver({
      port,
      getCandidateSessionIds: () => ["s1"],
      draftDeps: makeDraftDeps(),
      onEvent: (e) => events.push(e),
    });
    await receiver.start();
    fire(URL_INTENT);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "presented",
      outcome: "opened",
      state: { status: "choosing", content: { kind: "url", url: "https://example.com/a" } },
    });
  });

  it("stop() unsubscribes — a share fired afterward reaches nothing", async () => {
    const { port, fire, subscriberCount } = makeFakePort(null);
    const events: ShareIntentReceiverEvent[] = [];
    const receiver = createShareIntentReceiver({
      port,
      getCandidateSessionIds: () => ["s1"],
      draftDeps: makeDraftDeps(),
      onEvent: (e) => events.push(e),
    });
    await receiver.start();
    receiver.stop();
    expect(subscriberCount()).toBe(0);
    fire(TEXT_INTENT);
    expect(events).toEqual([]);
  });
});

describe("createShareIntentReceiver — a second intent arriving before the first is resolved", () => {
  it("queues the second share behind the open chooser rather than dropping or displacing it", async () => {
    const { port, fire } = makeFakePort(null);
    const events: ShareIntentReceiverEvent[] = [];
    const receiver = createShareIntentReceiver({
      port,
      getCandidateSessionIds: () => ["s1", "s2"],
      draftDeps: makeDraftDeps(),
      onEvent: (e) => events.push(e),
    });
    await receiver.start();

    fire(TEXT_INTENT); // opens the chooser
    fire(URL_INTENT); // arrives while the first is still unresolved

    expect(events.map((e) => (e as { outcome?: string }).outcome)).toEqual(["opened", "queued"]);
    const state = receiver.getState();
    expect(state.status).toBe("choosing");
    if (state.status === "choosing") {
      expect(state.content).toEqual({ kind: "text", text: "hello", looksSecretShaped: false });
      expect(state.queuedNext).toEqual({ kind: "url", url: "https://example.com/a" });
    }
  });

  it("resolving the first re-presents the queued second — nothing is lost", async () => {
    const { port, fire } = makeFakePort(null);
    const events: ShareIntentReceiverEvent[] = [];
    const draftDeps = makeDraftDeps();
    const receiver = createShareIntentReceiver({
      port,
      getCandidateSessionIds: () => ["s1", "s2"],
      draftDeps,
      onEvent: (e) => events.push(e),
    });
    await receiver.start();
    fire(TEXT_INTENT);
    fire(URL_INTENT);
    events.length = 0;

    await receiver.resolveChoice("s1");

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "resolved", sessionId: "s1" });
    expect(events[1]).toMatchObject({ type: "presented", outcome: "opened" });

    const draft = await draftDeps.draftStore.load("s1");
    expect(draft?.text).toBe("hello");

    const state = receiver.getState();
    expect(state.status).toBe("choosing");
    if (state.status === "choosing") {
      expect(state.content).toEqual({ kind: "url", url: "https://example.com/a" });
    }
  });
});

describe("createShareIntentReceiver — resolving and dismissing", () => {
  it("resolveChoice with a valid session materializes a draft and reports it", async () => {
    const { port } = makeFakePort(TEXT_INTENT);
    const events: ShareIntentReceiverEvent[] = [];
    const draftDeps = makeDraftDeps();
    const receiver = createShareIntentReceiver({
      port,
      getCandidateSessionIds: () => ["s1"],
      draftDeps,
      onEvent: (e) => events.push(e),
    });
    await receiver.start();
    events.length = 0;

    await receiver.resolveChoice("s1");

    expect(events).toEqual([
      { type: "resolved", sessionId: "s1", draft: { outcome: "drafted", sessionId: "s1" } },
    ]);
    expect(receiver.getState()).toEqual({
      status: "resolved",
      content: { kind: "text", text: "hello", looksSecretShaped: false },
      sessionId: "s1",
    });
  });

  it("resolveChoice with a session no longer valid reports invalid-session and writes nothing", async () => {
    const { port } = makeFakePort(TEXT_INTENT);
    const events: ShareIntentReceiverEvent[] = [];
    const draftDeps = makeDraftDeps();
    let candidateSessionIds: readonly string[] = ["gone"]; // present when the chooser opens
    const receiver = createShareIntentReceiver({
      port,
      getCandidateSessionIds: () => candidateSessionIds,
      draftDeps,
      onEvent: (e) => events.push(e),
    });
    await receiver.start();
    events.length = 0;
    candidateSessionIds = []; // ...gone by the time the user resolves the chooser

    await receiver.resolveChoice("gone");

    expect(events).toEqual([{ type: "invalid-session", sessionId: "gone" }]);
    const draft = await draftDeps.draftStore.load("gone");
    expect(draft).toBeNull();
  });

  it("resolveChoice with no chooser open is a no-op", async () => {
    const { port } = makeFakePort(null);
    const events: ShareIntentReceiverEvent[] = [];
    const receiver = createShareIntentReceiver({
      port,
      getCandidateSessionIds: () => ["s1"],
      draftDeps: makeDraftDeps(),
      onEvent: (e) => events.push(e),
    });
    await receiver.start();
    await receiver.resolveChoice("s1");
    expect(events).toEqual([]);
  });

  it("dismiss cancels the open chooser without writing a draft", async () => {
    const { port } = makeFakePort(TEXT_INTENT);
    const events: ShareIntentReceiverEvent[] = [];
    const draftDeps = makeDraftDeps();
    const receiver = createShareIntentReceiver({
      port,
      getCandidateSessionIds: () => ["s1"],
      draftDeps,
      onEvent: (e) => events.push(e),
    });
    await receiver.start();
    events.length = 0;

    receiver.dismiss();

    expect(events).toEqual([{ type: "cancelled" }]);
    expect(receiver.getState()).toEqual({
      status: "cancelled",
      content: { kind: "text", text: "hello", looksSecretShaped: false },
    });
    const draft = await draftDeps.draftStore.load("s1");
    expect(draft).toBeNull();
  });

  it("no candidate sessions -> no-sessions, and the share is still observable, not dropped", async () => {
    const { port } = makeFakePort(TEXT_INTENT);
    const events: ShareIntentReceiverEvent[] = [];
    const receiver = createShareIntentReceiver({
      port,
      getCandidateSessionIds: () => [],
      draftDeps: makeDraftDeps(),
      onEvent: (e) => events.push(e),
    });
    await receiver.start();

    expect(events).toEqual([
      {
        type: "presented",
        outcome: "no-sessions",
        state: {
          status: "no-sessions",
          content: { kind: "text", text: "hello", looksSecretShaped: false },
        },
      },
    ]);
  });
});
