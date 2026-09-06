import { describe, expect, it } from "vitest";

import {
  ABORT_ACTION_LABEL,
  ATTACH_ACTION_LABEL,
  COMPOSER_ACCESSIBILITY_LABEL,
  COMPOSER_INPUT_LABEL,
  DEFAULT_DISPATCH_MODE,
  EMPTY_COMPOSER_STATE,
  FOLLOW_UP_ACTION_LABEL,
  MIC_ACTION_LABEL,
  QUEUE_MODE_LABEL,
  STEER_ACTION_LABEL,
  abortTurn,
  canAbort,
  canFollowUpDraft,
  canSteerDraft,
  canSubmitDraft,
  describeEntryStatus,
  describeQueueStatus,
  dispatchModeLabel,
  entryStatusLabel,
  finishTurn,
  markEntryFailed,
  markEntrySent,
  markFollowUpFailed,
  markFollowUpSent,
  markSteerFailed,
  markSteerSent,
  pendingCount,
  queueDepth,
  queueDepthLabel,
  recoverFailedDraft,
  retryActionLabel,
  revertDispatchMode,
  setDispatchMode,
  startTurn,
  submitDraft,
  submitFollowUp,
  submitSteer,
  type ComposerState,
  type QueueDispatchMode,
  type TurnService,
} from "./composer-model";

function deps(ids: readonly string[], times: readonly number[]) {
  let idIndex = 0;
  let timeIndex = 0;
  return {
    generateId: () => ids[idIndex++] ?? `fallback-${idIndex}`,
    now: () => times[timeIndex++] ?? 0,
  };
}

/**
 * In-memory fake `TurnService` (T33B2): records what it was asked to do
 * and lets a test resolve or reject each call independently, by call
 * order, instead of settling immediately — so a test can observe the
 * *pending* state a real network round-trip would produce, and can
 * sequence an abort against a still-in-flight call.
 */
function createFakeTurnService() {
  const steerCalls: string[] = [];
  const followUpCalls: string[] = [];
  const modeCalls: QueueDispatchMode[] = [];
  let abortCalls = 0;
  interface Settler {
    resolve: () => void;
    reject: (error: Error) => void;
  }
  const steerSettlers: Settler[] = [];
  const followUpSettlers: Settler[] = [];
  const modeSettlers: Settler[] = [];

  function makeSettled(settlers: Settler[]): Promise<void> {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    settlers.push({ resolve, reject });
    return promise;
  }

  const service: TurnService = {
    steer: (text) => {
      steerCalls.push(text);
      return makeSettled(steerSettlers);
    },
    followUp: (text) => {
      followUpCalls.push(text);
      return makeSettled(followUpSettlers);
    },
    abort: () => {
      abortCalls += 1;
      return Promise.resolve();
    },
    setMode: (mode) => {
      modeCalls.push(mode);
      return makeSettled(modeSettlers);
    },
  };

  return {
    service,
    steerCalls,
    followUpCalls,
    modeCalls,
    get abortCalls() {
      return abortCalls;
    },
    resolveSteer: (index = 0) => steerSettlers[index]?.resolve(),
    rejectSteer: (index = 0) => steerSettlers[index]?.reject(new Error("steer failed")),
    resolveFollowUp: (index = 0) => followUpSettlers[index]?.resolve(),
    rejectFollowUp: (index = 0) => followUpSettlers[index]?.reject(new Error("follow-up failed")),
    resolveMode: (index = 0) => modeSettlers[index]?.resolve(),
    rejectMode: (index = 0) => modeSettlers[index]?.reject(new Error("mode change failed")),
  };
}

describe("canSubmitDraft", () => {
  it("is false for an empty string", () => {
    expect(canSubmitDraft("")).toBe(false);
  });

  it("is false for whitespace-only text", () => {
    expect(canSubmitDraft("   \n\t")).toBe(false);
  });

  it("is true once there is non-whitespace text", () => {
    expect(canSubmitDraft("  hello  ")).toBe(true);
  });
});

