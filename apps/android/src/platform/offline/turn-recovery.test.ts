/**
 * T37C's three acceptance criteria:
 *
 * 1. "Kill-and-restore during an active turn recovers correctly" —
 *    proven below by simulating process death (discarding every
 *    in-memory object and re-wrapping the SAME `InMemorySqliteDriver`
 *    backing in a fresh `SqliteStructuredStorage` / `OutboxController`,
 *    exactly what a real cold start does) across each of the three
 *    windows a kill can land in, per `./turn-recovery.ts`'s doc
 *    comment.
 * 2. "No duplicate submission occurs on restore" — proven by asserting
 *    the entry count and stable id are unchanged by recovery in every
 *    window, and that replaying recovery twice makes no further
 *    change.
 * 3. "The recovered turn continues or fails explicitly" — proven by
 *    asserting every recovered row's outcome is one of
 *    `RECOVERED_TURN_OUTCOMES`, and that none is left in the ambiguous
 *    `"sending"` status.
 */
import { composer as coreComposer } from "@picompanion/frontend-core";
import type { Clock } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

import { InMemorySqliteDriver } from "./in-memory-sqlite-driver.js";
import { SqliteStructuredStorage } from "./sqlite-structured-storage.js";
import {
  RECOVERED_TURN_OUTCOMES,
  TURN_RECOVERY_REASON,
  createTurnOutbox,
  recoverInFlightTurns,
} from "./turn-recovery.js";

class ManualClock implements Clock {
  constructor(private currentMs: number) {}
  now(): number {
    return this.currentMs;
  }
  setTimeout(): never {
    throw new Error("ManualClock.setTimeout is not implemented; this test double is now-only.");
  }
  clearTimeout(): never {
    throw new Error("ManualClock.clearTimeout is not implemented; this test double is now-only.");
  }
  setInterval(): never {
    throw new Error("ManualClock.setInterval is not implemented; this test double is now-only.");
  }
  clearInterval(): never {
    throw new Error("ManualClock.clearInterval is not implemented; this test double is now-only.");
  }
  advance(deltaMs: number): void {
    this.currentMs += deltaMs;
  }
}

/** Re-wraps the same backing `driver` in a fresh storage/outbox pair — a simulated cold start, not a fresh in-memory fake. */
function reopenOutbox(driver: InMemorySqliteDriver, clock: Clock): coreComposer.OutboxController {
  const storage = new SqliteStructuredStorage({ driver });
  return createTurnOutbox(storage, clock);
}

