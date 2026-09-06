/**
 * Tests for `RequestArbitrator` (T47A1a, plan.md §12.3).
 *
 * Acceptance criteria exercised here (`docs/issues-from-plan.md` T47A1a):
 *
 * - "A second answer to an already-answered request resolves as
 *   superseded, not as an error and not silently" — the superseded-path
 *   describe block, plus the "distinguishable from an error and from
 *   silence" describe block.
 * - "The superseded outcome carries who answered and what was chosen,
 *   where the daemon supplies it" — the superseded-path tests assert
 *   `answeredBy` and `response` directly; the fallback describe block
 *   covers the case where the daemon does not yet supply `answeredBy`.
 * - "A fixture covers two clients answering the same request and both
 *   reaching a consistent final state" — the "two clients" describe block.
 */

import { describe, expect, it } from "vitest";
import type { Clock, TimerHandle } from "../platform/clock.js";
import type { AgentPermissionResponse } from "../permissions/types.js";
import { RequestArbitrator, type AuthoritativeResolution } from "./arbitration.js";
// The real, already-shipped steer-or-queue path (T47A1b's regression guard
// below is anchored to this, not invented): every prompt, steer, and
// follow-up is its own independent `OutboxEntry`, queued under a stable id
// that `OutboxController` alone owns.
import { OutboxController } from "../composer/outbox.js";
import { InMemoryStructuredStorage } from "../composer/test-doubles.js";

/** Deterministic, manually-advanced `Clock` (no real timers; plan.md §7.3). */
class FakeClock implements Clock {
  private time: number;

  constructor(startMs = 0) {
    this.time = startMs;
  }

  now(): number {
    return this.time;
  }

  advance(deltaMs: number): void {
    this.time += deltaMs;
  }

  setTimeout(): TimerHandle {
    throw new Error("FakeClock.setTimeout is not implemented; this test double is now-only.");
  }

  clearTimeout(): void {
    throw new Error("FakeClock.clearTimeout is not implemented; this test double is now-only.");
  }

  setInterval(): TimerHandle {
    throw new Error("FakeClock.setInterval is not implemented; this test double is now-only.");
  }

  clearInterval(): void {
    throw new Error("FakeClock.clearInterval is not implemented; this test double is now-only.");
  }
}

// Real approval/dialog answer shapes (plan.md §12.3; `../permissions/types.ts`),
// not invented — a "select"-presentation extension dialog resolves with
// exactly this `AgentPermissionResponse` shape via `buildQuestionAnswerResponse`.
const APPROVE: AgentPermissionResponse = { behavior: "allow", selectedActionId: "approve" };
const DENY: AgentPermissionResponse = { behavior: "deny", selectedActionId: "deny" };

describe("RequestArbitrator — pending and answered-locally", () => {
  it("reports pending for a request it has never seen", () => {
    const arbitrator = new RequestArbitrator<AgentPermissionResponse>({ clock: new FakeClock() });
    expect(arbitrator.getOutcome("req_1")).toEqual({ status: "pending" });
  });

  it("open() is idempotent and does not disturb an existing local answer", () => {
    const arbitrator = new RequestArbitrator<AgentPermissionResponse>({ clock: new FakeClock(10) });
    arbitrator.open("req_1");
    arbitrator.submitLocalAnswer("req_1", APPROVE);
    arbitrator.open("req_1");
    expect(arbitrator.getOutcome("req_1")).toMatchObject({
      status: "answered-locally",
      localResponse: APPROVE,
    });
  });
});

describe("RequestArbitrator — this client wins (confirmed)", () => {
  it("resolves as confirmed when answeredBy names this client's own id", () => {
    const clock = new FakeClock(100);
    const arbitrator = new RequestArbitrator<AgentPermissionResponse>({
      clock,
      selfClientId: "clid_web_1",
    });
    arbitrator.open("req_1");
    arbitrator.submitLocalAnswer("req_1", APPROVE);

    clock.advance(50);
    const outcome = arbitrator.applyResolution("req_1", {
      response: APPROVE,
      answeredBy: { clientId: "clid_web_1", label: "Web" },
    });

    expect(outcome).toEqual({
      status: "confirmed",
      response: APPROVE,
      answeredBy: { clientId: "clid_web_1", label: "Web" },
      resolvedAt: 150,
    });
    expect(arbitrator.getOutcome("req_1")).toEqual(outcome);
    expect(arbitrator.isSuperseded("req_1")).toBe(false);
    expect(arbitrator.isTerminal("req_1")).toBe(true);
  });
});