describe("submitDraft", () => {
  it("is a no-op for a blank draft", () => {
    const state: ComposerState = { ...EMPTY_COMPOSER_STATE, draft: "   " };
    const result = submitDraft(state, deps(["id-1"], [1]));
    expect(result.entry).toBeUndefined();
    expect(result.state).toBe(state);
  });

  it("adds a trimmed pending entry and clears the draft (optimistic-appearance contract)", () => {
    const state: ComposerState = { ...EMPTY_COMPOSER_STATE, draft: "  hello there  " };
    const result = submitDraft(state, deps(["id-1"], [1000]));

    expect(result.entry).toEqual({
      id: "id-1",
      text: "hello there",
      status: "pending",
      createdAt: 1000,
    });
    // The entry is present in the returned state immediately — this is
    // what "appears optimistically" means: no transport confirmation is
    // awaited before the entry exists in `entries`.
    expect(result.state.entries).toEqual([result.entry]);
    expect(result.state.draft).toBe("");
  });

  it("appends to existing entries rather than replacing them", () => {
    const first = submitDraft({ ...EMPTY_COMPOSER_STATE, draft: "one" }, deps(["id-1"], [1]));
    const second = submitDraft(
      { ...EMPTY_COMPOSER_STATE, draft: "two", entries: first.state.entries },
      deps(["id-2"], [2]),
    );
    expect(second.state.entries.map((entry) => entry.text)).toEqual(["one", "two"]);
  });
});

describe("markEntrySent / markEntryFailed", () => {
  const submitted = submitDraft({ ...EMPTY_COMPOSER_STATE, draft: "hi" }, deps(["id-1"], [1]));
  const entryId = submitted.entry!.id;

  it("markEntrySent flips only the matching entry to sent", () => {
    const other = submitDraft(
      { ...EMPTY_COMPOSER_STATE, draft: "other", entries: submitted.state.entries },
      deps(["id-2"], [2]),
    );
    const next = markEntrySent(other.state, entryId);
    expect(next.entries.find((entry) => entry.id === entryId)?.status).toBe("sent");
    expect(next.entries.find((entry) => entry.id === "id-2")?.status).toBe("pending");
  });

  it("markEntryFailed flips only the matching entry to failed and keeps its text", () => {
    const next = markEntryFailed(submitted.state, entryId);
    const entry = next.entries.find((candidate) => candidate.id === entryId);
    expect(entry?.status).toBe("failed");
    expect(entry?.text).toBe("hi");
  });

  it("is a no-op for an unknown id", () => {
    const next = markEntrySent(submitted.state, "does-not-exist");
    expect(next.entries).toEqual(submitted.state.entries);
  });
});

