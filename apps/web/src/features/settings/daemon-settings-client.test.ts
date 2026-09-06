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
 * **Auto-retry remains world 3** — no wire message, no `DaemonClient`
 * method — see `settings-client.ts`'s header comment for the full audit of
 * why (auto-retry has no daemon-internal path at all, unlike auto-compaction's
 * already-existing `PiRuntimeSession.setAutoCompaction`). Those two
 * assertions are UNCHANGED: should a future task add either, this test
 * starts failing immediately, which is exactly the "never state a
 * capability is absent after it has landed" guard this repository requires.
 */
describe("createDaemonSettingsClient against the real DaemonClient", () => {
  const realDaemonMethods = DaemonClient.prototype as unknown as Record<string, unknown>;

  it("confirms the real DaemonClient now has both auto-compaction methods (T131)", () => {
    expect(typeof realDaemonMethods.getAutoCompaction).toBe("function");
    expect(typeof realDaemonMethods.setAutoCompaction).toBe("function");
  });

  it("confirms the real DaemonClient still has neither auto-retry method (world 3, unchanged by T131)", () => {
    expect(typeof realDaemonMethods.getAutoRetry).toBe("undefined");
    expect(typeof realDaemonMethods.setAutoRetry).toBe("undefined");
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

  it("still resolves auto-retry's SettingsClient methods to undefined for a real DaemonClient instance, so the UI renders 'unsupported' rather than a control that silently does nothing", () => {
    const daemon = Object.create(DaemonClient.prototype) as InstanceType<typeof DaemonClient>;
    const client = createDaemonSettingsClient(
      daemon as unknown as Parameters<typeof createDaemonSettingsClient>[0],
    );

    expect(client.getAutoRetry).toBeUndefined();
    expect(client.setAutoRetry).toBeUndefined();
  });
});
