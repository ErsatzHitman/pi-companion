import { describe, test, expect } from "vitest";
import { createDaemonTestContext } from "../test-utils/index.js";

// Run via `test:integration` (not part of `npm run test:unit`). Rescoped by T258 to the
// one provider this repository's registry actually has: `AGENT_PROVIDER_DEFINITIONS` in
// `packages/protocol/src/provider-manifest.ts` lists exactly one entry, `id: "pi"`
// (plan.md lines 99, 174 — "a Pi-only daemon and provider", "non-Pi agent providers" is a
// stated non-goal). This file used to assert "claude"/"codex"/"opencode" cases carried
// over from Paseo's multi-provider daemon; T250 measured why they failed
// (`Unknown provider: <id>`, since `ProviderSnapshotManager.buildRegistry()` only lets an
// `extraClients` fake override a provider id already in the builtin registry) and T258
// made the scope call: rescope to "pi" with a matching fake in `fake-agent-client.ts`
// rather than reintroduce non-Pi providers into the manifest. See T258's entry in
// `docs/issues-from-plan.md` for the coverage this rescoping gives up.
describe("daemon E2E", () => {
  describe("listProviderModels", () => {
    test("returns model list for Pi provider", async () => {
      const ctx = await createDaemonTestContext();
      try {
        // List models for the Pi provider - no agent needed
        const result = await ctx.client.listProviderModels("pi");

        // Verify response structure
        expect(result.provider).toBe("pi");
        expect(result.error).toBeNull();
        expect(result.fetchedAt).toBeTruthy();

        // Should return at least one model
        expect(result.models).toBeTruthy();
        expect(result.models.length).toBeGreaterThan(0);

        // Verify model structure
        const model = result.models[0];
        expect(model.provider).toBe("pi");
        expect(model.id).toBeTruthy();
        expect(model.label).toBeTruthy();
      } finally {
        await ctx.cleanup();
      }
    }, 60000);
  });
});