describe("recoverFailedDraft — the failed transition keeps typed text recoverable", () => {
  it("restores a failed entry's exact text into draft and removes the entry", () => {
    const submitted = submitDraft(
      { ...EMPTY_COMPOSER_STATE, draft: "please do not lose this" },
      deps(["id-1"], [1]),
    );
    const failed = markEntryFailed(submitted.state, submitted.entry!.id);

    const recovered = recoverFailedDraft(failed, submitted.entry!.id);

    expect(recovered.recovered).toBe(true);
    expect(recovered.state.draft).toBe("please do not lose this");
    expect(recovered.state.entries).toEqual([]);
  });

  it("is a no-op for an id that does not name a failed entry", () => {
    const submitted = submitDraft(
      { ...EMPTY_COMPOSER_STATE, draft: "still pending" },
      deps(["id-1"], [1]),
    );

    const recovered = recoverFailedDraft(submitted.state, submitted.entry!.id);

    expect(recovered.recovered).toBe(false);
    expect(recovered.state).toBe(submitted.state);
  });

  it("is a no-op for an unknown id", () => {
    const recovered = recoverFailedDraft(EMPTY_COMPOSER_STATE, "ghost");
    expect(recovered.recovered).toBe(false);
    expect(recovered.state).toBe(EMPTY_COMPOSER_STATE);
  });

  it("does not clobber an in-progress draft when the failure belongs to a different entry", () => {
    // Two submissions in flight; only the second one fails. Recovering it
    // must not discard whatever the user has since typed as a *new* draft
    // — but by construction `submitDraft` always clears the draft on
    // submit, so at recovery time the draft is empty and gets replaced by
    // the recovered text, which is the correct behaviour here.
    const first = submitDraft({ ...EMPTY_COMPOSER_STATE, draft: "first" }, deps(["id-1"], [1]));
    const second = submitDraft(
      { ...EMPTY_COMPOSER_STATE, draft: "second", entries: first.state.entries },
      deps(["id-2"], [2]),
    );
    const failed = markEntryFailed(second.state, "id-2");

    const recovered = recoverFailedDraft(failed, "id-2");

    expect(recovered.state.draft).toBe("second");
    expect(recovered.state.entries.map((entry) => entry.id)).toEqual(["id-1"]);
  });
});

describe("pendingCount", () => {
  it("counts only pending entries", () => {
    const submitted1 = submitDraft({ ...EMPTY_COMPOSER_STATE, draft: "a" }, deps(["id-1"], [1]));
    const submitted2 = submitDraft(
      { ...EMPTY_COMPOSER_STATE, draft: "b", entries: submitted1.state.entries },
      deps(["id-2"], [2]),
    );
    const submitted3 = submitDraft(
      { ...EMPTY_COMPOSER_STATE, draft: "c", entries: submitted2.state.entries },
      deps(["id-3"], [3]),
    );
    const withOneSent = markEntrySent(submitted3.state, "id-1");
    const withOneFailed = markEntryFailed(withOneSent, "id-2");

    expect(pendingCount(withOneFailed)).toBe(1);
  });

  it("is zero for the empty state", () => {
    expect(pendingCount(EMPTY_COMPOSER_STATE)).toBe(0);
  });
});

describe("status text builders (TalkBack announcements)", () => {
  it("entryStatusLabel names every status as visible text, not colour alone", () => {
    expect(entryStatusLabel("pending")).toBe("Sending…");
    expect(entryStatusLabel("sent")).toBe("Sent");
    expect(entryStatusLabel("failed")).toBe("Failed");
  });

  it("describeEntryStatus includes the entry text for every status", () => {
    const entry = { id: "id-1", text: "hello", status: "pending" as const, createdAt: 0 };
    expect(describeEntryStatus(entry)).toContain("hello");
    expect(describeEntryStatus({ ...entry, status: "sent" })).toContain("hello");
    expect(describeEntryStatus({ ...entry, status: "failed" })).toContain("hello");
    expect(describeEntryStatus({ ...entry, status: "failed" })).toMatch(/retry/i);
  });

  it("retryActionLabel names the entry being retried", () => {
    const entry = { id: "id-1", text: "hello", status: "failed" as const, createdAt: 0 };
    expect(retryActionLabel(entry)).toBe("Retry sending: hello");
  });
});

