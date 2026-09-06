import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AgentSettingsPanel } from "./AgentSettingsPanel.js";
import type { SettingsClient } from "./settings-client.js";
import { FakeSettingsClient, UnsupportedSettingsClient } from "./test-doubles.js";
import { useAutoCompaction } from "./use-auto-compaction.js";
import { useAutoRetry } from "./use-auto-retry.js";

afterEach(cleanup);

const SETTLE_WAIT = { timeout: 5_000 } as const;

/** Wires both hooks the way a real screen eventually would (this task's own scope is `features/settings/` only — see this file's module doc for the disclosed route-wiring gap). */
function Harness({
  agentId,
  client,
  testId,
}: {
  agentId: string;
  client?: SettingsClient;
  testId: string;
}) {
  const autoCompaction = useAutoCompaction({ agentId, client });
  const autoRetry = useAutoRetry({ agentId, client });
  return (
    <AgentSettingsPanel autoCompaction={autoCompaction} autoRetry={autoRetry} testId={testId} />
  );
}

describe("AgentSettingsPanel", () => {
  it("renders the unsupported state truthfully — disabled switches plus a visible explanation — for a client that omits both settings (today's real DaemonClient shape)", async () => {
    render(
      <Harness agentId="agent-1" client={new UnsupportedSettingsClient()} testId="settings" />,
    );

    const compactionToggle = await screen.findByTestId("settings-auto-compaction-toggle");
    const retryToggle = screen.getByTestId("settings-auto-retry-toggle");

    await waitFor(() => {
      expect(compactionToggle.hasAttribute("disabled")).toBe(true);
      expect(retryToggle.hasAttribute("disabled")).toBe(true);
    }, SETTLE_WAIT);

    expect(compactionToggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("settings-auto-compaction-status").textContent).toMatch(
      /cannot change/i,
    );
    expect(screen.getByTestId("settings-auto-retry-status").textContent).toMatch(/always retries/i);
  });

  it("flips aria-checked in the DOM the instant a change round-trips, with no reload", async () => {
    const client = new FakeSettingsClient({ autoCompactionEnabled: true, autoRetryEnabled: true });
    render(<Harness agentId="agent-1" client={client} testId="settings" />);

    const compactionToggle = await screen.findByTestId("settings-auto-compaction-toggle");
    await waitFor(
      () => expect(compactionToggle.getAttribute("aria-checked")).toBe("true"),
      SETTLE_WAIT,
    );

    await act(async () => {
      fireEvent.click(compactionToggle);
      // Let the hook's set-then-refetch promise chain resolve.
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(
      () => expect(compactionToggle.getAttribute("aria-checked")).toBe("false"),
      SETTLE_WAIT,
    );
    expect(client.setAutoCompactionCalls).toEqual([{ agentId: "agent-1", enabled: false }]);
  });

  it("leaves the other row untouched when only one setting changes", async () => {
    const client = new FakeSettingsClient({ autoCompactionEnabled: true, autoRetryEnabled: true });
    render(<Harness agentId="agent-1" client={client} testId="settings" />);

    const compactionToggle = await screen.findByTestId("settings-auto-compaction-toggle");
    const retryToggle = screen.getByTestId("settings-auto-retry-toggle");
    await waitFor(
      () => expect(compactionToggle.getAttribute("aria-checked")).toBe("true"),
      SETTLE_WAIT,
    );

    await act(async () => {
      fireEvent.click(compactionToggle);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(retryToggle.getAttribute("aria-checked")).toBe("true");
    expect(client.setAutoRetryCalls).toEqual([]);
  });
});
