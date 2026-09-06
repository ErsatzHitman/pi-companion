import { describe, expect, it } from "vitest";

import { composer as coreComposer, type Clock } from "@picompanion/frontend-core";

import {
  InMemorySqliteDriver,
  SqliteStructuredStorage,
  TurnOutboxOwner,
  createTurnOutbox,
  type RecoveredTurn,
} from "../../platform/offline";

import { createInMemoryStructuredStorage } from "../composer/in-memory-outbox-runtime";

import {
  confirmRecoveredTurn,
  describeRecoveredTurn,
  discardRecoveredTurn,
  selectRecoveredTurnsForSession,
  type AwaitingConfirmationTurn,
  type RecoveredTurnOutbox,
} from "./recovered-turn-model";

/**
 * T95 — proves both halves of this module's job:
 *
 * 1. Pure selection/filtering, against hand-built `RecoveredTurn` values
 *    (this suite's first `describe`): the exact session and outcome
 *    scoping rules, including the `null` (not-yet-recovered/degraded)
 *    input case.
 * 2. "A recovered turn actually arrives... proven by the value" (this
 *    suite's second `describe`): a *real* `"sending"`-at-cold-start row,
 *    recovered by the real, unmocked `TurnOutboxOwner`/
 *    `recoverInFlightTurns` pass over two `InMemorySqliteDriver`
 *    instances sharing one backing array — `in-memory-sqlite-driver.ts`'s
 *    own sanctioned "simulated process death" pattern, the same one
 *    `../../app-shell/turn-outbox-recovery.test.ts` and
 *    `../../platform/offline/turn-outbox-owner.test.ts` already use for
 *    the "resumed" and "awaiting-confirmation" halves respectively —
 *    fed straight into this module's own `selectRecoveredTurnsForSession`,
 *    never a hand-rolled `RecoveredTurn` fixture standing in for it.
 *
 * T106 adds a third: `confirmRecoveredTurn`/`discardRecoveredTurn` really
 * reach `OutboxController`. Two proof strategies, same split T95's second
 * `describe` above already established:
 *
 * 3. A plain counting fake (`createCountingOutbox` below) proves the
 *    EXACT call and argument arriving — "reaches OutboxController" as a
 *    fact about a call actually made, not a registration.
 * 4. The real, unmocked `composer.OutboxController` — over
 *    `createInMemoryStructuredStorage()` (`../composer/in-memory-
 *    outbox-runtime.ts`, a real `StructuredStorage`, never a fake
 *    pretending to be one) — proves the real state transition
 *    `confirmResend`/`remove` actually perform (awaiting-confirmation ->
 *    pending, and awaiting-confirmation -> gone), not just that some
 *    method got called.
 */

/** Now-only `Clock` double — same shape as `turn-outbox-owner.test.ts`'s own `FakeClock` (copied, not imported: test files are not library code). */
class FakeClock implements Clock {
  constructor(private currentMs: number) {}
  now(): number {
    return this.currentMs;
  }
  setTimeout(): never {
    throw new Error("FakeClock.setTimeout is not implemented; this test double is now-only.");
  }
  clearTimeout(): never {
    throw new Error("FakeClock.clearTimeout is not implemented; this test double is now-only.");
  }
  setInterval(): never {
    throw new Error("FakeClock.setInterval is not implemented; this test double is now-only.");
  }
  clearInterval(): never {
    throw new Error("FakeClock.clearInterval is not implemented; this test double is now-only.");
  }
}

function fakeTurn(overrides: Partial<RecoveredTurn> = {}): RecoveredTurn {
  return {
    id: "outbox_1",
    sessionId: "agt_1",
    kind: "prompt",
    outcome: "awaiting-confirmation",
    status: "awaiting-confirmation",
    ...overrides,
  };
}