describe("turn recovery: kill-and-restore mid-turn", () => {
  it("window 1 — before the daemon received the turn (still pending at cold start): resumes, no duplicate", async () => {
    const driver = new InMemorySqliteDriver();
    const clock = new ManualClock(1_000);
    const outbox = reopenOutbox(driver, clock);

    const entry = await outbox.enqueue({
      sessionId: "agt_t37c_w1",
      kind: "prompt",
      payload: { text: "hello" },
    });
    // Process dies here — before markSending was ever called.

    const restarted = reopenOutbox(driver, clock);
    const recovered = await recoverInFlightTurns(restarted);

    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toEqual({
      id: entry.id,
      sessionId: "agt_t37c_w1",
      kind: "prompt",
      outcome: "resumed",
      status: "pending",
    });

    // No duplicate: still exactly one entry, same stable id, unchanged payload.
    const all = await restarted.loadAll("agt_t37c_w1");
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(entry.id);
    expect(all[0]?.payload).toEqual({ text: "hello" });
  });

  it("window 2 — daemon received but did not acknowledge (sending at cold start), idempotency NOT verified: parks awaiting-confirmation, never auto-resent", async () => {
    const driver = new InMemorySqliteDriver();
    const clock = new ManualClock(1_000);
    const outbox = reopenOutbox(driver, clock);

    const entry = await outbox.enqueue({
      sessionId: "agt_t37c_w2",
      kind: "prompt",
      payload: { text: "in flight" },
    });
    await outbox.markSending(entry.id);
    // Process dies here — request may or may not have reached the daemon.

    const restarted = reopenOutbox(driver, clock);
    const recovered = await recoverInFlightTurns(restarted);

    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.outcome).toBe("awaiting-confirmation");
    expect(recovered[0]?.status).toBe("awaiting-confirmation");
    expect(recovered[0]?.id).toBe(entry.id); // same stable id, not a new entry

    const reloaded = await restarted.load(entry.id);
    expect(reloaded?.status).toBe("awaiting-confirmation");
    expect(reloaded?.lastError).toBe(TURN_RECOVERY_REASON);

    // getAutoResendCandidates never returns an awaiting-confirmation entry —
    // this is the structural guarantee against a silent duplicate resend.
    expect(await restarted.getAutoResendCandidates("agt_t37c_w2")).toEqual([]);

    // Still exactly one entry — no duplicate was created.
    expect(await restarted.loadAll("agt_t37c_w2")).toHaveLength(1);
  });

  it("window 2 — daemon received but did not acknowledge, idempotency IS verified: resumes for auto-resend", async () => {
    const driver = new InMemorySqliteDriver();
    const clock = new ManualClock(1_000);
    const outbox = reopenOutbox(driver, clock);

    const entry = await outbox.enqueue({
      sessionId: "agt_t37c_w2b",
      kind: "prompt",
      payload: { text: "in flight, verified idempotent" },
    });
    await outbox.markSending(entry.id);

    const restarted = reopenOutbox(driver, clock);
    const recovered = await recoverInFlightTurns(restarted, {
      isIdempotencyVerified: () => true,
    });

    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.outcome).toBe("resumed");
    expect(recovered[0]?.status).toBe("pending");
    expect(recovered[0]?.id).toBe(entry.id);

    const candidates = await restarted.getAutoResendCandidates("agt_t37c_w2b");
    expect(candidates.map((c) => c.id)).toEqual([entry.id]);
    expect(await restarted.loadAll("agt_t37c_w2b")).toHaveLength(1); // still just the one entry
  });

  it("window 3 — acknowledged but response not yet cached (entry already sent/removed): nothing to recover, nothing to resend", async () => {
    const driver = new InMemorySqliteDriver();
    const clock = new ManualClock(1_000);
    const outbox = reopenOutbox(driver, clock);

    const entry = await outbox.enqueue({
      sessionId: "agt_t37c_w3",
      kind: "prompt",
      payload: { text: "already acknowledged" },
    });
    await outbox.markSending(entry.id);
    await outbox.markSent(entry.id); // daemon acknowledged; outbox's job is done
    // Process dies here — before the response itself was cached
    // (./timeline-cache.ts's concern, not the outbox's).

    const restarted = reopenOutbox(driver, clock);
    const recovered = await recoverInFlightTurns(restarted);

    expect(recovered).toEqual([]); // nothing left to act on
    expect(await restarted.loadAll("agt_t37c_w3")).toEqual([]); // and definitely nothing duplicated
  });

  it("replaying recovery twice in a row is idempotent: the second pass makes no further change", async () => {
    const driver = new InMemorySqliteDriver();
    const clock = new ManualClock(1_000);
    const outbox = reopenOutbox(driver, clock);

    await outbox.enqueue({ sessionId: "agt_t37c_replay", kind: "prompt", payload: { n: 1 } });
    const sending = await outbox.enqueue({
      sessionId: "agt_t37c_replay",
      kind: "steer",
      payload: { n: 2 },
    });
    await outbox.markSending(sending.id);

    const restarted = reopenOutbox(driver, clock);
    const firstPass = await recoverInFlightTurns(restarted);
    const firstSnapshot = await restarted.loadAll("agt_t37c_replay");

    clock.advance(60_000); // a second cold start, well after the first
    const restartedAgain = reopenOutbox(driver, clock);
    const secondPass = await recoverInFlightTurns(restartedAgain);
    const secondSnapshot = await restartedAgain.loadAll("agt_t37c_replay");

    expect(secondPass).toEqual(firstPass); // identical outcomes
    expect(secondSnapshot).toEqual(firstSnapshot); // byte-identical entries — no further write occurred
  });

  it('no silent third outcome: a mixed batch of every non-terminal status all lands in a named RECOVERED_TURN_OUTCOMES value, none left "sending"', async () => {
    const driver = new InMemorySqliteDriver();
    const clock = new ManualClock(1_000);
    const outbox = reopenOutbox(driver, clock);

    const stillPending = await outbox.enqueue({
      sessionId: "agt_t37c_mixed",
      kind: "prompt",
      payload: { n: 1 },
    });
    const inFlightUnverified = await outbox.enqueue({
      sessionId: "agt_t37c_mixed",
      kind: "prompt",
      payload: { n: 2 },
    });
    await outbox.markSending(inFlightUnverified.id);
    const alreadyParked = await outbox.enqueue({
      sessionId: "agt_t37c_mixed",
      kind: "followup",
      payload: { n: 3 },
    });
    await outbox.markSending(alreadyParked.id);
    await outbox.markFailed(alreadyParked.id, "an earlier, unrelated send failure");

    const restarted = reopenOutbox(driver, clock);
    const recovered = await recoverInFlightTurns(restarted);

    expect(recovered).toHaveLength(3);
    for (const row of recovered) {
      expect(RECOVERED_TURN_OUTCOMES).toContain(row.outcome);
      expect(row.status).not.toBe("sending"); // the one status recovery must never leave behind
    }
    const byId = new Map(recovered.map((row) => [row.id, row]));
    expect(byId.get(stillPending.id)?.outcome).toBe("resumed");
    expect(byId.get(inFlightUnverified.id)?.outcome).toBe("awaiting-confirmation");
    expect(byId.get(alreadyParked.id)?.outcome).toBe("awaiting-confirmation");
    expect(byId.get(alreadyParked.id)?.status).toBe("awaiting-confirmation");
  });
});