describe("RequestArbitrator — this client loses (superseded)", () => {
  it("resolves as superseded, carries who answered and what was chosen, and is not an error", () => {
    const clock = new FakeClock(200);
    const arbitrator = new RequestArbitrator<AgentPermissionResponse>({
      clock,
      selfClientId: "clid_web_1",
    });
    arbitrator.open("req_1");
    arbitrator.submitLocalAnswer("req_1", DENY);

    clock.advance(25);
    const outcome = arbitrator.applyResolution("req_1", {
      response: APPROVE,
      answeredBy: { clientId: "clid_android_9", label: "Android" },
    });

    expect(outcome.status).toBe("superseded");
    if (outcome.status !== "superseded") throw new Error("unreachable");
    // "carries who answered and what was chosen"
    expect(outcome.answeredBy).toEqual({ clientId: "clid_android_9", label: "Android" });
    expect(outcome.response).toEqual(APPROVE);
    // The losing client's own submitted answer is still visible, not discarded.
    expect(outcome.localResponse).toEqual(DENY);
    expect(outcome.resolvedAt).toBe(225);
  });

  it("superseded is a plain data value: never an Error, never null/undefined, never the 'pending' status", () => {
    const arbitrator = new RequestArbitrator<AgentPermissionResponse>({
      clock: new FakeClock(),
      selfClientId: "clid_web_1",
    });
    arbitrator.open("req_1");
    arbitrator.submitLocalAnswer("req_1", DENY);
    const outcome = arbitrator.applyResolution("req_1", {
      response: APPROVE,
      answeredBy: { clientId: "clid_android_9" },
    });

    expect(outcome).not.toBeInstanceOf(Error);
    expect(outcome).not.toBeNull();
    expect(outcome).not.toBeUndefined();
    expect(outcome.status).not.toBe("pending");
    // No "error"/"rejected" style status exists on this type at all — the
    // full literal union is enumerated in arbitration.ts's ArbitrationStatus.
    expect([
      "pending",
      "answered-locally",
      "confirmed",
      "superseded",
      "resolved-elsewhere",
    ]).toContain(outcome.status);
  });

  it("is distinguishable from silence: pending stays pending until a resolution actually arrives", () => {
    const arbitrator = new RequestArbitrator<AgentPermissionResponse>({ clock: new FakeClock() });
    arbitrator.open("req_1");
    arbitrator.submitLocalAnswer("req_1", DENY);
    // No applyResolution call yet -> still answered-locally, not superseded.
    expect(arbitrator.getOutcome("req_1").status).toBe("answered-locally");
    expect(arbitrator.isSuperseded("req_1")).toBe(false);
  });
});

describe("RequestArbitrator — resolved without a local answer", () => {
  it("resolves as resolved-elsewhere when this client never answered locally", () => {
    const arbitrator = new RequestArbitrator<AgentPermissionResponse>({
      clock: new FakeClock(300),
      selfClientId: "clid_web_1",
    });
    arbitrator.open("req_1");
    const outcome = arbitrator.applyResolution("req_1", {
      response: APPROVE,
      answeredBy: { clientId: "clid_android_9" },
    });
    expect(outcome).toEqual({
      status: "resolved-elsewhere",
      response: APPROVE,
      answeredBy: { clientId: "clid_android_9" },
      resolvedAt: 300,
    });
  });

  it("applyResolution works even without a prior open() (e.g. reconnect replay)", () => {
    const arbitrator = new RequestArbitrator<AgentPermissionResponse>({
      clock: new FakeClock(400),
    });
    const outcome = arbitrator.applyResolution("req_never_opened", { response: APPROVE });
    expect(outcome.status).toBe("resolved-elsewhere");
  });
});

