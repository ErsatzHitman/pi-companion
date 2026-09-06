import type { Clock, TimerHandle } from "@picompanion/frontend-core";
import { describe, expect, it } from "vitest";

import { decideTerminalResizeOwnership } from "./terminal-resize-ownership-model";
import { TerminalResizeController, type TerminalResizeClaim } from "./terminal-resize-controller";

/** Deterministic, manually-advanced `Clock` test double, local to this file. */
class FakeClock implements Clock {
  private currentTime = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { dueAt: number; callback: () => void }>();

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { dueAt: this.currentTime + delayMs, callback });
    return id as unknown as TimerHandle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }

  setInterval(): TimerHandle {
    throw new Error("not used");
  }

  clearInterval(): void {
    throw new Error("not used");
  }

  advance(ms: number): void {
    this.currentTime += ms;
    const due = [...this.timers.entries()]
      .filter(([, t]) => t.dueAt <= this.currentTime)
      .sort((a, b) => a[1].dueAt - b[1].dueAt);
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
  }
}

describe("decideTerminalResizeOwnership — daemon ownership model", () => {
  it("a claim from a fresh terminal (no owner yet) always wins", () => {
    const clientA = {};
    const decision = decideTerminalResizeOwnership(null, { requester: clientA, intent: "claim" });
    expect(decision).toEqual({ applied: true, owner: clientA });
  });

  it("a claim wins even when another client already owns the terminal — 'a claim that wins'", () => {
    const clientA = {};
    const clientB = {};
    const decision = decideTerminalResizeOwnership(clientA, {
      requester: clientB,
      intent: "claim",
    });
    expect(decision).toEqual({ applied: true, owner: clientB }); // ownership evicted from A to B
  });

  it("an update from a non-owner is rejected outright — 'a claim that loses'", () => {
    const clientA = {};
    const clientB = {};
    const decision = decideTerminalResizeOwnership(clientA, {
      requester: clientB,
      intent: "update",
    });
    expect(decision).toEqual({ applied: false, owner: clientA }); // untouched
  });

  it("an update from the current owner succeeds and does not change ownership", () => {
    const clientA = {};
    const decision = decideTerminalResizeOwnership(clientA, {
      requester: clientA,
      intent: "update",
    });
    expect(decision).toEqual({ applied: true, owner: clientA });
  });

  it("an owner that disconnects loses the terminal to the very next claim from anyone — no explicit release needed", () => {
    const clientA = {};
    const clientC = {};
    // clientA claimed, then "disconnected" — modeled as simply never
    // being referenced again. The daemon's WeakMap entry is left
    // pointing at it (nothing clears it on disconnect); the next claim
    // from an unrelated client still wins unconditionally.
    const afterInitialClaim = decideTerminalResizeOwnership(null, {
      requester: clientA,
      intent: "claim",
    });
    expect(afterInitialClaim.owner).toBe(clientA);

    const afterDisconnectAndNewClaim = decideTerminalResizeOwnership(afterInitialClaim.owner, {
      requester: clientC,
      intent: "claim",
    });
    expect(afterDisconnectAndNewClaim).toEqual({ applied: true, owner: clientC });
  });

  it("an update attempted by the disconnected former owner, after eviction, is rejected", () => {
    const clientA = {};
    const clientC = {};
    const ownerAfterEviction = decideTerminalResizeOwnership(clientA, {
      requester: clientC,
      intent: "claim",
    }).owner;

    const staleUpdateFromA = decideTerminalResizeOwnership(ownerAfterEviction, {
      requester: clientA,
      intent: "update",
    });
    expect(staleUpdateFromA).toEqual({ applied: false, owner: clientC });
  });
});

describe("TerminalResizeController's real claims against the ownership model — 'matches daemon behaviour'", () => {
  const READY = { isVisible: true, isConnected: true, isTerminalReady: true };

  it("this client's own emitted claim always evicts whatever the current owner is, exactly as the daemon would honor it", () => {
    const clock = new FakeClock();
    const claims: TerminalResizeClaim[] = [];
    const controller = new TerminalResizeController({
      debounceMs: 100,
      clock,
      onClaim: (claim) => claims.push(claim),
    });
    const thisAndroidClient = {}; // this controller's own identity, from the daemon's point of view
    const otherBrowserTab = {}; // a second, unrelated client already owning the terminal

    controller.setReadiness(READY);
    controller.setSize({ rows: 40, cols: 120 });
    clock.advance(100);
    expect(claims).toHaveLength(1);
    expect(claims[0].intent).toBe("claim"); // the only intent this controller ever emits

    const decision = decideTerminalResizeOwnership(otherBrowserTab, {
      requester: thisAndroidClient,
      intent: claims[0].intent,
    });
    expect(decision).toEqual({ applied: true, owner: thisAndroidClient });
  });

  it("a hypothetical 'update' built from this controller's vocabulary would be rejected while another client owns the terminal — why this controller never sends one", () => {
    // TerminalResizeClaim's `intent` field carries the full wire
    // vocabulary (`"claim" | "update"`) per terminal-resize-controller.ts's
    // own module doc, even though this single-owner screen only ever
    // constructs a `"claim"`. This proves *why*: an `"update"` built the
    // same way, from a client that isn't the current owner, is exactly
    // the request the daemon's ownership rule rejects.
    const thisAndroidClient = {};
    const otherBrowserTab = {};
    const hypotheticalUpdate = decideTerminalResizeOwnership(otherBrowserTab, {
      requester: thisAndroidClient,
      intent: "update",
    });
    expect(hypotheticalUpdate).toEqual({ applied: false, owner: otherBrowserTab });
  });

  it("after a reconnect, this client's re-claim (lastClaimedSize reset — T35B1) still wins ownership back even if another client claimed while it was away", () => {
    const clock = new FakeClock();
    const claims: TerminalResizeClaim[] = [];
    const controller = new TerminalResizeController({
      debounceMs: 100,
      clock,
      onClaim: (claim) => claims.push(claim),
    });
    const thisAndroidClient = {};
    const otherBrowserTab = {};

    controller.setReadiness(READY);
    controller.setSize({ rows: 24, cols: 80 });
    clock.advance(100);
    expect(claims).toHaveLength(1);
    let owner = decideTerminalResizeOwnership(null, {
      requester: thisAndroidClient,
      intent: claims[0].intent,
    }).owner;
    expect(owner).toBe(thisAndroidClient);

    // This client disconnects and reconnects; meanwhile another client
    // claims the (now-idle) terminal.
    controller.setReadiness({ ...READY, isConnected: false });
    owner = decideTerminalResizeOwnership(owner, {
      requester: otherBrowserTab,
      intent: "claim",
    }).owner;
    expect(owner).toBe(otherBrowserTab);

    // This client reconnects. T35B1's reconnect rule clears
    // `lastClaimedSize`, so the identical size re-claims even though it
    // never changed — see terminal-resize-controller.test.ts's own
    // "re-claims an identical size after a reconnect" for that half.
    controller.setReadiness(READY);
    clock.advance(100);
    expect(claims).toHaveLength(2);
    expect(claims[1]).toEqual({ rows: 24, cols: 80, intent: "claim" });

    const finalDecision = decideTerminalResizeOwnership(owner, {
      requester: thisAndroidClient,
      intent: claims[1].intent,
    });
    // The reconnect's re-claim wins ownership back from the other client
    // — matching the daemon's unconditional claim-always-wins rule.
    expect(finalDecision).toEqual({ applied: true, owner: thisAndroidClient });
  });
});
