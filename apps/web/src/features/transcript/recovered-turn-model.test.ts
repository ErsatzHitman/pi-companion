import { describe, expect, it } from "vitest";

import {
  composer as coreComposer,
  type Clock,
  type StructuredStorage,
} from "@picompanion/frontend-core";

import {
  confirmRecoveredTurn,
  describeRecoveredTurn,
  discardRecoveredTurn,
  selectRecoveredTurnsForSession,
  type AwaitingConfirmationEntry,
  type RecoveredTurnOutbox,
} from "./recovered-turn-model.js";

/** Now-only `Clock` double, same shape used across this repository's other model tests. */
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

/** Minimal in-memory `StructuredStorage`, local to this file (never imported from `features/composer/`, which this task does not own). */
class InMemoryStructuredStorage implements StructuredStorage {
  private readonly backing = new Map<string, unknown>();
  private key(collection: string, id: string): string {
    return `${collection}::${id}`;
  }
  async get<T>(collection: string, id: string): Promise<T | null> {
    return (this.backing.get(this.key(collection, id)) as T | undefined) ?? null;
  }
  async put<T>(collection: string, id: string, value: T): Promise<void> {
    this.backing.set(this.key(collection, id), value);
  }
  async delete(collection: string, id: string): Promise<void> {
    this.backing.delete(this.key(collection, id));
  }
  async list<T>(collection: string): Promise<T[]> {
    const prefix = `${collection}::`;
    const results: T[] = [];
    for (const [key, value] of this.backing.entries()) {
      if (key.startsWith(prefix)) results.push(value as T);
    }
    return results;
  }
  async clear(collection: string): Promise<void> {
    const prefix = `${collection}::`;
    for (const key of this.backing.keys()) {
      if (key.startsWith(prefix)) this.backing.delete(key);
    }
  }
}

function fakeEntry(overrides: Partial<coreComposer.OutboxEntry> = {}): coreComposer.OutboxEntry {
  return {
    id: "outbox_1",
    sessionId: "agt_1",
    kind: "prompt",
    payload: { text: "hi" },
    status: "awaiting-confirmation",
    createdAt: 0,
    attempts: 1,
    ...overrides,
  };
}

describe("selectRecoveredTurnsForSession", () => {
  it("returns [] for null input", () => {
    expect(selectRecoveredTurnsForSession(null, "agt_1")).toEqual([]);
  });

  it("returns [] for an empty list", () => {
    expect(selectRecoveredTurnsForSession([], "agt_1")).toEqual([]);
  });

  it("keeps only rows matching sessionId and status awaiting-confirmation", () => {
    const mine = fakeEntry({ id: "a", sessionId: "agt_1" });
    const otherSession = fakeEntry({ id: "b", sessionId: "agt_2" });
    const pending = fakeEntry({ id: "c", sessionId: "agt_1", status: "pending" });
    const sent = fakeEntry({ id: "d", sessionId: "agt_1", status: "sent" });
    expect(selectRecoveredTurnsForSession([mine, otherSession, pending, sent], "agt_1")).toEqual([
      mine,
    ]);
  });

  it("preserves input order rather than re-sorting", () => {
    const first = fakeEntry({ id: "first" });
    const second = fakeEntry({ id: "second" });
    expect(selectRecoveredTurnsForSession([second, first], "agt_1")).toEqual([second, first]);
  });
});

describe("describeRecoveredTurn", () => {
  it("returns a full sentence, never a bare status word", () => {
    const text = describeRecoveredTurn(fakeEntry() as AwaitingConfirmationEntry);
    expect(text.length).toBeGreaterThan(20);
    expect(text.endsWith(".")).toBe(true);
  });
});

function createCountingOutbox(options?: {
  confirmResendResult?: coreComposer.OutboxEntry | null;
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

describe("confirmRecoveredTurn: reaches OutboxController.confirmResend exactly once, with the turn's own id", () => {
  it("counting fake — the exact call arrives and nothing else does", async () => {
    const turn = fakeEntry({ id: "outbox_confirm_1" }) as AwaitingConfirmationEntry;
    const outbox = createCountingOutbox({
      confirmResendResult: { ...turn, status: "pending" },
    });
    const result = await confirmRecoveredTurn(outbox, turn);
    expect(outbox.calls.confirmResend).toEqual(["outbox_confirm_1"]);
    expect(outbox.calls.remove).toEqual([]);
    expect(result).toBe(true);
  });

  it("returns false when confirmResend no-ops", async () => {
    const turn = fakeEntry({ id: "outbox_confirm_2" }) as AwaitingConfirmationEntry;
    const outbox = createCountingOutbox({ confirmResendResult: null });
    const result = await confirmRecoveredTurn(outbox, turn);
    expect(result).toBe(false);
  });

  it("against the real, unmocked OutboxController: moves the SAME entry id back to pending, never enqueuing a second one and never minting a new clientMessageId", async () => {
    const clock = new FakeClock(1_000);
    const storage = new InMemoryStructuredStorage();
    const outbox = new coreComposer.OutboxController(storage, clock);
    const clientMessageId = "cmid-fixed-123";
    const entry = await outbox.enqueue({
      sessionId: "agt_confirm",
      kind: "prompt",
      payload: { text: "reaches the real outbox", clientMessageId },
    });
    await outbox.markSending(entry.id);
    await outbox.markFailed(entry.id, "network error");
    const failed = await outbox.load(entry.id);
    expect(failed?.status).toBe("awaiting-confirmation");

    const turn: AwaitingConfirmationEntry = { ...failed!, status: "awaiting-confirmation" };
    const result = await confirmRecoveredTurn(outbox, turn);
    expect(result).toBe(true);

    const reloaded = await outbox.load(entry.id);
    expect(reloaded?.status).toBe("pending");
    // Same id, same clientMessageId in the payload — the resend is the
    // SAME logical submission, not a second one.
    expect(reloaded?.id).toBe(entry.id);
    const reloadedPayload = reloaded!.payload as { clientMessageId: string };
    expect(reloadedPayload.clientMessageId).toBe(clientMessageId);

    const all = await outbox.loadAll("agt_confirm");
    expect(all).toHaveLength(1);
  });
});

describe("discardRecoveredTurn: reaches OutboxController.remove exactly once, with the turn's own id", () => {
  it("counting fake — the exact call arrives, confirmResend is never touched", async () => {
    const turn = fakeEntry({ id: "outbox_discard_1" }) as AwaitingConfirmationEntry;
    const outbox = createCountingOutbox();
    await discardRecoveredTurn(outbox, turn);
    expect(outbox.calls.remove).toEqual(["outbox_discard_1"]);
    expect(outbox.calls.confirmResend).toEqual([]);
  });

  it("against the real, unmocked OutboxController: the entry is gone afterwards, never resent", async () => {
    const clock = new FakeClock(2_000);
    const storage = new InMemoryStructuredStorage();
    const outbox = new coreComposer.OutboxController(storage, clock);
    const entry = await outbox.enqueue({
      sessionId: "agt_discard",
      kind: "prompt",
      payload: { text: "discarded, not resent" },
    });
    await outbox.markSending(entry.id);
    await outbox.markFailed(entry.id, "timed out");

    const turn: AwaitingConfirmationEntry = {
      ...(await outbox.load(entry.id))!,
      status: "awaiting-confirmation",
    };
    await discardRecoveredTurn(outbox, turn);
    expect(await outbox.load(entry.id)).toBeNull();
  });
});
