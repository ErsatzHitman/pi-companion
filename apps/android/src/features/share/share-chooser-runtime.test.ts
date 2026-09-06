import { composer as coreComposer } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

import {
  createInMemoryStructuredStorage,
  createSystemClock,
} from "../composer/in-memory-outbox-runtime";
import type { RawShareIntent } from "./share-intent-model";
import type { ShareIntentPort } from "./share-intent-port";
import { createShareChooserRuntime } from "./share-chooser-runtime";

/** Same fixture shape `share-intent-receiver.test.ts` already uses. */
function makeDraftDeps() {
  const storage = createInMemoryStructuredStorage();
  const clock = createSystemClock();
  return {
    draftStore: new coreComposer.DraftStore(storage, clock),
    outbox: new coreComposer.OutboxController(storage, clock),
  };
}

function makeFakePort(initial: RawShareIntent | null): {
  port: ShareIntentPort;
  fire: (intent: RawShareIntent) => void;
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
  };
}

const TEXT_INTENT: RawShareIntent = { action: "SEND", mimeType: "text/plain", text: "hello" };

describe("createShareChooserRuntime — candidate session ids", () => {
  it("presents no-sessions when nothing has been set, then opens once ids are pushed in before start()", async () => {
    const { port } = makeFakePort(TEXT_INTENT);
    const runtime = createShareChooserRuntime({ port, draftDeps: makeDraftDeps() });

    runtime.setCandidateSessionIds(["s1", "s2"]);
    await runtime.start();

    const state = runtime.getState();
    expect(state.status).toBe("choosing");
    if (state.status === "choosing") {
      expect(state.candidateSessionIds).toEqual(["s1", "s2"]);
    }
  });

  it("without any setCandidateSessionIds call, an incoming share lands in the named no-sessions state", async () => {
    const { port } = makeFakePort(TEXT_INTENT);
    const runtime = createShareChooserRuntime({ port, draftDeps: makeDraftDeps() });

    await runtime.start();

    expect(runtime.getState()).toEqual({
      status: "no-sessions",
      content: { kind: "text", text: "hello", looksSecretShaped: false },
    });
  });

  it("a later setCandidateSessionIds call does not retroactively rewrite a chooser already open", async () => {
    const { port, fire } = makeFakePort(null);
    const runtime = createShareChooserRuntime({ port, draftDeps: makeDraftDeps() });
    runtime.setCandidateSessionIds(["s1"]);
    await runtime.start();

    fire(TEXT_INTENT);
    expect(runtime.getState().status).toBe("choosing");

    // Changing the live set now must not mutate the already-open chooser's
    // own candidateSessionIds snapshot — only the *next* presentation or
    // resolution sees it (see this module's setCandidateSessionIds doc).
    runtime.setCandidateSessionIds(["s2"]);
    const state = runtime.getState();
    if (state.status === "choosing") {
      expect(state.candidateSessionIds).toEqual(["s1"]);
    } else {
      throw new Error("expected still choosing");
    }
  });

  it("resolveChoice re-validates against the freshest candidate set, not the one the chooser opened with", async () => {
    const { port, fire } = makeFakePort(null);
    const runtime = createShareChooserRuntime({ port, draftDeps: makeDraftDeps() });
    runtime.setCandidateSessionIds(["s1"]);
    await runtime.start();
    fire(TEXT_INTENT);

    // s1 is removed (e.g. archived) before the user taps it.
    runtime.setCandidateSessionIds(["s2"]);
    await runtime.resolveChoice("s1");

    expect(runtime.getState()).toMatchObject({ status: "invalid-session", sessionId: "s1" });
  });
});

describe("createShareChooserRuntime — subscribe", () => {
  it("notifies every listener with the new snapshot on each event, and stops after unsubscribe", async () => {
    const { port, fire } = makeFakePort(null);
    const runtime = createShareChooserRuntime({ port, draftDeps: makeDraftDeps() });
    runtime.setCandidateSessionIds(["s1"]);
    await runtime.start();

    const seen: string[] = [];
    const unsubscribe = runtime.subscribe((snapshot) => seen.push(snapshot.state.status));

    fire(TEXT_INTENT);
    expect(seen).toEqual(["choosing"]);

    unsubscribe();
    await runtime.resolveChoice("s1");
    // Nothing pushed after unsubscribe.
    expect(seen).toEqual(["choosing"]);

    // The runtime's own state still moved on, proving unsubscribe only
    // stopped this listener, not the receiver underneath it.
    expect(runtime.getState().status).toBe("resolved");
  });

  it("getSnapshot mirrors the most recent event delivered to subscribers", async () => {
    const { port, fire } = makeFakePort(null);
    const runtime = createShareChooserRuntime({ port, draftDeps: makeDraftDeps() });
    runtime.setCandidateSessionIds(["s1"]);
    await runtime.start();

    expect(runtime.getSnapshot()).toEqual({ state: { status: "idle" }, lastEvent: null });

    fire(TEXT_INTENT);
    const snapshot = runtime.getSnapshot();
    expect(snapshot.state.status).toBe("choosing");
    expect(snapshot.lastEvent?.type).toBe("presented");
  });

  it("a real draft is materialized end to end through resolveChoice — the runtime never invents a second write path", async () => {
    const { port } = makeFakePort(TEXT_INTENT);
    const draftDeps = makeDraftDeps();
    const runtime = createShareChooserRuntime({ port, draftDeps });
    runtime.setCandidateSessionIds(["s1"]);
    await runtime.start();

    await runtime.resolveChoice("s1");

    const draft = await draftDeps.draftStore.load("s1");
    expect(draft?.text).toBe("hello");
  });
});

describe("createShareChooserRuntime — stop()", () => {
  it("stops forwarding live port events after stop()", async () => {
    const { port, fire } = makeFakePort(null);
    const runtime = createShareChooserRuntime({ port, draftDeps: makeDraftDeps() });
    runtime.setCandidateSessionIds(["s1"]);
    await runtime.start();
    runtime.stop();

    fire(TEXT_INTENT);
    expect(runtime.getState().status).toBe("idle");
  });
});