describe("static accessibility labels", () => {
  it("are non-empty, distinct strings", () => {
    const labels = [
      COMPOSER_ACCESSIBILITY_LABEL,
      COMPOSER_INPUT_LABEL,
      MIC_ACTION_LABEL,
      ATTACH_ACTION_LABEL,
    ];
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
    }
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("T33B2 static accessibility labels: steer/follow-up/abort", () => {
  it("are non-empty and distinct from every other composer control label", () => {
    const labels = [
      COMPOSER_ACCESSIBILITY_LABEL,
      COMPOSER_INPUT_LABEL,
      MIC_ACTION_LABEL,
      ATTACH_ACTION_LABEL,
      STEER_ACTION_LABEL,
      FOLLOW_UP_ACTION_LABEL,
      ABORT_ACTION_LABEL,
    ];
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
    }
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("each says what the control does, not just its jargon name", () => {
    // "distinct accessible name" means the strings differ AND say what
    // the control does (this task's brief) — not merely "Steer"/
    // "Follow up"/"Abort" as bare jargon.
    expect(STEER_ACTION_LABEL.toLowerCase()).toMatch(/redirect/);
    expect(FOLLOW_UP_ACTION_LABEL.toLowerCase()).toMatch(/queue/);
    expect(ABORT_ACTION_LABEL.toLowerCase()).toMatch(/stop/);
  });
});

describe("canSteerDraft / canFollowUpDraft / canAbort", () => {
  it("are false when no turn is running, even with draft text", () => {
    const state: ComposerState = { ...EMPTY_COMPOSER_STATE, draft: "hello", turnRunning: false };
    expect(canSteerDraft(state)).toBe(false);
    expect(canFollowUpDraft(state)).toBe(false);
    expect(canAbort(state)).toBe(false);
  });

  it("steer/follow-up are false while running with a blank draft; abort is still true", () => {
    const state: ComposerState = { ...EMPTY_COMPOSER_STATE, draft: "   ", turnRunning: true };
    expect(canSteerDraft(state)).toBe(false);
    expect(canFollowUpDraft(state)).toBe(false);
    expect(canAbort(state)).toBe(true);
  });

  it("steer/follow-up/abort are all true while running with draft text", () => {
    const state: ComposerState = {
      ...EMPTY_COMPOSER_STATE,
      draft: "redirect this",
      turnRunning: true,
    };
    expect(canSteerDraft(state)).toBe(true);
    expect(canFollowUpDraft(state)).toBe(true);
    expect(canAbort(state)).toBe(true);
  });
});

describe("submitSteer / submitFollowUp — queue transitions", () => {
  it("submitSteer is a no-op when no turn is running, even with draft text", () => {
    const state: ComposerState = { ...EMPTY_COMPOSER_STATE, draft: "redirect", turnRunning: false };
    const result = submitSteer(state, deps(["id-1"], [1]));
    expect(result.entry).toBeUndefined();
    expect(result.state).toBe(state);
  });

  it("submitFollowUp is a no-op when no turn is running, even with draft text", () => {
    const state: ComposerState = {
      ...EMPTY_COMPOSER_STATE,
      draft: "queue this",
      turnRunning: false,
    };
    const result = submitFollowUp(state, deps(["id-1"], [1]));
    expect(result.entry).toBeUndefined();
    expect(result.state).toBe(state);
  });

  it("submitSteer is a no-op for a blank draft even while running", () => {
    const state: ComposerState = { ...EMPTY_COMPOSER_STATE, draft: "  \n", turnRunning: true };
    const result = submitSteer(state, deps(["id-1"], [1]));
    expect(result.entry).toBeUndefined();
    expect(result.state).toBe(state);
  });

  it("submitFollowUp is a no-op for a blank draft even while running", () => {
    const state: ComposerState = { ...EMPTY_COMPOSER_STATE, draft: "  \n", turnRunning: true };
    const result = submitFollowUp(state, deps(["id-1"], [1]));
    expect(result.entry).toBeUndefined();
    expect(result.state).toBe(state);
  });

  it("submitSteer enqueues into steerQueue only, clears the draft, and leaves followUpQueue/entries untouched", () => {
    const state: ComposerState = {
      ...EMPTY_COMPOSER_STATE,
      draft: "  go this way instead  ",
      turnRunning: true,
    };
    const result = submitSteer(state, deps(["steer-1"], [10]));

    expect(result.entry).toEqual({
      id: "steer-1",
      text: "go this way instead",
      status: "pending",
      createdAt: 10,
    });
    expect(result.state.steerQueue).toEqual([result.entry]);
    expect(result.state.followUpQueue).toEqual([]);
    expect(result.state.entries).toEqual([]);
    expect(result.state.draft).toBe("");
    expect(result.state.turnRunning).toBe(true);
  });

  it("submitFollowUp enqueues into followUpQueue only, clears the draft, and leaves steerQueue/entries untouched", () => {
    const state: ComposerState = {
      ...EMPTY_COMPOSER_STATE,
      draft: "  do this after  ",
      turnRunning: true,
    };
    const result = submitFollowUp(state, deps(["fu-1"], [20]));

    expect(result.entry).toEqual({
      id: "fu-1",
      text: "do this after",
      status: "pending",
      createdAt: 20,
    });
    expect(result.state.followUpQueue).toEqual([result.entry]);
    expect(result.state.steerQueue).toEqual([]);
    expect(result.state.entries).toEqual([]);
    expect(result.state.draft).toBe("");
  });

  it("appends multiple queued follow-ups in order, mirroring the daemon's followUp: string[] queue", () => {
    const running = { ...EMPTY_COMPOSER_STATE, turnRunning: true };
    const first = submitFollowUp({ ...running, draft: "one" }, deps(["fu-1"], [1]));
    const second = submitFollowUp({ ...first.state, draft: "two" }, deps(["fu-2"], [2]));
    expect(second.state.followUpQueue.map((entry) => entry.text)).toEqual(["one", "two"]);
  });
});

describe("markSteerSent / markSteerFailed / markFollowUpSent / markFollowUpFailed", () => {
  it("flip only the matching queue's matching entry, leaving the other queue untouched", () => {
    const running = { ...EMPTY_COMPOSER_STATE, turnRunning: true };
    const steered = submitSteer({ ...running, draft: "steer" }, deps(["s-1"], [1]));
    const followed = submitFollowUp({ ...steered.state, draft: "follow" }, deps(["f-1"], [2]));

    const sentSteer = markSteerSent(followed.state, "s-1");
    expect(sentSteer.steerQueue[0]?.status).toBe("sent");
    expect(sentSteer.followUpQueue[0]?.status).toBe("pending");

    const failedFollowUp = markFollowUpFailed(sentSteer, "f-1");
    expect(failedFollowUp.followUpQueue[0]?.status).toBe("failed");
    expect(failedFollowUp.followUpQueue[0]?.text).toBe("follow");
    expect(failedFollowUp.steerQueue[0]?.status).toBe("sent");
  });

  it("are no-ops for an unknown id (queues stay deep-equal, unchanged)", () => {
    const running = { ...EMPTY_COMPOSER_STATE, turnRunning: true };
    expect(markSteerSent(running, "ghost")).toEqual(running);
    expect(markSteerFailed(running, "ghost")).toEqual(running);
    expect(markFollowUpSent(running, "ghost")).toEqual(running);
    expect(markFollowUpFailed(running, "ghost")).toEqual(running);
  });
});

describe("startTurn / finishTurn", () => {
  it("startTurn sets turnRunning without touching either queue", () => {
    const state: ComposerState = { ...EMPTY_COMPOSER_STATE, turnRunning: false };
    expect(startTurn(state).turnRunning).toBe(true);
  });

  it("finishTurn clears turnRunning but — unlike abortTurn — never clears a queued follow-up", () => {
    const running = { ...EMPTY_COMPOSER_STATE, turnRunning: true };
    const queued = submitFollowUp(
      { ...running, draft: "still due after this turn" },
      deps(["fu-1"], [1]),
    );

    const finished = finishTurn(queued.state);

    expect(finished.turnRunning).toBe(false);
    expect(finished.followUpQueue).toEqual(queued.state.followUpQueue);
    expect(finished.followUpQueue).toHaveLength(1);
  });
});

describe("abortTurn", () => {
  it("is a no-op — not a crash — when no turn is running", () => {
    const state = EMPTY_COMPOSER_STATE;
    const result = abortTurn(state);
    expect(result.aborted).toBe(false);
    expect(result.state).toBe(state);
    expect(result.cancelledFollowUp).toEqual([]);
    expect(result.cancelledSteer).toEqual([]);
  });

  it("transitions turnRunning to false when a turn was running with empty queues", () => {
    const running: ComposerState = { ...EMPTY_COMPOSER_STATE, turnRunning: true };
    const result = abortTurn(running);
    expect(result.aborted).toBe(true);
    expect(result.state.turnRunning).toBe(false);
    expect(result.cancelledFollowUp).toEqual([]);
  });

  it("cancels every queued follow-up (and steer) rather than leaving them to send later", () => {
    const running = { ...EMPTY_COMPOSER_STATE, turnRunning: true };
    const withSteer = submitSteer({ ...running, draft: "redirect" }, deps(["s-1"], [1]));
    const withFirstFollowUp = submitFollowUp(
      { ...withSteer.state, draft: "first after" },
      deps(["fu-1"], [2]),
    );
    const withSecondFollowUp = submitFollowUp(
      { ...withFirstFollowUp.state, draft: "second after" },
      deps(["fu-2"], [3]),
    );

    const result = abortTurn(withSecondFollowUp.state);

    expect(result.aborted).toBe(true);
    expect(result.state.turnRunning).toBe(false);
    expect(result.state.followUpQueue).toEqual([]);
    expect(result.state.steerQueue).toEqual([]);
    expect(result.cancelledFollowUp.map((entry) => entry.id)).toEqual(["fu-1", "fu-2"]);
    expect(result.cancelledSteer.map((entry) => entry.id)).toEqual(["s-1"]);
  });

  it("interleaving: a follow-up dispatched to the transport before an abort is dropped, and its later resolution does not resurrect it", async () => {
    const fake = createFakeTurnService();
    const running = { ...EMPTY_COMPOSER_STATE, turnRunning: true };

    // Queue a follow-up behind the running turn.
    const submitted = submitFollowUp(
      { ...running, draft: "check this after" },
      deps(["fu-1"], [1]),
    );
    let state = submitted.state;
    expect(state.followUpQueue.map((entry) => entry.id)).toEqual(["fu-1"]);

    // Dispatch it to the transport (mirrors what Composer.tsx's handler
    // does), but the fake does not settle it yet.
    const dispatched = fake.service.followUp(submitted.entry!.text);
    expect(fake.followUpCalls).toEqual(["check this after"]);

    // Abort arrives before the transport call resolves.
    const aborted = abortTurn(state);
    state = aborted.state;
    expect(aborted.aborted).toBe(true);
    expect(aborted.cancelledFollowUp.map((entry) => entry.id)).toEqual(["fu-1"]);
    expect(state.followUpQueue).toEqual([]);
    expect(state.turnRunning).toBe(false);

    // The transport call resolves after the abort already ran. Applying
    // the same reconciliation Composer.tsx would apply on success must
    // not resurrect the cancelled entry: "fu-1" no longer names anything
    // in `followUpQueue`, so this is a no-op — the follow-up is dropped,
    // never silently sent/shown as sent afterwards.
    fake.resolveFollowUp(0);
    await dispatched;
    state = markFollowUpSent(state, "fu-1");
    expect(state.followUpQueue).toEqual([]);
  });
});

describe("full round trip against the fake TurnService", () => {
  it("steer: resolve marks the queued entry sent", async () => {
    const fake = createFakeTurnService();
    const running = { ...EMPTY_COMPOSER_STATE, turnRunning: true };
    const submitted = submitSteer({ ...running, draft: "go left" }, deps(["s-1"], [1]));
    let state = submitted.state;
    expect(state.steerQueue[0]?.status).toBe("pending");

    const call = fake.service.steer(submitted.entry!.text).then(
      () => {
        state = markSteerSent(state, "s-1");
      },
      () => {
        state = markSteerFailed(state, "s-1");
      },
    );
    fake.resolveSteer(0);
    await call;

    expect(state.steerQueue[0]?.status).toBe("sent");
    expect(fake.steerCalls).toEqual(["go left"]);
  });

  it("follow-up: reject marks the queued entry failed and keeps its text", async () => {
    const fake = createFakeTurnService();
    const running = { ...EMPTY_COMPOSER_STATE, turnRunning: true };
    const submitted = submitFollowUp({ ...running, draft: "do this later" }, deps(["fu-1"], [1]));
    let state = submitted.state;

    const call = fake.service.followUp(submitted.entry!.text).then(
      () => {
        state = markFollowUpSent(state, "fu-1");
      },
      () => {
        state = markFollowUpFailed(state, "fu-1");
      },
    );
    fake.rejectFollowUp(0);
    await call;

    expect(state.followUpQueue[0]?.status).toBe("failed");
    expect(state.followUpQueue[0]?.text).toBe("do this later");
  });

  it("abort: the fake records the call", async () => {
    const fake = createFakeTurnService();
    const running: ComposerState = { ...EMPTY_COMPOSER_STATE, turnRunning: true };
    const result = abortTurn(running);
    await fake.service.abort();
    expect(result.aborted).toBe(true);
    expect(fake.abortCalls).toBe(1);
  });
});

describe("QUEUE_MODE_LABEL static accessibility label", () => {
  it("is a real, non-empty accessible name distinct from the steer/follow-up/abort labels", () => {
    expect(QUEUE_MODE_LABEL.length).toBeGreaterThan(0);
    expect(
      new Set([QUEUE_MODE_LABEL, STEER_ACTION_LABEL, FOLLOW_UP_ACTION_LABEL, ABORT_ACTION_LABEL])
        .size,
    ).toBe(4);
  });
});

describe("queueDepth — T33B3", () => {
  it("is zero for an empty composer", () => {
    expect(queueDepth(EMPTY_COMPOSER_STATE)).toEqual({ steer: 0, followUp: 0, total: 0 });
  });

  it("counts only pending entries in each queue, not sent/failed history", () => {
    const state: ComposerState = {
      ...EMPTY_COMPOSER_STATE,
      turnRunning: true,
      steerQueue: [
        { id: "s-1", text: "left", status: "pending", createdAt: 1 },
        { id: "s-2", text: "right", status: "sent", createdAt: 2 },
      ],
      followUpQueue: [
        { id: "f-1", text: "later", status: "pending", createdAt: 3 },
        { id: "f-2", text: "also later", status: "pending", createdAt: 4 },
        { id: "f-3", text: "stale", status: "failed", createdAt: 5 },
      ],
    };
    expect(queueDepth(state)).toEqual({ steer: 1, followUp: 2, total: 3 });
  });

  it("reflects live changes as entries move from pending to sent/failed", () => {
    const running: ComposerState = { ...EMPTY_COMPOSER_STATE, turnRunning: true };
    const submitted = submitSteer({ ...running, draft: "go left" }, deps(["s-1"], [1]));
    expect(queueDepth(submitted.state).steer).toBe(1);

    const acked = markSteerSent(submitted.state, "s-1");
    expect(queueDepth(acked).steer).toBe(0);
  });
});

describe("queueDepthLabel — visible text, not colour alone (plan.md §10.5/T54)", () => {
  it("reads as an explicit empty state at zero", () => {
    expect(queueDepthLabel({ steer: 0, followUp: 0, total: 0 })).toBe("Queue empty");
  });

  it("names both queues' counts in singular/plural text", () => {
    expect(queueDepthLabel({ steer: 1, followUp: 0, total: 1 })).toBe(
      "1 message queued (1 steer, 0 follow-up)",
    );
    expect(queueDepthLabel({ steer: 1, followUp: 2, total: 3 })).toBe(
      "3 messages queued (1 steer, 2 follow-up)",
    );
  });
});

describe("dispatchModeLabel / describeQueueStatus", () => {
  it("labels each mode in title case, matching the Select options", () => {
    expect(dispatchModeLabel("steer")).toBe("Steer");
    expect(dispatchModeLabel("follow-up")).toBe("Follow up");
  });

  it("combines the mode and the queue depth into one announced sentence", () => {
    const state: ComposerState = {
      ...EMPTY_COMPOSER_STATE,
      turnRunning: true,
      mode: "steer",
      steerQueue: [{ id: "s-1", text: "go left", status: "pending", createdAt: 1 }],
    };
    expect(describeQueueStatus(state)).toBe("Steer mode. 1 message queued (1 steer, 0 follow-up).");
  });
});

describe("EMPTY_COMPOSER_STATE.mode defaults to DEFAULT_DISPATCH_MODE", () => {
  it("starts on follow-up, the non-redirecting default", () => {
    expect(DEFAULT_DISPATCH_MODE).toBe("follow-up");
    expect(EMPTY_COMPOSER_STATE.mode).toBe(DEFAULT_DISPATCH_MODE);
  });
});

describe("setDispatchMode / revertDispatchMode — optimistic mode change with rollback", () => {
  it("applies the new mode immediately and reports the prior mode for rollback", () => {
    const result = setDispatchMode(EMPTY_COMPOSER_STATE, "steer");
    expect(result.changed).toBe(true);
    expect(result.previousMode).toBe("follow-up");
    expect(result.state.mode).toBe("steer");
  });

  it("is a no-op (same state back, changed: false) when the mode already matches", () => {
    const state: ComposerState = { ...EMPTY_COMPOSER_STATE, mode: "steer" };
    const result = setDispatchMode(state, "steer");
    expect(result.changed).toBe(false);
    expect(result.state).toBe(state);
    expect(result.previousMode).toBe("steer");
  });

  it("revertDispatchMode restores the prior mode after a rejection", () => {
    const optimistic = setDispatchMode(EMPTY_COMPOSER_STATE, "steer").state;
    expect(optimistic.mode).toBe("steer");
    const reverted = revertDispatchMode(optimistic, "follow-up");
    expect(reverted.mode).toBe("follow-up");
  });

  it("revertDispatchMode is a no-op (same state back) when the mode already matches", () => {
    const state: ComposerState = { ...EMPTY_COMPOSER_STATE, mode: "steer" };
    expect(revertDispatchMode(state, "steer")).toBe(state);
  });
});

describe("full round trip against the fake TurnService — mode change", () => {
  it("resolve: the requested mode sticks", async () => {
    const fake = createFakeTurnService();
    const requested: QueueDispatchMode = "steer";
    let state = EMPTY_COMPOSER_STATE;
    const result = setDispatchMode(state, requested);
    state = result.state;
    expect(state.mode).toBe("steer");

    const call = fake.service.setMode(requested).catch(() => {
      state = revertDispatchMode(state, result.previousMode);
    });
    fake.resolveMode(0);
    await call;

    expect(state.mode).toBe("steer");
    expect(fake.modeCalls).toEqual(["steer"]);
  });

  it("reject: the model reverts to the mode in effect before the request, not stuck on the requested one", async () => {
    const fake = createFakeTurnService();
    let state: ComposerState = { ...EMPTY_COMPOSER_STATE, mode: "follow-up" };
    const requested: QueueDispatchMode = "steer";
    const result = setDispatchMode(state, requested);
    state = result.state;
    // Optimistic: the requested mode is visible immediately, before the
    // daemon has answered.
    expect(state.mode).toBe("steer");

    const call = fake.service.setMode(requested).catch(() => {
      state = revertDispatchMode(state, result.previousMode);
    });
    fake.rejectMode(0);
    await call;

    expect(state.mode).toBe("follow-up");
  });
});
