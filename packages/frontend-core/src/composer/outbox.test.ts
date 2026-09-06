import { describe, expect, it } from "vitest";
import { OutboxController } from "./outbox.js";
import { FakeClock, InMemoryStructuredStorage } from "./test-doubles.js";

describe("OutboxController", () => {
  it("enqueues an entry with a stable client submission id in the pending state", async () => {
    const controller = new OutboxController(new InMemoryStructuredStorage(), new FakeClock(100));
    const entry = await controller.enqueue({
      sessionId: "session-1",
      kind: "prompt",
      payload: { text: "hi" },
    });

    expect(entry.status).toBe("pending");
    expect(entry.sessionId).toBe("session-1");
    expect(entry.kind).toBe("prompt");
    expect(entry.attempts).toBe(0);
    expect(entry.createdAt).toBe(100);
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
  });

  it("keeps the same id across markSending/markFailed retries", async () => {
    const controller = new OutboxController(new InMemoryStructuredStorage(), new FakeClock());
    const entry = await controller.enqueue({
      sessionId: "session-1",
      kind: "prompt",
      payload: {},
    });

    const sending = await controller.markSending(entry.id);
    expect(sending?.id).toBe(entry.id);
    expect(sending?.status).toBe("sending");
    expect(sending?.attempts).toBe(1);

    const failed = await controller.markFailed(entry.id, "network error");
    expect(failed?.id).toBe(entry.id);
  });

  it("refuses automatic resend while idempotency is unverified", async () => {
    const controller = new OutboxController(new InMemoryStructuredStorage(), new FakeClock());
    const entry = await controller.enqueue({
      sessionId: "session-1",
      kind: "prompt",
      payload: {},
    });
    await controller.markSending(entry.id);
    const failed = await controller.markFailed(entry.id, "timed out");

    expect(failed?.status).toBe("awaiting-confirmation");

    const candidates = await controller.getAutoResendCandidates("session-1");
    expect(candidates.map((candidate) => candidate.id)).not.toContain(entry.id);
  });

  it("only returns to pending for an unverified failure after explicit confirmResend", async () => {
    const controller = new OutboxController(new InMemoryStructuredStorage(), new FakeClock());
    const entry = await controller.enqueue({
      sessionId: "session-1",
      kind: "steer",
      payload: {},
    });
    await controller.markFailed(entry.id, "connection dropped");

    const confirmed = await controller.confirmResend(entry.id);
    expect(confirmed?.status).toBe("pending");

    const candidates = await controller.getAutoResendCandidates("session-1");
    expect(candidates.map((candidate) => candidate.id)).toContain(entry.id);
  });

  it("confirmResend is a no-op for an entry that is not awaiting confirmation", async () => {
    const controller = new OutboxController(new InMemoryStructuredStorage(), new FakeClock());
    const entry = await controller.enqueue({
      sessionId: "session-1",
      kind: "prompt",
      payload: {},
    });

    // Entry is still "pending", never failed.
    const result = await controller.confirmResend(entry.id);
    expect(result).toBeNull();

    const stillThere = await controller.load(entry.id);
    expect(stillThere?.status).toBe("pending");
  });

  it("allows automatic resend when idempotency is explicitly verified", async () => {
    const controller = new OutboxController(new InMemoryStructuredStorage(), new FakeClock());
    const entry = await controller.enqueue({
      sessionId: "session-1",
      kind: "followup",
      payload: {},
    });
    await controller.markSending(entry.id);
    const failed = await controller.markFailed(entry.id, "server 500", {
      idempotencyVerified: true,
    });

    expect(failed?.status).toBe("pending");

    const candidates = await controller.getAutoResendCandidates("session-1");
    expect(candidates.map((candidate) => candidate.id)).toContain(entry.id);
  });

  it("removes an entry from the outbox once sent", async () => {
    const controller = new OutboxController(new InMemoryStructuredStorage(), new FakeClock());
    const entry = await controller.enqueue({
      sessionId: "session-1",
      kind: "prompt",
      payload: {},
    });
    await controller.markSent(entry.id);
    expect(await controller.load(entry.id)).toBeNull();
  });

  it("scopes loadAll and getAutoResendCandidates to a session id", async () => {
    const controller = new OutboxController(new InMemoryStructuredStorage(), new FakeClock());
    const a = await controller.enqueue({ sessionId: "session-a", kind: "prompt", payload: {} });
    const b = await controller.enqueue({ sessionId: "session-b", kind: "prompt", payload: {} });

    const scopedToA = await controller.loadAll("session-a");
    expect(scopedToA.map((entry) => entry.id)).toEqual([a.id]);

    const all = await controller.loadAll();
    expect(all.map((entry) => entry.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("survives a simulated app restart: pending entries are still queued afterward", async () => {
    const backing = new Map<string, unknown>();
    const clock = new FakeClock();
    const before = new OutboxController(new InMemoryStructuredStorage(backing), clock);
    const entry = await before.enqueue({ sessionId: "session-1", kind: "prompt", payload: {} });

    const after = new OutboxController(new InMemoryStructuredStorage(backing), new FakeClock());
    const reloaded = await after.load(entry.id);

    expect(reloaded?.status).toBe("pending");
    const candidates = await after.getAutoResendCandidates();
    expect(candidates.map((candidate) => candidate.id)).toContain(entry.id);
  });

  it("uses a caller-supplied id generator when provided", async () => {
    let counter = 0;
    const controller = new OutboxController(new InMemoryStructuredStorage(), new FakeClock(), {
      generateId: () => `fixed-${counter++}`,
    });
    const first = await controller.enqueue({ sessionId: "s", kind: "prompt", payload: {} });
    const second = await controller.enqueue({ sessionId: "s", kind: "prompt", payload: {} });
    expect(first.id).toBe("fixed-0");
    expect(second.id).toBe("fixed-1");
  });
});
