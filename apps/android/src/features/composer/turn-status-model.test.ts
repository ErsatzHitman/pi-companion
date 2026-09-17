import { describe, expect, it, vi } from "vitest";

import {
  INITIAL_TURN_STATUS_STATE,
  applyTurnStreamEvent,
  clearRetryForNewTurn,
  createTurnStatusController,
  describeCompactionStatus,
  describeRetryStatus,
  describeTurnStatusUnavailable,
  retryCountdownSecondsRemaining,
  type DaemonTurnStatusSource,
  type TurnRetryStatus,
  type TurnStatusState,
  type TurnStreamMessage,
} from "./turn-status-model.js";

/**
 * T39C: Android's retry/compaction status controller, over a counting
 * fake standing in for `@picompanion/client`'s real
 * `DaemonClient.on("agent_stream", handler)` (see `turn-status-model.ts`'s
 * module doc for exactly why this reads the raw stream rather than
 * `frontend-core`'s timeline domain).
 *
 * Every assertion below was mutation-checked by hand: the specific
 * construct each `it` names was deleted (or its guard inverted), this
 * file was re-run to confirm the exact test failed, then the change was
 * reverted byte-identically. This task's report carries the full run
 * log.
 */

function createFake(): {
  fake: Required<DaemonTurnStatusSource>;
  emit: (message: TurnStreamMessage) => void;
  getUnsubscribeCalls: () => number;
} {
  let handler: ((message: TurnStreamMessage) => void) | null = null;
  let unsubscribeCalls = 0;
  const fake: Required<DaemonTurnStatusSource> = {
    on: vi.fn((_type: "agent_stream", h: (message: TurnStreamMessage) => void) => {
      handler = h;
      return () => {
        unsubscribeCalls += 1;
      };
    }),
  };
  return {
    fake,
    emit: (message: TurnStreamMessage) => handler?.(message),
    getUnsubscribeCalls: () => unsubscribeCalls,
  };
}