describe("RequestArbitrator — terminal resolution is idempotent and always wins over local state", () => {
  it("ignores a duplicate delivery of the same resolution", () => {
    const clock = new FakeClock(500);
    const arbitrator = new RequestArbitrator<AgentPermissionResponse>({
      clock,
      selfClientId: "clid_web_1",
    });
    arbitrator.open("req_1");
    arbitrator.submitLocalAnswer("req_1", DENY);
    const first = arbitrator.applyResolution("req_1", {
      response: APPROVE,
      answeredBy: { clientId: "clid_android_9" },
    });

    clock.advance(1_000);
    const second = arbitrator.applyResolution("req_1", {
      response: APPROVE,
      answeredBy: { clientId: "clid_android_9" },
    });

    expect(second).toBe(first);
    expect(second).toEqual(first);
  });

  it("a late local answer after resolution never un-terminates the request", () => {
    const arbitrator = new RequestArbitrator<AgentPermissionResponse>({
      clock: new FakeClock(600),
      selfClientId: "clid_web_1",
    });
    arbitrator.open("req_1");
    const resolved = arbitrator.applyResolution("req_1", {
      response: APPROVE,
      answeredBy: { clientId: "clid_android_9" },
    });
    expect(resolved.status).toBe("resolved-elsewhere");

    const afterLateAnswer = arbitrator.submitLocalAnswer("req_1", DENY);
    // Returns the unchanged terminal outcome, not a fresh "answered-locally".
    expect(afterLateAnswer).toEqual(resolved);
    expect(arbitrator.getOutcome("req_1")).toEqual(resolved);
  });

  it("daemon resolution always wins even over a local answer that came first", () => {
    const arbitrator = new RequestArbitrator<AgentPermissionResponse>({
      clock: new FakeClock(700),
      selfClientId: "clid_web_1",
    });
    arbitrator.open("req_1");
    arbitrator.submitLocalAnswer("req_1", APPROVE);
    const outcome = arbitrator.applyResolution("req_1", {
      response: DENY,
      answeredBy: { clientId: "clid_android_9" },
    });
    expect(outcome.status).toBe("superseded");
    expect(outcome).toMatchObject({ response: DENY });
  });
});

describe("RequestArbitrator — fallback when the daemon does not supply answeredBy", () => {
  it("confirms when the resolution structurally matches the local answer (best-effort, documented limitation)", () => {
    const arbitrator = new RequestArbitrator<AgentPermissionResponse>({
      clock: new FakeClock(800),
      selfClientId: "clid_web_1",
    });
    arbitrator.open("req_1");
    arbitrator.submitLocalAnswer("req_1", APPROVE);
    // No answeredBy at all — the current real wire shape.
    const outcome = arbitrator.applyResolution("req_1", { response: { ...APPROVE } });
    expect(outcome.status).toBe("confirmed");
    expect(outcome).toMatchObject({ answeredBy: undefined });
  });

  it("still catches supersession when the resolution differs, even with no answeredBy", () => {
    const arbitrator = new RequestArbitrator<AgentPermissionResponse>({
      clock: new FakeClock(900),
      selfClientId: "clid_web_1",
    });
    arbitrator.open("req_1");
    arbitrator.submitLocalAnswer("req_1", DENY);
    const outcome = arbitrator.applyResolution("req_1", { response: APPROVE });
    expect(outcome.status).toBe("superseded");
    if (outcome.status !== "superseded") throw new Error("unreachable");
    expect(outcome.response).toEqual(APPROVE);
    expect(outcome.localResponse).toEqual(DENY);
    expect(outcome.answeredBy).toBeUndefined();
  });

  it("honors a custom answersEqual comparator instead of the default structural one", () => {
    const arbitrator = new RequestArbitrator<{ id: string; noise: number }>({
      clock: new FakeClock(),
      answersEqual: (a, b) => a.id === b.id,
    });
    arbitrator.open("req_1");
    arbitrator.submitLocalAnswer("req_1", { id: "x", noise: 1 });
    const outcome = arbitrator.applyResolution("req_1", { response: { id: "x", noise: 999 } });
    expect(outcome.status).toBe("confirmed");
  });
});