describe("selectRecoveredTurnsForSession: pure filtering", () => {
  it("returns [] for null input — a not-yet-recovered or permanently-degraded owner renders as nothing, not an error", () => {
    expect(selectRecoveredTurnsForSession(null, "agt_1")).toEqual([]);
  });

  it("returns [] for an empty recovered-turns array", () => {
    expect(selectRecoveredTurnsForSession([], "agt_1")).toEqual([]);
  });

  it("keeps only the rows matching the given sessionId", () => {
    const mine = fakeTurn({ id: "a", sessionId: "agt_1" });
    const other = fakeTurn({ id: "b", sessionId: "agt_2" });
    expect(selectRecoveredTurnsForSession([mine, other], "agt_1")).toEqual([mine]);
    expect(selectRecoveredTurnsForSession([mine, other], "agt_2")).toEqual([other]);
    expect(selectRecoveredTurnsForSession([mine, other], "agt_3")).toEqual([]);
  });

  it("drops a 'resumed' row for the same session — only awaiting-confirmation is ever selected here", () => {
    const resumed = fakeTurn({ id: "a", outcome: "resumed", status: "pending" });
    const waiting = fakeTurn({ id: "b", outcome: "awaiting-confirmation" });
    expect(selectRecoveredTurnsForSession([resumed, waiting], "agt_1")).toEqual([waiting]);
  });

  it("preserves input order rather than re-sorting", () => {
    const first = fakeTurn({ id: "first" });
    const second = fakeTurn({ id: "second" });
    expect(selectRecoveredTurnsForSession([second, first], "agt_1")).toEqual([second, first]);
  });
});

describe("describeRecoveredTurn", () => {
  it("returns a full sentence, never a bare status word or an internal id", () => {
    // fakeTurn()'s default outcome is "awaiting-confirmation" (asserted by
    // the object literal below), so this cast is safe — describeRecoveredTurn
    // is typed to AwaitingConfirmationTurn only, never the wider RecoveredTurn.
    const text = describeRecoveredTurn(
      fakeTurn({ id: "outbox_should_not_appear" }) as AwaitingConfirmationTurn,
    );
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toContain("outbox_should_not_appear");
    expect(text.endsWith(".")).toBe(true);
  });
});

describe("selectRecoveredTurnsForSession against a REAL recovery pass (value arriving, not a fixture)", () => {
  it("selects the real row a TurnOutboxOwner reconciled to awaiting-confirmation after a simulated process death, scoped to its own session", async () => {
    // Window 2 verbatim (turn-recovery.ts's own doc comment): daemon
    // receipt unconfirmed at the moment of the kill.
    const backing: ConstructorParameters<typeof InMemorySqliteDriver>[0] = [];
    const beforeKillDriver = new InMemorySqliteDriver(backing);
    const seedStorage = new SqliteStructuredStorage({ driver: beforeKillDriver });
    const seedOutbox = createTurnOutbox(seedStorage, new FakeClock(1_000));
    const seeded = await seedOutbox.enqueue({
      sessionId: "agt_t95",
      kind: "prompt",
      payload: { text: "did this reach the daemon before the kill?", attachments: [] },
    });
    await seedOutbox.markSending(seeded.id);

    const afterKillDriver = new InMemorySqliteDriver(backing);
    const owner = new TurnOutboxOwner({
      driverFactory: { open: () => Promise.resolve(afterKillDriver) },
      clock: new FakeClock(2_000),
      scope: "t95-recovered-turn-model-test",
    });
    const status = await owner.open();
    expect(status).toEqual({ kind: "ready" });

    const recovered = owner.getRecoveredTurns();
    expect(recovered).not.toBeNull();

    // THE VALUE: this module's own selector, run over the real recovery
    // report, returns the exact real row — not a count, not a boolean.
    const forThisSession = selectRecoveredTurnsForSession(recovered, "agt_t95");
    expect(forThisSession).toEqual([
      {
        id: seeded.id,
        sessionId: "agt_t95",
        kind: "prompt",
        outcome: "awaiting-confirmation",
        status: "awaiting-confirmation",
      },
    ]);

    // Scoped correctly: a different session sees nothing.
    expect(selectRecoveredTurnsForSession(recovered, "some-other-session")).toEqual([]);

    await owner.dispose();
  });
});

/**
 * T106 — a plain counting fake `RecoveredTurnOutbox`, same shape as
 * `../composer/mic-press-model.test.ts`'s `createCountingPort`: records
 * every call and its argument, never reimplements `confirmResend`/
 * `remove`'s real behaviour. Structurally satisfies `RecoveredTurnOutbox`
 * (and therefore stands in for a real `OutboxController` at the type
 * level too — nothing here is a special case).
 */
