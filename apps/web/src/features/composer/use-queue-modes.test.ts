import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FakeAgentTurnClient } from "./test-doubles.js";
import { useQueueModes } from "./use-queue-modes.js";

/** Guards a `waitFor` that depends on this hook's own promise chains settling. */
const SETTLE_WAIT = { timeout: 5_000 } as const;

describe("useQueueModes", () => {
  it("starts (and stays) at 'no-client' availability without a client wired", () => {
    const { result } = renderHook(() => useQueueModes({ sessionId: "session-1" }));
    expect(result.current.availability).toBe("no-client");
    expect(result.current.steeringMode).toBeNull();
    expect(result.current.followUpMode).toBeNull();
    expect(result.current.unavailableReason).toBeTruthy();
  });

  it("reflects the daemon's current modes once loaded", async () => {
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "all", followUpMode: "one-at-a-time" };

    const { result } = renderHook(() => useQueueModes({ sessionId: "session-1", client }));

    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);
    expect(result.current.steeringMode).toBe("all");
    expect(result.current.followUpMode).toBe("one-at-a-time");
    expect(client.getQueueModesCalls).toEqual(["session-1"]);
  });

  it("reports 'unsupported' with a reason when the client omits the queue-mode methods", async () => {
    const client = new FakeAgentTurnClient();
    // Simulates every real `DaemonClient` as of P6-W6 (T110 has not landed) —
    // the same "no client yet" seam `useModelThinking`'s own test documents.
    (client as { getQueueModes?: unknown }).getQueueModes = undefined;

    const { result } = renderHook(() => useQueueModes({ sessionId: "session-1", client }));

    await waitFor(() => expect(result.current.availability).toBe("unsupported"), SETTLE_WAIT);
    expect(result.current.unavailableReason).toBeTruthy();
    expect(result.current.steeringMode).toBeNull();
    expect(result.current.followUpMode).toBeNull();
  });

  it("reports 'error' with the daemon's raw explanation when the initial fetch fails", async () => {
    const client = new FakeAgentTurnClient();
    client.getQueueModesError = "agent not found";

    const { result } = renderHook(() => useQueueModes({ sessionId: "session-1", client }));

    await waitFor(() => expect(result.current.availability).toBe("error"), SETTLE_WAIT);
    expect(result.current.unavailableReason).toBe("agent not found");
  });

  it("reflects a mode change made by a different client, with no manual refresh (T38B1a's second criterion)", async () => {
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };

    const { result } = renderHook(() => useQueueModes({ sessionId: "session-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);

    // Driven entirely by the fake's own subscription mechanism — no call
    // this hook makes itself, standing in for another connected client's
    // change arriving via the real `agent_update` push.
    client.emitQueueModes("session-1", { steeringMode: "all", followUpMode: "all" });

    await waitFor(() => expect(result.current.steeringMode).toBe("all"), SETTLE_WAIT);
    expect(result.current.followUpMode).toBe("all");
  });

  it("filters a push for a different agent id, rather than misdelivering it", async () => {
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };

    const { result } = renderHook(() => useQueueModes({ sessionId: "session-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);

    client.emitQueueModes("session-other", { steeringMode: "all", followUpMode: "all" });

    // Give any (incorrect) delivery a chance to land before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current.steeringMode).toBe("one-at-a-time");
    expect(result.current.followUpMode).toBe("one-at-a-time");
  });

  it("ignores a push entirely while the set/get trio is unsupported — no availability promotion, no value leak", async () => {
    const client = new FakeAgentTurnClient();
    (client as { getQueueModes?: unknown }).getQueueModes = undefined;

    const { result } = renderHook(() => useQueueModes({ sessionId: "session-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("unsupported"), SETTLE_WAIT);

    // Even though `onQueueModesChange` itself is still implemented on the
    // fake, a push must never manufacture "ready" out of an unsupported
    // control, nor leak mode values a disabled control has no business
    // holding — see `use-queue-modes.ts`'s own doc comment for why. This
    // is the test that actually exercises the `supported` gate on the
    // push subscription: removing `supported &&` from that gate (leaving
    // only the `onQueueModesChange` existence check) leaves `availability`
    // unaffected either way, since the push handler never touches it —
    // asserting on the mode values too is what makes this mutation-provable.
    client.emitQueueModes("session-1", { steeringMode: "all", followUpMode: "all" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current.availability).toBe("unsupported");
    expect(result.current.steeringMode).toBeNull();
    expect(result.current.followUpMode).toBeNull();
  });

  it("round-trips setSteeringMode and setFollowUpMode, re-fetching the authoritative state after each", async () => {
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };

    const { result } = renderHook(() => useQueueModes({ sessionId: "session-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);

    await result.current.setSteeringMode("all");
    await waitFor(() => expect(result.current.steeringMode).toBe("all"), SETTLE_WAIT);
    expect(client.setSteeringModeCalls).toEqual([{ agentId: "session-1", mode: "all" }]);
    // `setSteeringMode` re-fetches rather than guessing locally — proven by
    // the call count growing past the initial mount fetch.
    expect(client.getQueueModesCalls.length).toBeGreaterThanOrEqual(2);

    await result.current.setFollowUpMode("all");
    await waitFor(() => expect(result.current.followUpMode).toBe("all"), SETTLE_WAIT);
    expect(client.setFollowUpModeCalls).toEqual([{ agentId: "session-1", mode: "all" }]);
  });

  it("surfaces a provider notice returned by setSteeringMode, and does not leak it onto followUpNotice (T127)", async () => {
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };
    client.steeringNoticeToReturn = {
      type: "info",
      message: "steering mode applies from the next turn",
    };

    const { result } = renderHook(() => useQueueModes({ sessionId: "session-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);
    expect(result.current.steeringNotice).toBeNull();
    expect(result.current.followUpNotice).toBeNull();

    await result.current.setSteeringMode("all");

    await waitFor(
      () =>
        expect(result.current.steeringNotice).toEqual({
          type: "info",
          message: "steering mode applies from the next turn",
        }),
      SETTLE_WAIT,
    );
    expect(result.current.followUpNotice).toBeNull();
  });

  it("surfaces a provider notice returned by setFollowUpMode", async () => {
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };
    client.followUpNoticeToReturn = {
      type: "warning",
      message: "follow-up mode applies from the next turn",
    };

    const { result } = renderHook(() => useQueueModes({ sessionId: "session-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);

    await result.current.setFollowUpMode("all");

    await waitFor(
      () =>
        expect(result.current.followUpNotice).toEqual({
          type: "warning",
          message: "follow-up mode applies from the next turn",
        }),
      SETTLE_WAIT,
    );
    expect(result.current.steeringNotice).toBeNull();
  });

  it("carries a `null` notice as `null` — the common case, since the daemon attaches one only sometimes", async () => {
    const client = new FakeAgentTurnClient();
    client.queueModes = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };
    // `steeringNoticeToReturn`/`followUpNoticeToReturn` default to `null`.

    const { result } = renderHook(() => useQueueModes({ sessionId: "session-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);

    await result.current.setSteeringMode("all");
    await waitFor(() => expect(result.current.steeringMode).toBe("all"), SETTLE_WAIT);
    expect(result.current.steeringNotice).toBeNull();
  });

  it("surfaces the daemon's raw explanation when a change is rejected", async () => {
    const client = new FakeAgentTurnClient();
    client.setSteeringModeError = "provider rejected the mode change";

    const { result } = renderHook(() => useQueueModes({ sessionId: "session-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);

    await result.current.setSteeringMode("all");
    await waitFor(
      () => expect(result.current.changeError).toBe("provider rejected the mode change"),
      SETTLE_WAIT,
    );
    // The rejected change did not apply.
    expect(result.current.steeringMode).toBe("one-at-a-time");
  });
});