describe("RequestArbitrator — subscribe", () => {
  it("broadcasts every transition and stops after unsubscribe/dispose", () => {
    const arbitrator = new RequestArbitrator<AgentPermissionResponse>({ clock: new FakeClock() });
    const seen: string[] = [];
    const unsubscribe = arbitrator.subscribe((requestId, outcome) => {
      seen.push(`${requestId}:${outcome.status}`);
    });

    arbitrator.open("req_1");
    arbitrator.submitLocalAnswer("req_1", APPROVE);
    arbitrator.applyResolution("req_1", { response: APPROVE });
    expect(seen).toEqual(["req_1:pending", "req_1:answered-locally", "req_1:confirmed"]);

    unsubscribe();
    arbitrator.open("req_2");
    expect(seen).toHaveLength(3);

    const arbitrator2 = new RequestArbitrator<AgentPermissionResponse>({ clock: new FakeClock() });
    const seen2: string[] = [];
    arbitrator2.subscribe((_requestId, outcome) => seen2.push(outcome.status));
    arbitrator2.dispose();
    arbitrator2.open("req_1");
    expect(seen2).toEqual([]);
  });
});

describe("RequestArbitrator — two clients answer the same request (T47A1a two-client fixture)", () => {
  it("both clients reach a consistent final response, with distinct confirmed/superseded status each", () => {
    // Two independent connected clients, each with its own arbitrator
    // instance (mirrors two separate `DaemonClient` connections sharing one
    // session) and its own client id.
    const webClock = new FakeClock(1_000);
    const androidClock = new FakeClock(1_050); // clocks need not be in lockstep between clients
    const web = new RequestArbitrator<AgentPermissionResponse>({
      clock: webClock,
      selfClientId: "clid_web_1",
    });
    const android = new RequestArbitrator<AgentPermissionResponse>({
      clock: androidClock,
      selfClientId: "clid_android_1",
    });

    const requestId = "req_shared_1";

    // Both clients see the same daemon-broadcast permission request and
    // race to answer it, choosing *different* answers.
    web.open(requestId);
    android.open(requestId);
    web.submitLocalAnswer(requestId, APPROVE);
    android.submitLocalAnswer(requestId, DENY);

    // The daemon accepted web's answer and broadcasts one authoritative
    // resolution to both connected clients.
    const resolution: AuthoritativeResolution<AgentPermissionResponse> = {
      response: APPROVE,
      answeredBy: { clientId: "clid_web_1", label: "Web" },
    };
    const webOutcome = web.applyResolution(requestId, resolution);
    const androidOutcome = android.applyResolution(requestId, resolution);

    // Each client observes the exact outcome plan.md §12.3 requires.
    expect(webOutcome).toEqual({
      status: "confirmed",
      response: APPROVE,
      answeredBy: { clientId: "clid_web_1", label: "Web" },
      resolvedAt: 1_000,
    });
    expect(androidOutcome).toEqual({
      status: "superseded",
      localResponse: DENY,
      response: APPROVE,
      answeredBy: { clientId: "clid_web_1", label: "Web" },
      resolvedAt: 1_050,
    });

    // Both clients nonetheless converge on the same final chosen answer —
    // "a consistent final state" — even though their own status differs.
    expect(webOutcome.status).not.toBe(androidOutcome.status);
    expect((webOutcome as { response: AgentPermissionResponse }).response).toEqual(
      (androidOutcome as { response: AgentPermissionResponse }).response,
    );

    // Neither client's view of who answered is ambiguous or missing.
    expect(web.getOutcome(requestId)).toMatchObject({ answeredBy: { clientId: "clid_web_1" } });
    expect(android.getOutcome(requestId)).toMatchObject({ answeredBy: { clientId: "clid_web_1" } });

    // And the arbitration is final for both — a stray duplicate broadcast
    // (a realistic daemon-restart/reconnect replay scenario) changes nothing.
    expect(web.applyResolution(requestId, resolution)).toEqual(webOutcome);
    expect(android.applyResolution(requestId, resolution)).toEqual(androidOutcome);
  });
});

