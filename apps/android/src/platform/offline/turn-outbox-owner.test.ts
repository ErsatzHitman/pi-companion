/**
 * Proves T76's acceptance criteria for `TurnOutboxOwner`
 * (`./turn-outbox-owner.ts`) — the production caller
 * `createTurnOutbox`/`recoverInFlightTurns` (T37C) never had:
 *
 * 1. Construction, degraded-state, and disposal mirror
 *    `OfflineCacheOwner`'s own proven shape (T68) — proven the same way
 *    that file's own test suite does, over the real, shared
 *    `SqliteStructuredStorage`/`InMemorySqliteDriver`, never a
 *    reimplementation.
 * 2. `open()` genuinely runs the one cold-start `recoverInFlightTurns`
 *    pass — by the time it resolves `"ready"`, a pre-existing "sending"
 *    row (simulating a process death mid-turn) has already reconciled
 *    to `"awaiting-confirmation"`, and `getOutbox()`/
 *    `getRecoveredTurns()` both report the same real, persisted state.
 * 3. A "process death" is simulated exactly the way
 *    `in-memory-sqlite-driver.ts`'s own doc comment describes: two
 *    owners built over two `InMemorySqliteDriver` instances sharing one
 *    backing array — state written before "restart" is still readable
 *    (and recoverable) after.
 * 4. No real SQLite file is opened: `createUnavailableSqliteDriverFactory()`
 *    lands this owner in `"degraded"` too, identically to
 *    `OfflineCacheOwner`.
 */
import type { Clock } from "@picompanion/frontend-core";
import { describe, expect, it, vi } from "vitest";

import { InMemorySqliteDriver } from "./in-memory-sqlite-driver.js";
import { createTurnOutboxOwner, TurnOutboxOwner } from "./turn-outbox-owner.js";
import type { SqliteDriver } from "./sqlite-driver.js";
import { createUnavailableSqliteDriverFactory } from "./sqlite-driver-factory.js";
import { createTurnOutbox, TURN_RECOVERY_REASON } from "./turn-recovery.js";

/** Minimal `Clock` double — same "now-only, everything else throws loudly" shape `offline-cache-owner.test.ts`'s own `FakeClock` uses. */
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

function makeDriverFactory(): { driver: InMemorySqliteDriver; open: () => Promise<SqliteDriver> } {
  const driver = new InMemorySqliteDriver();
  return { driver, open: () => Promise.resolve(driver) };
}

