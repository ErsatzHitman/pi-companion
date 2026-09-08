import { describe, test, expect } from "vitest";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

// Run via `test:e2e`/`test:e2e:all` (matched by the "e2e.test.ts" suffix), not part of
// `npm run test:unit`.
//
// T262: proves end to end, against a daemon built from the REAL provider manifest (this
// file passes no `agentClients` override, so `createTestPaseoDaemon` falls back to
// `createTestAgentClients()`'s defaults, and `ProviderSnapshotManager.buildRegistry()`
// keeps only the "pi" entry -- see `AGENT_PROVIDER_DEFINITIONS` in
// `packages/protocol/src/provider-manifest.ts`), that a client announcing this product's
// real, shipped Android `appVersion` ("0.1.0", `ANDROID_DAEMON_APP_VERSION` in
// `apps/android/src/app-shell/core.ts`) receives a non-empty agent list.
//
// "The REAL provider manifest" above is scoped precisely to `this.providerRegistry`
// (what `buildRegistry()` builds, and what `resolveCreateConfig`/`getProviderDiagnostic`
// read) -- it is NOT a claim that this daemon's `AgentManager` only knows about "pi".
// `getAgentManagerProviderState()` (`getAgentManagerProviderState` in `agent/provider-snapshot-manager.ts`) overlays
// every `createTestAgentClients()` entry into `AgentManager.clients` unconditionally, so
// this exact daemon's `list_available_providers_request` reports four ids
// (`["pi","claude","codex","opencode"]`, measured directly), not one. T264 decided that
// divergence is intentional rather than a bug to guard away -- see `extraClients`'s doc
// comment on `ProviderSnapshotManagerOptions` for the rationale. It does not affect this
// test: the assertions below only check the "pi" agent this test itself creates, never
// `list_available_providers_request`.
//
// Before T262, `session.ts`'s `isProviderVisibleToClient` hid every agent from any
// connection below `MIN_VERSION_ALL_PROVIDERS` ("0.1.45") unless its provider was one of
// `LEGACY_PROVIDER_IDS` ("claude"/"codex"/"opencode") -- a set that has never contained
// "pi", this product's only provider. Since ANDROID_DAEMON_APP_VERSION ("0.1.0") sits
// below "0.1.45", the real Android app was exactly such a connection, and
// `agents.filter((agent) => this.isProviderVisibleToClient(agent.provider))` in
// `listAgentPayloads` (session.ts) dropped every agent from its `fetch_agents` response --
// not a missing push, an empty list. Reverting `isProviderVisibleToClient` to the
// pre-T262 gate (`LEGACY_PROVIDER_IDS.has(provider)` when the client's `appVersion` is
// below `MIN_VERSION_ALL_PROVIDERS`) reproduces that failure against this exact test:
// `expect(list.entries.length).toBeGreaterThan(0)` fails with "expected 0 to be greater
// than 0". See `plan.md` §18 item 13 for the fix this test guards.
describe("T262: provider visibility for a client below MIN_VERSION_ALL_PROVIDERS", () => {
  test('a client announcing ANDROID_DAEMON_APP_VERSION ("0.1.0") still sees its pi agent in fetch_agents', async () => {
    const daemon = await createTestPaseoDaemon({});
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      // ANDROID_DAEMON_APP_VERSION, apps/android/src/app-shell/core.ts -- below
      // MIN_VERSION_ALL_PROVIDERS ("0.1.45") this was the pre-T262 defect condition.
      appVersion: "0.1.0",
    });
    try {
      await client.connect();
      const created = await client.createAgent({
        provider: "pi",
        cwd: process.cwd(),
      });
      expect(created.provider).toBe("pi");

      const list = await client.fetchAgents({});
      expect(list.entries.length).toBeGreaterThan(0);
      expect(list.entries.some((entry) => entry.agent.id === created.id)).toBe(true);
      expect(list.entries.every((entry) => entry.agent.provider === "pi")).toBe(true);
    } finally {
      await client.close();
      await daemon.close();
    }
  });
});
