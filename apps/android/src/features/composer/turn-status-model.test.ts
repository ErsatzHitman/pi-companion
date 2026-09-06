import { describe, expect, it, vi } from "vitest";

import {
  INITIAL_TURN_STATUS_STATE,
  applyTurnStreamEvent,
  clearRetryForNewTurn,
  createTurnStatusController,
  describeCompactionStatus,
  describeRetryStatus,
  describeTurnStatusUnavailable,
  type DaemonTurnStatusSource,
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
    expect(describeRetryStatus({ phase: "assistant", attempt: 2, maxAttempts: 5 })).toBe(
      "Response retry 2/5…",
    );
  });

  it("names the compaction phase distinctly", () => {
    expect(describeRetryStatus({ phase: "compaction", attempt: 1, maxAttempts: 3 })).toBe(
      "Compaction retry 1/3…",
    );
  });

  it("names the branchSummary phase as Summary", () => {
    expect(describeRetryStatus({ phase: "branchSummary", attempt: 1, maxAttempts: 3 })).toBe(
      "Summary retry 1/3…",
    );
  });

  it("appends the daemon's raw error when one is given", () => {
    expect(
      describeRetryStatus({
        phase: "assistant",
        attempt: 3,
        maxAttempts: 5,
        error: "rate limited",
      }),
    ).toBe("Response retry 3/5 — rate limited");
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

  it("replaces state.retry on a pi_retry event", () => {
    const next = applyTurnStreamEvent(base, {
      type: "pi_retry",
      phase: "assistant",
      attempt: 1,
      maxAttempts: 5,
    });
    expect(next.retry).toEqual({ phase: "assistant", attempt: 1, maxAttempts: 5 });
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
    const afterFirst = applyTurnStreamEvent(base, {
      type: "pi_retry",
      phase: "assistant",
      attempt: 1,
      maxAttempts: 5,
      error: "timeout",
    });
    const afterSecond = applyTurnStreamEvent(afterFirst, {
      type: "pi_retry",
      phase: "assistant",
      attempt: 2,
      maxAttempts: 5,
    });
    expect(afterSecond.retry).toEqual({ phase: "assistant", attempt: 2, maxAttempts: 5 });
  });
});

describe("clearRetryForNewTurn", () => {
  it("clears an existing retry", () => {
    const withRetry: TurnStatusState = {
      ...INITIAL_TURN_STATUS_STATE,
      retry: { phase: "assistant", attempt: 1, maxAttempts: 5 },
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
    const controller = createTurnStatusController({ agentId: "agt_1", client: fake });
    controller.subscribe();
    emit({
      agentId: "agt_1",
      event: { type: "pi_retry", phase: "assistant", attempt: 1, maxAttempts: 5 },
    });
    expect(controller.getState().retry).toEqual({ phase: "assistant", attempt: 1, maxAttempts: 5 });
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