describe("TurnOutboxOwner: construction, lifecycle, and disposal", () => {
  it("constructs a real, working OutboxController reachable via getOutbox() once open() resolves ready", async () => {
    const { open } = makeDriverFactory();
    const owner = createTurnOutboxOwner({ driverFactory: { open }, clock: new FakeClock(1_000) });

    const status = await owner.open();
    expect(status).toEqual({ kind: "ready" });
    expect(owner.getStatus()).toEqual({ kind: "ready" });

    const outbox = owner.getOutbox();
    expect(outbox).not.toBeNull();
    const entry = await outbox?.enqueue({
      sessionId: "s1",
      kind: "prompt",
      payload: { text: "hello" },
    });
    expect(entry?.status).toBe("pending");
    expect(owner.getRecoveredTurns()).toEqual([]);

    await owner.dispose();
  });

  it("opens the driver at most once even when open() is called concurrently and repeatedly", async () => {
    const driver = new InMemorySqliteDriver();
    const openSpy = vi.fn(() => Promise.resolve(driver as SqliteDriver));
    const owner = createTurnOutboxOwner({
      driverFactory: { open: openSpy },
      clock: new FakeClock(1),
    });

    const [a, b, c] = await Promise.all([owner.open(), owner.open(), owner.open()]);
    expect(a).toEqual({ kind: "ready" });
    expect(b).toEqual({ kind: "ready" });
    expect(c).toEqual({ kind: "ready" });
    expect(openSpy).toHaveBeenCalledTimes(1);

    await owner.open();
    expect(openSpy).toHaveBeenCalledTimes(1);

    await owner.dispose();
  });

  it("disposal actually reaches the driver's closeAsync, and getOutbox()/getRecoveredTurns() return null forever after", async () => {
    const { driver, open } = makeDriverFactory();
    const owner = createTurnOutboxOwner({ driverFactory: { open }, clock: new FakeClock(1) });
    await owner.open();
    expect(driver.isClosed).toBe(false);

    await owner.dispose();

    expect(driver.isClosed).toBe(true);
    expect(owner.getStatus()).toEqual({ kind: "disposed" });
    expect(owner.getOutbox()).toBeNull();
    expect(owner.getRecoveredTurns()).toBeNull();
  });

  it("dispose() is idempotent: a second call never calls closeAsync twice", async () => {
    const { driver, open } = makeDriverFactory();
    const closeSpy = vi.spyOn(driver, "closeAsync");
    const owner = createTurnOutboxOwner({ driverFactory: { open }, clock: new FakeClock(1) });
    await owner.open();

    await owner.dispose();
    await owner.dispose();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("dispose() called before open() ever resolves still closes the driver once it does, and never constructs a reachable outbox", async () => {
    const { driver } = makeDriverFactory();
    let resolveOpen!: (d: SqliteDriver) => void;
    const openPromise = new Promise<SqliteDriver>((resolve) => {
      resolveOpen = resolve;
    });
    const owner = createTurnOutboxOwner({
      driverFactory: { open: () => openPromise },
      clock: new FakeClock(1),
    });

    const opening = owner.open();
    const disposing = owner.dispose();
    resolveOpen(driver);
    await Promise.all([opening, disposing]);

    expect(owner.getStatus()).toEqual({ kind: "disposed" });
    expect(owner.getOutbox()).toBeNull();
    expect(driver.isClosed).toBe(true);
  });
});

describe("TurnOutboxOwner: degraded state when storage cannot be opened", () => {
  it("open() never throws when the driver factory rejects — it resolves a named degraded status instead", async () => {
    const owner = createTurnOutboxOwner({
      driverFactory: { open: () => Promise.reject(new Error("disk full")) },
      clock: new FakeClock(1),
    });

    const status = await owner.open();
    expect(status).toEqual({ kind: "degraded", reason: "disk full" });
    expect(owner.getOutbox()).toBeNull();
    expect(owner.getRecoveredTurns()).toBeNull();

    await expect(owner.dispose()).resolves.toBeUndefined();
    expect(owner.getStatus()).toEqual({ kind: "disposed" });
  });

  it("production's createUnavailableSqliteDriverFactory lands the owner in degraded — no real SQLite file is opened", async () => {
    const owner = createTurnOutboxOwner({
      driverFactory: createUnavailableSqliteDriverFactory(),
      clock: new FakeClock(1),
    });

    const status = await owner.open();
    expect(status.kind).toBe("degraded");
    if (status.kind === "degraded") {
      expect(status.reason).toMatch(/native ExpoSQLite module is not available/);
      expect(status.reason).toMatch(/no real SQLite file was opened/);
    }
    expect(owner.getOutbox()).toBeNull();
    await owner.dispose();
  });
});

describe("TurnOutboxOwner: two constructions for the same scope are prevented", () => {
  it("constructing a second owner for a scope with an undisposed owner throws synchronously", async () => {
    const { open: openA } = makeDriverFactory();
    const ownerA = createTurnOutboxOwner({
      driverFactory: { open: openA },
      clock: new FakeClock(1),
      scope: "shared",
    });

    const { open: openB } = makeDriverFactory();
    expect(() =>
      createTurnOutboxOwner({
        driverFactory: { open: openB },
        clock: new FakeClock(1),
        scope: "shared",
      }),
    ).toThrow(/scope "shared" already has an undisposed owner/);

    await ownerA.dispose();
  });

  it("a scope frees up for reconstruction once its owner is disposed", async () => {
    const { open: openA } = makeDriverFactory();
    const ownerA = createTurnOutboxOwner({
      driverFactory: { open: openA },
      clock: new FakeClock(1),
      scope: "reusable",
    });
    await ownerA.open();
    await ownerA.dispose();

    const { open: openB } = makeDriverFactory();
    const ownerB = createTurnOutboxOwner({
      driverFactory: { open: openB },
      clock: new FakeClock(2),
      scope: "reusable",
    });
    const status = await ownerB.open();
    expect(status).toEqual({ kind: "ready" });

    await ownerB.dispose();
  });
});

describe("TurnOutboxOwner: class export matches the factory", () => {
  it("new TurnOutboxOwner(...) behaves identically to createTurnOutboxOwner(...)", async () => {
    const { open } = makeDriverFactory();
    const owner = new TurnOutboxOwner({
      driverFactory: { open },
      clock: new FakeClock(1),
      scope: "direct-construction",
    });
    const status = await owner.open();
    expect(status).toEqual({ kind: "ready" });
    await owner.dispose();
  });
});

/**
 * The acceptance criterion this task exists for: "a recovered in-flight
 * turn actually arrives ... proven by the value" — proven here one
 * layer below `core.ts`'s daemon-transport wiring
 * (`core.test.ts`'s own "AppCore.turnOutbox (T76)" suite proves the
 * rest of the chain: a `"resumed"` row's real text reaching a fake
 * `DaemonClient.sendMessage` and, from there, a scripted daemon echo
 * landing in a `TranscriptMessageBatcher`).
 */
describe("TurnOutboxOwner: recoverInFlightTurns actually runs during open() — simulated process death", () => {
  it("a row left 'sending' before the simulated kill reconciles to awaiting-confirmation, reachable via both getOutbox() and getRecoveredTurns()", async () => {
    // Shared backing array — two InMemorySqliteDriver instances over it
    // simulate "the SQLite file survives the process death, the JS
    // process does not" (in-memory-sqlite-driver.ts's own doc comment).
    const backing: ConstructorParameters<typeof InMemorySqliteDriver>[0] = [];
    const beforeKillDriver = new InMemorySqliteDriver(backing);
    const { SqliteStructuredStorage } = await import("./sqlite-structured-storage.js");
    const storage = new SqliteStructuredStorage({ driver: beforeKillDriver });
    const outboxBeforeKill = createTurnOutbox(storage, new FakeClock(1_000));
    const entry = await outboxBeforeKill.enqueue({
      sessionId: "agt_death",
      kind: "prompt",
      payload: { text: "message in flight when the process died" },
    });
    // The turn reached "sending" (daemon receipt unconfirmed) before the
    // simulated kill — window 2 in turn-recovery.ts's own doc comment.
    await outboxBeforeKill.markSending(entry.id);

    // "Restart": a fresh TurnOutboxOwner over a fresh InMemorySqliteDriver
    // sharing the same backing array — the JS process is gone, the rows
    // are not.
    const afterKillDriver = new InMemorySqliteDriver(backing);
    const owner = createTurnOutboxOwner({
      driverFactory: { open: () => Promise.resolve(afterKillDriver) },
      clock: new FakeClock(2_000),
    });

    const status = await owner.open();
    expect(status).toEqual({ kind: "ready" });

    // getRecoveredTurns(): the recovery pass's own report.
    const recovered = owner.getRecoveredTurns();
    expect(recovered).toEqual([
      {
        id: entry.id,
        sessionId: "agt_death",
        kind: "prompt",
        outcome: "awaiting-confirmation",
        status: "awaiting-confirmation",
      },
    ]);

    // getOutbox(): the same reconciliation, independently confirmed
    // through the real, persisted OutboxController — not merely the
    // in-memory report object.
    const reloaded = await owner.getOutbox()?.load(entry.id);
    expect(reloaded?.status).toBe("awaiting-confirmation");
    expect(reloaded?.lastError).toBe(TURN_RECOVERY_REASON);
    // Never silently resent: getAutoResendCandidates() (the "safe to
    // resend automatically" set every mount site reads) does not
    // include it.
    const candidates = await owner.getOutbox()?.getAutoResendCandidates();
    expect(candidates).toEqual([]);

    await owner.dispose();
  });

  it("a row that never reached 'sending' before the kill (window 1) reconciles to resumed, and getAutoResendCandidates() includes it", async () => {
    const backing: ConstructorParameters<typeof InMemorySqliteDriver>[0] = [];
    const beforeKillDriver = new InMemorySqliteDriver(backing);
    const { SqliteStructuredStorage } = await import("./sqlite-structured-storage.js");
    const storage = new SqliteStructuredStorage({ driver: beforeKillDriver });
    const outboxBeforeKill = createTurnOutbox(storage, new FakeClock(1_000));
    const entry = await outboxBeforeKill.enqueue({
      sessionId: "agt_death2",
      kind: "prompt",
      payload: { text: "queued but never even sent before the kill" },
    });
    // No markSending() call — the process died before the send attempt
    // ever started (window 1).

    const afterKillDriver = new InMemorySqliteDriver(backing);
    const owner = createTurnOutboxOwner({
      driverFactory: { open: () => Promise.resolve(afterKillDriver) },
      clock: new FakeClock(2_000),
    });
    await owner.open();

    expect(owner.getRecoveredTurns()).toEqual([
      {
        id: entry.id,
        sessionId: "agt_death2",
        kind: "prompt",
        outcome: "resumed",
        status: "pending",
      },
    ]);

    const candidates = await owner.getOutbox()?.getAutoResendCandidates();
    expect(candidates?.map((c) => c.id)).toEqual([entry.id]);
    expect((candidates?.[0]?.payload as { text: string }).text).toBe(
      "queued but never even sent before the kill",
    );

    await owner.dispose();
  });

  it("replaying recovery across a second simulated restart is a no-op — an already-recovered row stays byte-identical", async () => {
    const backing: ConstructorParameters<typeof InMemorySqliteDriver>[0] = [];
    const beforeKillDriver = new InMemorySqliteDriver(backing);
    const { SqliteStructuredStorage } = await import("./sqlite-structured-storage.js");
    const storage = new SqliteStructuredStorage({ driver: beforeKillDriver });
    const outboxBeforeKill = createTurnOutbox(storage, new FakeClock(1_000));
    const entry = await outboxBeforeKill.enqueue({
      sessionId: "agt_death3",
      kind: "prompt",
      payload: { text: "in flight" },
    });
    await outboxBeforeKill.markSending(entry.id);

    const firstRestartDriver = new InMemorySqliteDriver(backing);
    const firstOwner = createTurnOutboxOwner({
      driverFactory: { open: () => Promise.resolve(firstRestartDriver) },
      clock: new FakeClock(2_000),
    });
    await firstOwner.open();
    const afterFirstRecovery = await firstOwner.getOutbox()?.load(entry.id);
    await firstOwner.dispose();

    const secondRestartDriver = new InMemorySqliteDriver(backing);
    const secondOwner = createTurnOutboxOwner({
      driverFactory: {
        open: () => Promise.resolve(secondRestartDriver),
      },
      clock: new FakeClock(3_000),
    });
    await secondOwner.open();
    const afterSecondRecovery = await secondOwner.getOutbox()?.load(entry.id);

    expect(afterSecondRecovery).toEqual(afterFirstRecovery);
    await secondOwner.dispose();
  });
});
