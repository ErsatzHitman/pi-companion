import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FakeSettingsClient, UnsupportedSettingsClient } from "./test-doubles.js";
import { useAutoRetry } from "./use-auto-retry.js";

const SETTLE_WAIT = { timeout: 5_000 } as const;

describe("useAutoRetry", () => {
  it("starts (and stays) at 'no-client' availability without a client wired", () => {
    const { result } = renderHook(() => useAutoRetry({ agentId: "agent-1" }));
    expect(result.current.availability).toBe("no-client");
    expect(result.current.enabled).toBeNull();
    expect(result.current.unavailableReason).toBeTruthy();
  });

  it("reports 'unsupported' with a reason explaining there is no off-switch today — the real daemon shape", async () => {
    const client = new UnsupportedSettingsClient();
    const { result } = renderHook(() => useAutoRetry({ agentId: "agent-1", client }));

    await waitFor(() => expect(result.current.availability).toBe("unsupported"), SETTLE_WAIT);
    expect(result.current.unavailableReason).toMatch(/always retries/i);
    expect(result.current.enabled).toBeNull();
  });

  it("loads the daemon's current value when a client implements the pair", async () => {
    const client = new FakeSettingsClient({ autoRetryEnabled: true });
    const { result } = renderHook(() => useAutoRetry({ agentId: "agent-1", client }));

    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);
    expect(result.current.enabled).toBe(true);
    expect(client.getAutoRetryCalls).toEqual(["agent-1"]);
  });

  it("round-trips a change through the real path: the fake's own internal state changes, and a re-fetch confirms it", async () => {
    const client = new FakeSettingsClient({ autoRetryEnabled: true });
    const { result } = renderHook(() => useAutoRetry({ agentId: "agent-1", client }));
    await waitFor(() => expect(result.current.availability).toBe("ready"), SETTLE_WAIT);

    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(client.setAutoRetryCalls).toEqual([{ agentId: "agent-1", enabled: false }]);
    expect(client.getAutoRetryCalls).toEqual(["agent-1", "agent-1"]);
    expect(result.current.enabled).toBe(false);
    expect(result.current.changeError).toBeNull();
  });
});
