import { describe, expect, it } from "vitest";
import { DaemonClient } from "@picompanion/client";

import { createDaemonSettingsClient } from "./daemon-settings-client.js";

/**
 * Proves this feature's "renders truthfully" acceptance criterion against
 * the REAL, unmodified `@picompanion/client` `DaemonClient` class — not a
 * hand-rolled stand-in — following `daemon-agent-turn-client.fixture.test.ts`'s
 * "exercise against the real class" convention.
 *
 * **T131 UPDATE**: auto-compaction now has a real wire (`set_auto_compaction_request`/
 * `get_auto_compaction_request`, `packages/protocol/src/messages.ts`) and real
 * `DaemonClient.setAutoCompaction`/`getAutoCompaction` methods
 * (`packages/client/src/daemon-client.ts`), so the two assertions below that
 * used to prove their ABSENCE now prove their PRESENCE and behaviour instead
 * — replaced, not deleted, per this repository's rule that a capability
 * landing must correct the test that recorded its absence.
 *
 * **wire-apps-followup UPDATE**: auto-retry now has the same real wire
 * (`set_auto_retry_request`/`get_auto_retry_request`,
 * `packages/protocol/src/messages.ts`) and real
 * `DaemonClient.setAutoRetry`/`getAutoRetry` methods
 * (`packages/client/src/daemon-client.ts`), so the two assertions below
 * that used to prove their ABSENCE now prove their PRESENCE and behaviour
 * instead — replaced, not deleted, per this repository's rule that a
 * capability landing must correct the test that recorded its absence.
 * CORRECTED (wire-apps-followup): this previously said "**Auto-retry
 * remains world 3** — no wire message, no `DaemonClient` method" and that
 * "Those two assertions are UNCHANGED: should a future task add either,
 * this test starts failing immediately". That future task has landed, so
 * the assertions now prove presence.
 */
describe("createDaemonSettingsClient against the real DaemonClient", () => {
  const realDaemonMethods = DaemonClient.prototype as unknown as Record<string, unknown>;

  it("confirms the real DaemonClient now has both auto-compaction methods (T131)", () => {
    expect(typeof realDaemonMethods.getAutoCompaction).toBe("function");
    expect(typeof realDaemonMethods.setAutoCompaction).toBe("function");
  });

  it("confirms the real DaemonClient now has both auto-retry methods (wire-apps-followup)", () => {
    expect(typeof realDaemonMethods.getAutoRetry).toBe("function");
    expect(typeof realDaemonMethods.setAutoRetry).toBe("function");
  });

  it("resolves auto-compaction's SettingsClient methods to real bound functions for a real DaemonClient instance, so the UI can round-trip through them instead of rendering 'unsupported'", () => {
    // A real DaemonClient needs a live connection to actually send anything,
    // but every method this adapter reads is looked up structurally
    // (`daemon.getAutoCompaction ? ... : undefined`) before any RPC is ever
    // attempted, so an unconnected instance is enough to prove the two
    // methods now resolve rather than falling through to `undefined`.
    const daemon = Object.create(DaemonClient.prototype) as InstanceType<typeof DaemonClient>;
    const client = createDaemonSettingsClient(
      daemon as unknown as Parameters<typeof createDaemonSettingsClient>[0],
    );

    expect(typeof client.getAutoCompaction).toBe("function");
    expect(typeof client.setAutoCompaction).toBe("function");
  });

  it("resolves auto-retry's SettingsClient methods to real bound functions for a real DaemonClient instance, so the UI can round-trip through them instead of rendering 'unsupported'", () => {
    const daemon = Object.create(DaemonClient.prototype) as InstanceType<typeof DaemonClient>;
    const client = createDaemonSettingsClient(
      daemon as unknown as Parameters<typeof createDaemonSettingsClient>[0],
    );

    expect(typeof client.getAutoRetry).toBe("function");
    expect(typeof client.setAutoRetry).toBe("function");
  });

  it("discards the auto-retry provider notice: setAutoRetry resolves void even though the daemon method resolves a notice-or-null envelope", async () => {
    const daemon = {
      getAutoRetry: async () => true,
      setAutoRetry: async () => ({ type: "notice", message: "applied" }),
    };
    const client = createDaemonSettingsClient(
      daemon as unknown as Parameters<typeof createDaemonSettingsClient>[0],
    );

    await expect(client.setAutoRetry?.("agt_retry_0001", false)).resolves.toBeUndefined();
    await expect(client.getAutoRetry?.("agt_retry_0001")).resolves.toBe(true);
  });
});
