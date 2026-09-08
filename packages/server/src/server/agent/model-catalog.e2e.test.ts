import { describe, expect, test } from "vitest";

import type { AgentModelDefinition } from "./agent-sdk-types.js";
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

function modelMatchesFamily(model: AgentModelDefinition, family: "sonnet" | "haiku"): boolean {
  const haystacks = [model.id, model.label, model.description ?? ""].map((value) =>
    value.toLowerCase(),
  );
  return haystacks.some((text) => text.includes(family));
}

describe("provider model catalogs (e2e)", () => {
  test("Pi catalog exposes Sonnet and Haiku variants", async () => {
    const ctx = await createDaemonTestContext();
    try {
      const result = await ctx.client.listProviderModels("pi");

      expect(result.error).toBeNull();
      expect(result.models.length).toBeGreaterThan(0);

      expect(result.models.some((model) => modelMatchesFamily(model, "sonnet"))).toBe(true);
      expect(result.models.some((model) => modelMatchesFamily(model, "haiku"))).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  }, 180_000);
});
