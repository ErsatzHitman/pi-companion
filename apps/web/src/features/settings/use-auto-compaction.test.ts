import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DAEMON_DEFAULT_AUTO_COMPACTION_ENABLED } from "./settings-client.js";
import { FakeSettingsClient, UnsupportedSettingsClient } from "./test-doubles.js";
import { useAutoCompaction } from "./use-auto-compaction.js";

const SETTLE_WAIT = { timeout: 5_000 } as const;

describe("useAutoCompaction", () => {
  it("starts (and stays) at 'no-client' availability without a client wired", () => {
    const { result } = renderHook(() => useAutoCompaction({ agentId: "agent-1" }));
    expect(result.current.availability).toBe("no-client");
    expect(result.current.enabled).toBeNull();
    expect(result.current.unavailableReason).toBeTruthy();
  });

  it("reports 'unsupported' with a reason when the client omits the get/set pair — the real DaemonClient shape today", async () => {
    const client = new UnsupportedSettingsClient();
    const { result } = renderHook(() => useAutoCompaction({ agentId: "agent-1", client }));

    await waitFor(() => expect(result.current.availability).toBe("unsupported"), SETTLE_WAIT);
    expect(result.current.unavailableReason).toBeTruthy();
    expect(result.current.enabled).toBeNull();
  });

  it("loads the daemon's default value, matching Pi's real default (fake-pi.ts:166)", async () => {
    const client = new FakeSettingsClient({
      autoCompactionEnabled: DAEMON_DEFAULT_AUTO_COMPACTION_ENABLED,
    });
    const { result } = renderHook(() => useAutoCompaction({ agentId: "agent-1", client }));

    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);
    expect(result.current.enabled).toBe(true);
    expect(client.getAutoCompactionCalls).toEqual(["agent-1"]);
  });

  it("round-trips a change through the real path: the fake's own internal state changes, and a re-fetch confirms it", async () => {
    const client = new FakeSettingsClient({ autoCompactionEnabled: true });
    const { result } = renderHook(() => useAutoCompaction({ agentId: "agent-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);

    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(client.setAutoCompactionCalls).toEqual([{ agentId: "agent-1", enabled: false }]);
    // Two get calls: the initial load, plus the post-set re-fetch — never a
    // locally-guessed value, per this hook's own doc comment.
    expect(client.getAutoCompactionCalls).toEqual(["agent-1", "agent-1"]);
    expect(result.current.enabled).toBe(false);
    expect(result.current.changeError).toBeNull();
  });

  it("surfaces a change failure without mutating the displayed value", async () => {
    const client = new FakeSettingsClient({ autoCompactionEnabled: true });
    client.setAutoCompaction = async () => {
      throw new Error("daemon refused the change");
    };
    const { result } = renderHook(() => useAutoCompaction({ agentId: "agent-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);

    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(result.current.changeError).toBe("daemon refused the change");
    expect(result.current.enabled).toBe(true);
  });
});