function createCountingOutbox(options?: {
  confirmResendResult?: RecoveredTurnOutboxConfirmResult;
}): RecoveredTurnOutbox & { calls: { confirmResend: string[]; remove: string[] } } {
  const calls = { confirmResend: [] as string[], remove: [] as string[] };
  return {
    calls,
    async confirmResend(id: string) {
      calls.confirmResend.push(id);
      return options?.confirmResendResult ?? null;
    },
    async remove(id: string) {
      calls.remove.push(id);
    },
  };
}

/** Just enough of a real `coreComposer.OutboxEntry` for `confirmResend`'s success case — this test never inspects its fields, only that it is not `null`. */
type RecoveredTurnOutboxConfirmResult = Awaited<ReturnType<RecoveredTurnOutbox["confirmResend"]>>;

describe("confirmRecoveredTurn: reaches OutboxController.confirmResend, exactly once, with the turn's own id", () => {
  it("counting fake — the exact call arrives and nothing else does", async () => {
    const turn = fakeTurn({ id: "outbox_confirm_1" }) as AwaitingConfirmationTurn;
    const outbox = createCountingOutbox({
      confirmResendResult: {
        id: turn.id,
        sessionId: turn.sessionId,
        kind: turn.kind,
        payload: {},
        status: "pending",
        createdAt: 0,
        attempts: 1,
      },
    });
    const result = await confirmRecoveredTurn(outbox, turn);
    expect(outbox.calls.confirmResend).toEqual(["outbox_confirm_1"]);
    expect(outbox.calls.remove).toEqual([]);
    expect(result).toBe(true);
  });

  it("returns false, never pretending success, when confirmResend no-ops (turn was not actually awaiting confirmation)", async () => {
    const turn = fakeTurn({ id: "outbox_confirm_2" }) as AwaitingConfirmationTurn;
    const outbox = createCountingOutbox({ confirmResendResult: null });
    const result = await confirmRecoveredTurn(outbox, turn);
    expect(outbox.calls.confirmResend).toEqual(["outbox_confirm_2"]);
    expect(result).toBe(false);
  });

  it("against the real, unmocked OutboxController: moves a real awaiting-confirmation entry back to pending", async () => {
    const clock = new FakeClock(1_000);
    const storage = createInMemoryStructuredStorage();
    const outbox = new coreComposer.OutboxController(storage, clock);
    const entry = await outbox.enqueue({
      sessionId: "agt_confirm",
      kind: "prompt",
      payload: { text: "reaches the real outbox", attachments: [] },
    });
    await outbox.markSending(entry.id);
    await outbox.markFailed(entry.id, "network error");
    const failed = await outbox.load(entry.id);
    expect(failed?.status).toBe("awaiting-confirmation");

    const turn: AwaitingConfirmationTurn = {
      id: entry.id,
      sessionId: "agt_confirm",
      kind: "prompt",
      outcome: "awaiting-confirmation",
      status: "awaiting-confirmation",
    };
    const result = await confirmRecoveredTurn(outbox, turn);
    expect(result).toBe(true);
    const reloaded = await outbox.load(entry.id);
    expect(reloaded?.status).toBe("pending");
  });
});

describe("discardRecoveredTurn: reaches OutboxController.remove, exactly once, with the turn's own id", () => {
  it("counting fake — the exact call arrives, and confirmResend is never touched", async () => {
    const turn = fakeTurn({ id: "outbox_discard_1" }) as AwaitingConfirmationTurn;
    const outbox = createCountingOutbox();
    await discardRecoveredTurn(outbox, turn);
    expect(outbox.calls.remove).toEqual(["outbox_discard_1"]);
    expect(outbox.calls.confirmResend).toEqual([]);
  });

  it("against the real, unmocked OutboxController: a real awaiting-confirmation entry is gone afterwards, never resent", async () => {
    const clock = new FakeClock(2_000);
    const storage = createInMemoryStructuredStorage();
    const outbox = new coreComposer.OutboxController(storage, clock);
    const entry = await outbox.enqueue({
      sessionId: "agt_discard",
      kind: "prompt",
      payload: { text: "discarded, not resent", attachments: [] },
    });
    await outbox.markSending(entry.id);
    await outbox.markFailed(entry.id, "timed out");

    const turn: AwaitingConfirmationTurn = {
      id: entry.id,
      sessionId: "agt_discard",
      kind: "prompt",
      outcome: "awaiting-confirmation",
      status: "awaiting-confirmation",
    };
    await discardRecoveredTurn(outbox, turn);
    expect(await outbox.load(entry.id)).toBeNull();
  });
});
