import { describe, expect, it } from "vitest";

import { TerminalResizeOwnership } from "./terminal-resize-ownership.js";

describe("TerminalResizeOwnership", () => {
  it("starts unowned and requests a claim first", () => {
    const ownership = new TerminalResizeOwnership();

    expect(ownership.isOwned()).toBe(false);
    expect(ownership.nextIntent()).toBe("claim");
  });

  it("switches to update after a subscribe is recorded", () => {
    const ownership = new TerminalResizeOwnership();

    ownership.markSubscribed();

    expect(ownership.isOwned()).toBe(true);
    expect(ownership.nextIntent()).toBe("update");
    // Repeated reads are idempotent (pure) and keep returning "update".
    expect(ownership.nextIntent()).toBe("update");
  });

  it("reverts to claim after a disconnect, and back to update once resubscribed", () => {
    const ownership = new TerminalResizeOwnership();
    ownership.markSubscribed();

    ownership.markDisconnected();
    expect(ownership.isOwned()).toBe(false);
    expect(ownership.nextIntent()).toBe("claim");

    ownership.markSubscribed();
    expect(ownership.nextIntent()).toBe("update");
  });

  it("markDisconnected before any subscribe is a no-op, not a crash", () => {
    const ownership = new TerminalResizeOwnership();

    ownership.markDisconnected();

    expect(ownership.isOwned()).toBe(false);
    expect(ownership.nextIntent()).toBe("claim");
  });

  /**
   * T41A4 — "resize ownership stays correct under load" (docs/issues-
   * from-plan.md). This module is a plain synchronous state holder, not
   * a queue: there is no batching or async gap between a caller's
   * `markSubscribed()`/`markDisconnected()` and `owned` changing, so
   * "under load" here means the state is never stale or averaged across
   * a rapid burst of transitions — it always reflects exactly the last
   * transition recorded, however tightly packed the burst is, and a read
   * (`isOwned()`/`nextIntent()`) never itself perturbs that state. Both
   * are proven below by mutation (see this file's PR/report for the
   * before/after run): deleting the assignment in `markDisconnected()`
   * turns the first test red immediately, and making `nextIntent()`
   * secretly flip `owned` turns the second red.
   */
  describe("under load", () => {
    it("after a rapid, tightly interleaved burst of subscribe/disconnect calls, state matches only the LAST call — never an earlier one in the burst", () => {
      const ownership = new TerminalResizeOwnership();

      // 201 alternating transitions with no gap between them (the closest
      // a single-threaded unit test can get to "concurrent" load): if any
      // transition were dropped, reordered, or coalesced, the final state
      // would not deterministically match the burst's last call. Odd
      // length so the burst ends on markSubscribed (i = 200, even).
      for (let i = 0; i < 201; i += 1) {
        if (i % 2 === 0) {
          ownership.markSubscribed();
        } else {
          ownership.markDisconnected();
        }
      }
      expect(ownership.isOwned()).toBe(true);
      expect(ownership.nextIntent()).toBe("update");

      // One more call flips it — proving the previous assertion wasn't
      // coincidentally the *only* reachable state.
      ownership.markDisconnected();
      expect(ownership.isOwned()).toBe(false);
      expect(ownership.nextIntent()).toBe("claim");
    });

    it("reading isOwned()/nextIntent() a thousand times between transitions never itself changes the state (queries have no side effects under load)", () => {
      const ownership = new TerminalResizeOwnership();
      ownership.markSubscribed();

      for (let i = 0; i < 1000; i += 1) {
        expect(ownership.nextIntent()).toBe("update");
        expect(ownership.isOwned()).toBe(true);
      }

      // Still owned after a thousand reads — a real regression here would
      // be a `nextIntent()` that mutates `owned` as a side effect (e.g. an
      // accidental toggle), which this loop would catch on its second
      // iteration.
      expect(ownership.isOwned()).toBe(true);
      expect(ownership.nextIntent()).toBe("update");

      ownership.markDisconnected();
      for (let i = 0; i < 1000; i += 1) {
        expect(ownership.nextIntent()).toBe("claim");
        expect(ownership.isOwned()).toBe(false);
      }
    });
  });
});