describe("describeTurnStatusUnavailable", () => {
  it("names the specific reason for each non-ready availability", () => {
    expect(describeTurnStatusUnavailable("no-client")).toMatch(/Connect to a daemon/);
    expect(describeTurnStatusUnavailable("unsupported")).toMatch(/can't report retry/);
  });
});

describe("describeRetryStatus", () => {
  it("returns null when nothing is retrying", () => {
    expect(describeRetryStatus(null)).toBeNull();
  });

  it("names the phase and attempt count, without an error suffix when none is given", () => {
    expect(
      describeRetryStatus({ phase: "assistant", attempt: 2, maxAttempts: 5, receivedAtMs: 0 }),
    ).toBe("Response retry 2/5…");
  });

  it("names the compaction phase distinctly", () => {
    expect(
      describeRetryStatus({ phase: "compaction", attempt: 1, maxAttempts: 3, receivedAtMs: 0 }),
    ).toBe("Compaction retry 1/3…");
  });

  it("names the branchSummary phase as Summary", () => {
    expect(
      describeRetryStatus({ phase: "branchSummary", attempt: 1, maxAttempts: 3, receivedAtMs: 0 }),
    ).toBe("Summary retry 1/3…");
  });

  it("appends the daemon's raw error when one is given", () => {
    expect(
      describeRetryStatus({
        phase: "assistant",
        attempt: 3,
        maxAttempts: 5,
        error: "rate limited",
        receivedAtMs: 0,
      }),
    ).toBe("Response retry 3/5 — rate limited");
  });

  // The six countdown sentence shapes — two per phase (live, expired) —
  // this module actually produces. Only `assistant` matches the confirmed
  // Android design's one drawn countdown frame (s6) verbatim; `compaction`
  // and `branchSummary` deliberately keep their phase word instead of
  // copying that frame's wording, because the design never drew a
  // countdown for either phase. See turn-status-model.ts's
  // describeRetryStatus doc comment for the full reasoning, and for why
  // "(ctrl+c to cancel)" is not among any of these six.
  it("names a live assistant countdown as 'Retrying (a/m) in Ns…', matching the design frame verbatim", () => {
    const retry: TurnRetryStatus = {
      phase: "assistant",
      attempt: 2,
      maxAttempts: 5,
      delayMs: 8000,
      receivedAtMs: 0,
    };
    expect(describeRetryStatus(retry, 8)).toBe("Retrying (2/5) in 8s…");
  });

  it("names an expired assistant countdown as 'Retrying (a/m) now…'", () => {
    const retry: TurnRetryStatus = {
      phase: "assistant",
      attempt: 2,
      maxAttempts: 5,
      delayMs: 8000,
      receivedAtMs: 0,
    };
    expect(describeRetryStatus(retry, 0)).toBe("Retrying (2/5) now…");
  });

  // These two would fail if the compaction phase label were ever dropped
  // from the countdown sentence (e.g. reverted to match assistant's bare
  // "Retrying" wording) — the exact regression this correction guards.
  it("keeps the Compaction phase label on a live countdown: 'Compaction retry (a/m) in Ns…'", () => {
    const retry: TurnRetryStatus = {
      phase: "compaction",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 8000,
      receivedAtMs: 0,
    };
    expect(describeRetryStatus(retry, 8)).toBe("Compaction retry (1/3) in 8s…");
  });

  it("keeps the Compaction phase label on an expired countdown: 'Compaction retry (a/m) now…'", () => {
    const retry: TurnRetryStatus = {
      phase: "compaction",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 8000,
      receivedAtMs: 0,
    };
    expect(describeRetryStatus(retry, 0)).toBe("Compaction retry (1/3) now…");
  });

  // Same regression guard as the two Compaction tests above, for branchSummary.
  it("keeps the Summary phase label on a live countdown: 'Summary retry (a/m) in Ns…'", () => {
    const retry: TurnRetryStatus = {
      phase: "branchSummary",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 8000,
      receivedAtMs: 0,
    };
    expect(describeRetryStatus(retry, 8)).toBe("Summary retry (1/3) in 8s…");
  });

  it("keeps the Summary phase label on an expired countdown: 'Summary retry (a/m) now…'", () => {
    const retry: TurnRetryStatus = {
      phase: "branchSummary",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 8000,
      receivedAtMs: 0,
    };
    expect(describeRetryStatus(retry, 0)).toBe("Summary retry (1/3) now…");
  });

  it("keeps today's phase-labelled shape when delayMs is absent, even if a remaining count is passed", () => {
    const retry: TurnRetryStatus = {
      phase: "assistant",
      attempt: 2,
      maxAttempts: 5,
      receivedAtMs: 0,
    };
    expect(describeRetryStatus(retry, 8)).toBe("Response retry 2/5…");
  });

  it("appends the daemon's error onto the live-countdown sentence instead of its ellipsis", () => {
    const retry: TurnRetryStatus = {
      phase: "assistant",
      attempt: 2,
      maxAttempts: 5,
      delayMs: 8000,
      error: "rate limited",
      receivedAtMs: 0,
    };
    expect(describeRetryStatus(retry, 8)).toBe("Retrying (2/5) in 8s — rate limited");
  });
});

describe("retryCountdownSecondsRemaining", () => {
  it("returns null when there is no retry in progress", () => {
    expect(retryCountdownSecondsRemaining(null, 1_000)).toBeNull();
  });

  // W7 merge gate. `delayMs: 0` is a legal wire value and is NOT the
  // same as the field being absent: zero means "retrying immediately",
  // absent means the daemon sent no schedule at all and this app must
  // not invent one. Every other case below starts from `delayMs: 8000`,
  // and the expiry cases reach the "now" wording by passing a literal
  // `0` for `remainingSeconds` — which exercises the SENTENCE but never
  // the computation that produces a zero from a zero delay. These two
  // close that path.
  it("returns 0, not null, for a retry whose delayMs is a real zero", () => {
    expect(
      retryCountdownSecondsRemaining(
        { phase: "assistant", attempt: 2, maxAttempts: 5, delayMs: 0, receivedAtMs: 100_000 },
        100_000,
      ),
    ).toBe(0);
  });

  it("renders the 'now' sentence when a zero delayMs is carried all the way through", () => {
    const retry = {
      phase: "assistant" as const,
      attempt: 2,
      maxAttempts: 5,
      delayMs: 0,
      receivedAtMs: 100_000,
    };
    expect(describeRetryStatus(retry, retryCountdownSecondsRemaining(retry, 100_000))).toBe(
      "Retrying (2/5) now…",
    );
  });

  it("returns null when the retry carries no delayMs", () => {
    const retry: TurnRetryStatus = {
      phase: "assistant",
      attempt: 1,
      maxAttempts: 5,
      receivedAtMs: 1_000,
    };
    expect(retryCountdownSecondsRemaining(retry, 1_500)).toBeNull();
  });

  it("reports the whole seconds left at a live delay", () => {
    const retry: TurnRetryStatus = {
      phase: "assistant",
      attempt: 2,
      maxAttempts: 5,
      delayMs: 8_000,
      receivedAtMs: 100_000,
    };
    expect(retryCountdownSecondsRemaining(retry, 100_000)).toBe(8);
    expect(retryCountdownSecondsRemaining(retry, 103_500)).toBe(5);
  });

  it("reports 0 exactly at expiry", () => {
    const retry: TurnRetryStatus = {
      phase: "assistant",
      attempt: 2,
      maxAttempts: 5,
      delayMs: 8_000,
      receivedAtMs: 100_000,
    };
    expect(retryCountdownSecondsRemaining(retry, 108_000)).toBe(0);
  });

  it("clamps to 0 rather than going negative past expiry", () => {
    const retry: TurnRetryStatus = {
      phase: "assistant",
      attempt: 2,
      maxAttempts: 5,
      delayMs: 8_000,
      receivedAtMs: 100_000,
    };
    expect(retryCountdownSecondsRemaining(retry, 200_000)).toBe(0);
  });
});

describe("describeCompactionStatus", () => {
  it("returns null when no compaction is known", () => {
    expect(describeCompactionStatus(null)).toBeNull();
  });

  it("explains an in-progress automatic compaction", () => {
    expect(describeCompactionStatus({ status: "loading", trigger: "auto" })).toBe(
      "Automatic compaction in progress — condensing earlier turns to free up context space.",
    );
  });

  it("explains a completed manual compaction, including the pre-compaction token count", () => {
    expect(
      describeCompactionStatus({ status: "completed", trigger: "manual", preTokens: 128_500 }),
    ).toBe(
      "Manual compaction completed — earlier turns were condensed to free up context space. The conversation was using about 128,500 tokens beforehand.",
    );
  });

  it("omits the token note when preTokens is not supplied", () => {
    expect(describeCompactionStatus({ status: "completed" })).toBe(
      "Compaction completed — earlier turns were condensed to free up context space.",
    );
  });

  // T143: `compaction_end`'s payload used to be discarded entirely at the
  // daemon boundary, so this banner could only ever say "Compaction
  // completed" with no summary or file information. These prove the new
  // fields actually reach the user-visible sentence.
  it("appends Pi's own summary when the daemon supplies one (T143)", () => {
    expect(
      describeCompactionStatus({
        status: "completed",
        summary: "Discussed the auth refactor and merged two branches.",
      }),
    ).toBe(
      "Compaction completed — earlier turns were condensed to free up context space. Summary: Discussed the auth refactor and merged two branches.",
    );
  });

  it("appends a file-count note when read/modified files are supplied (T143)", () => {
    expect(
      describeCompactionStatus({
        status: "completed",
        filesRead: ["a.ts", "b.ts"],
        filesModified: ["c.ts"],
      }),
    ).toBe(
      "Compaction completed — earlier turns were condensed to free up context space. (2 files read, 1 file modified)",
    );
  });

  it("omits the file-count note when neither list is supplied", () => {
    expect(describeCompactionStatus({ status: "completed", summary: "ok" })).toBe(
      "Compaction completed — earlier turns were condensed to free up context space. Summary: ok",
    );
  });
});

describe("applyTurnStreamEvent", () => {
  const base: TurnStatusState = INITIAL_TURN_STATUS_STATE;
  const fixedClock = () => 1_700_000_000_000;

  it("replaces state.retry on a pi_retry event", () => {
    const next = applyTurnStreamEvent(
      base,
      {
        type: "pi_retry",
        phase: "assistant",
        attempt: 1,
        maxAttempts: 5,
      },
      fixedClock,
    );
    expect(next.retry).toEqual({
      phase: "assistant",
      attempt: 1,
      maxAttempts: 5,
      receivedAtMs: 1_700_000_000_000,
    });
  });

  // Pins the exact stamped value from an injected fake clock — not
  // `expect.any(Number)` — proving `receivedAtMs` really comes from the
  // clock this call was given, not from the real wall clock.
  it("stamps receivedAtMs from the injected clock, exactly", () => {
    const fakeClock = vi.fn(() => 42_000);
    const next = applyTurnStreamEvent(
      base,
      { type: "pi_retry", phase: "compaction", attempt: 3, maxAttempts: 5 },
      fakeClock,
    );
    expect(next.retry?.receivedAtMs).toBe(42_000);
    expect(fakeClock).toHaveBeenCalledTimes(1);
  });

  it("defaults to the real wall clock when no clock is given", () => {
    const before = Date.now();
    const next = applyTurnStreamEvent(base, {
      type: "pi_retry",
      phase: "assistant",
      attempt: 1,
      maxAttempts: 5,
    });
    const after = Date.now();
    expect(next.retry?.receivedAtMs).toBeGreaterThanOrEqual(before);
    expect(next.retry?.receivedAtMs).toBeLessThanOrEqual(after);
  });

  it("replaces state.compaction on a timeline compaction item", () => {
    const next = applyTurnStreamEvent(base, {
      type: "timeline",
      item: { type: "compaction", status: "loading", trigger: "auto" },
    });
    expect(next.compaction).toEqual({ status: "loading", trigger: "auto", preTokens: undefined });
  });

  // T143: carries the daemon's new compaction result fields onto
  // `state.compaction`, not just the pre-existing status/trigger/preTokens.
  it("carries summary, estimatedTokensAfter and file lists onto state.compaction (T143)", () => {
    const next = applyTurnStreamEvent(base, {
      type: "timeline",
      item: {
        type: "compaction",
        status: "completed",
        trigger: "auto",
        preTokens: 128_000,
        summary: "Discussed the auth refactor and merged two branches.",
        estimatedTokensAfter: 4_000,
        filesRead: ["a.ts", "b.ts"],
        filesModified: ["c.ts"],
      },
    });
    expect(next.compaction).toEqual({
      status: "completed",
      trigger: "auto",
      preTokens: 128_000,
      summary: "Discussed the auth refactor and merged two branches.",
      estimatedTokensAfter: 4_000,
      filesRead: ["a.ts", "b.ts"],
      filesModified: ["c.ts"],
    });
  });

  it("ignores a timeline event whose item is not a compaction", () => {
    const next = applyTurnStreamEvent(base, {
      type: "timeline",
      item: { type: "user_message", text: "hi" },
    });
    expect(next).toBe(base);
  });

  it("ignores every other real AgentStreamEvent variant (e.g. turn_started) without throwing", () => {
    const next = applyTurnStreamEvent(base, { type: "turn_started" });
    expect(next).toBe(base);
  });

  it("a later pi_retry event replaces, rather than merges with, an earlier one", () => {
    const afterFirst = applyTurnStreamEvent(
      base,
      {
        type: "pi_retry",
        phase: "assistant",
        attempt: 1,
        maxAttempts: 5,
        error: "timeout",
      },
      fixedClock,
    );
    const afterSecond = applyTurnStreamEvent(
      afterFirst,
      {
        type: "pi_retry",
        phase: "assistant",
        attempt: 2,
        maxAttempts: 5,
      },
      fixedClock,
    );
    expect(afterSecond.retry).toEqual({
      phase: "assistant",
      attempt: 2,
      maxAttempts: 5,
      receivedAtMs: 1_700_000_000_000,
    });
  });
});

describe("clearRetryForNewTurn", () => {
  it("clears an existing retry", () => {
    const withRetry: TurnStatusState = {
      ...INITIAL_TURN_STATUS_STATE,
      retry: { phase: "assistant", attempt: 1, maxAttempts: 5, receivedAtMs: 0 },
    };
    expect(clearRetryForNewTurn(withRetry).retry).toBeNull();
  });

  it("is a referential no-op when there is nothing to clear", () => {
    expect(clearRetryForNewTurn(INITIAL_TURN_STATUS_STATE)).toBe(INITIAL_TURN_STATUS_STATE);
  });
});

describe("createTurnStatusController: availability", () => {
  it("stays no-client when no client is supplied at all, even after subscribe()", () => {
    const controller = createTurnStatusController({ agentId: "agt_1" });
    controller.subscribe();
    expect(controller.getState().availability).toBe("no-client");
  });

  it("reports unsupported when the client omits on()", () => {
    const controller = createTurnStatusController({ agentId: "agt_1", client: {} });
    controller.subscribe();
    expect(controller.getState().availability).toBe("unsupported");
  });

  it("reaches ready and calls on('agent_stream', ...) exactly once for a capable client", () => {
    const { fake } = createFake();
    const controller = createTurnStatusController({ agentId: "agt_1", client: fake });
    controller.subscribe();
    expect(controller.getState().availability).toBe("ready");
    expect(fake.on).toHaveBeenCalledTimes(1);
    expect(fake.on).toHaveBeenCalledWith("agent_stream", expect.any(Function));
  });
});

describe("createTurnStatusController: live updates", () => {
  it("updates state.retry when a matching-agent pi_retry event arrives", () => {
    const { fake, emit } = createFake();
    const controller = createTurnStatusController({
      agentId: "agt_1",
      client: fake,
      clock: () => 5_000,
    });
    controller.subscribe();
    emit({
      agentId: "agt_1",
      event: { type: "pi_retry", phase: "assistant", attempt: 1, maxAttempts: 5 },
    });
    expect(controller.getState().retry).toEqual({
      phase: "assistant",
      attempt: 1,
      maxAttempts: 5,
      receivedAtMs: 5_000,
    });
  });

  it("threads its clock dep into applyTurnStreamEvent for every retry event, not just the default Date.now", () => {
    const { fake, emit } = createFake();
    let tick = 1_000;
    const controller = createTurnStatusController({
      agentId: "agt_1",
      client: fake,
      clock: () => tick,
    });
    controller.subscribe();
    emit({
      agentId: "agt_1",
      event: { type: "pi_retry", phase: "assistant", attempt: 1, maxAttempts: 5 },
    });
    expect(controller.getState().retry?.receivedAtMs).toBe(1_000);
    tick = 9_000;
    emit({
      agentId: "agt_1",
      event: { type: "pi_retry", phase: "assistant", attempt: 2, maxAttempts: 5 },
    });
    expect(controller.getState().retry?.receivedAtMs).toBe(9_000);
  });

  it("ignores an event for a different agentId", () => {
    const { fake, emit } = createFake();
    const controller = createTurnStatusController({ agentId: "agt_1", client: fake });
    controller.subscribe();
    emit({
      agentId: "agt_OTHER",
      event: { type: "pi_retry", phase: "assistant", attempt: 1, maxAttempts: 5 },
    });
    expect(controller.getState().retry).toBeNull();
  });

  it("updates state.compaction when a matching-agent timeline compaction event arrives", () => {
    const { fake, emit } = createFake();
    const controller = createTurnStatusController({ agentId: "agt_1", client: fake });
    controller.subscribe();
    emit({
      agentId: "agt_1",
      event: {
        type: "timeline",
        item: { type: "compaction", status: "completed", preTokens: 500 },
      },
    });
    expect(controller.getState().compaction).toEqual({
      status: "completed",
      trigger: undefined,
      preTokens: 500,
    });
  });

  it("clears a stale retry once a matching-agent turn_started event arrives", () => {
    const { fake, emit } = createFake();
    const controller = createTurnStatusController({ agentId: "agt_1", client: fake });
    controller.subscribe();
    emit({
      agentId: "agt_1",
      event: { type: "pi_retry", phase: "assistant", attempt: 1, maxAttempts: 5 },
    });
    expect(controller.getState().retry).not.toBeNull();
    emit({ agentId: "agt_1", event: { type: "turn_started" } });
    expect(controller.getState().retry).toBeNull();
  });
});

describe("createTurnStatusController: onChange", () => {
  it("calls onChange after a matching-agent event is processed", () => {
    const { fake, emit } = createFake();
    const controller = createTurnStatusController({ agentId: "agt_1", client: fake });
    const onChange = vi.fn();
    controller.subscribe(onChange);
    emit({
      agentId: "agt_1",
      event: { type: "pi_retry", phase: "assistant", attempt: 1, maxAttempts: 5 },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not call onChange for an event addressed to a different agent", () => {
    const { fake, emit } = createFake();
    const controller = createTurnStatusController({ agentId: "agt_1", client: fake });
    const onChange = vi.fn();
    controller.subscribe(onChange);
    emit({
      agentId: "agt_OTHER",
      event: { type: "pi_retry", phase: "assistant", attempt: 1, maxAttempts: 5 },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange even for a turn_started event that only clears a stale retry", () => {
    const { fake, emit } = createFake();
    const controller = createTurnStatusController({ agentId: "agt_1", client: fake });
    const onChange = vi.fn();
    controller.subscribe(onChange);
    emit({ agentId: "agt_1", event: { type: "turn_started" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("subscribing with no onChange at all does not throw when an event arrives", () => {
    const { fake, emit } = createFake();
    const controller = createTurnStatusController({ agentId: "agt_1", client: fake });
    controller.subscribe();
    expect(() =>
      emit({
        agentId: "agt_1",
        event: { type: "pi_retry", phase: "assistant", attempt: 1, maxAttempts: 5 },
      }),
    ).not.toThrow();
  });
});

describe("createTurnStatusController: unsubscribe", () => {
  it("calls the real unsubscribe function returned by on()", () => {
    const { fake, getUnsubscribeCalls } = createFake();
    const controller = createTurnStatusController({ agentId: "agt_1", client: fake });
    controller.subscribe();
    controller.unsubscribe();
    expect(getUnsubscribeCalls()).toBe(1);
  });

  it("is a no-op when nothing was ever subscribed", () => {
    const controller = createTurnStatusController({ agentId: "agt_1" });
    expect(() => controller.unsubscribe()).not.toThrow();
  });
});