describe("RequestArbitrator — T47A1b regression guard: prompt/steer/follow-up submission is not a second arbitration path", () => {
  // The real steer-or-queue rule this guard protects lives OUTSIDE this
  // file. Client-side, `OutboxController`/`OutboxEntryKind`
  // (`../composer/outbox.ts`) queue a prompt, a steer, and a follow-up as
  // each its OWN independent submission under a stable id — never as a
  // competing "answer" to something another client already submitted.
  // Server-side, the already-active-turn branch of
  // `packages/server/src/server/agent/providers/pi/agent.ts`'s `startTurn`
  // reads that exact per-message choice (`options?.streamingBehavior`) and
  // calls `runtimeSession.steer()` or `.followUp()` (T107). Neither path
  // answers one `requestId` exactly once across clients the way this
  // module's `RequestArbitrator` does — every client's own prompt, steer,
  // or follow-up independently reaches the daemon and takes effect — which
  // is exactly why routing prompt submission through this arbitrator would
  // be wrong, not merely redundant.
  //
  // This task owns only `arbitration.ts` and its test, so it cannot reach
  // into apps/web's future per-message router (T38B1b, not yet written) to
  // prove nobody ever calls this arbitrator from there. What it CAN prove,
  // and what would actually break if a "second path" were added inside
  // this file, is that `RequestArbitrator`'s own surface stays limited to
  // answering one requestId exactly once — see the first test below. The
  // second test anchors that guard to the real outbox path, showing
  // concretely why an arbitrated model of the same mid-turn scenario would
  // be the wrong behavior.

  it("exposes only today's ten prototype members — no path exists to enqueue a new client-initiated submission", () => {
    const members = Object.getOwnPropertyNames(RequestArbitrator.prototype)
      .filter((name) => name !== "constructor")
      .sort();

    // Every one of these exists to record or resolve THIS client's answer
    // to a requestId the daemon already asked about (plan.md §12.3's
    // single-answer semantics). None of them sends, queues, or dispatches a
    // brand-new client-initiated message. If this list ever grows to
    // include something shaped like "submitPrompt", "steer", "queue",
    // "followUp", or "route*", a second path into this arbitrator has been
    // added — the exact regression T47A1b's checkbox forbids — and this
    // assertion fails by name.
    expect(members).toEqual([
      "applyResolution",
      "dispose",
      "getOutcome",
      "isSuperseded",
      "isTerminal",
      "open",
      "setEntry",
      "submitLocalAnswer",
      "subscribe",
      "won",
    ]);
  });

  it("the real steer-or-queue rule: a submission made while another client's turn is running stays independently queued, never 'superseded' by it", async () => {
    const outbox = new OutboxController(new InMemoryStructuredStorage(), new FakeClock(1_000));

    // Client A's turn is already running: its own prompt was queued
    // earlier.
    const alreadyRunningTurn = await outbox.enqueue({
      sessionId: "session-1",
      kind: "prompt",
      payload: { text: "first client's turn" },
    });

    // Client B submits WHILE that turn is running. The existing rule
    // (`../composer/outbox.ts`; server-side, T107's already-active-turn
    // branch) routes this as its own independent "steer" entry — never as
    // an answer competing with client A's submission for one accepted
    // outcome.
    const midTurnSubmission = await outbox.enqueue({
      sessionId: "session-1",
      kind: "steer",
      payload: { text: "second client's steer" },
    });

    const queued = await outbox.loadAll("session-1");
    expect(
      queued.map((entry) => ({ id: entry.id, kind: entry.kind, status: entry.status })),
    ).toEqual([
      { id: alreadyRunningTurn.id, kind: "prompt", status: "pending" },
      { id: midTurnSubmission.id, kind: "steer", status: "pending" },
    ]);

    // Contrast with an arbitrated model of the SAME scenario, to make
    // concrete why routing prompt submission through `RequestArbitrator`
    // would be wrong rather than merely unnecessary: if client A's and
    // client B's messages were (incorrectly) modeled as two answers to one
    // arbitrated identity, the second would be discarded as "superseded"
    // the instant a resolution lands — silently dropping a message that
    // must actually reach the daemon and take effect. The real outbox path
    // above never does this: both entries stayed independently "pending".
    const wronglyModeledAsOneRequest = new RequestArbitrator<{ text: string }>({
      clock: new FakeClock(),
    });
    wronglyModeledAsOneRequest.open(alreadyRunningTurn.id);
    wronglyModeledAsOneRequest.submitLocalAnswer(alreadyRunningTurn.id, {
      text: "first client's turn",
    });
    const wrongOutcome = wronglyModeledAsOneRequest.applyResolution(alreadyRunningTurn.id, {
      response: { text: "second client's steer" },
    });
    expect(wrongOutcome.status).toBe("superseded");
  });
});
