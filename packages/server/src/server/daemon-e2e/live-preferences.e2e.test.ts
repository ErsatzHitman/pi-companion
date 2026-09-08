import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import type { DaemonTestContext } from "../test-utils/index.js";
import type { AgentSnapshotPayload, SessionOutboundMessage } from "../messages.js";

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

function tmpCwd(): string {
  return mkdtempSync(path.join(tmpdir(), "daemon-e2e-"));
}

function waitForAgentUpdate(
  messages: SessionOutboundMessage[],
  startIndex: number,
  predicate: (agent: AgentSnapshotPayload) => boolean,
  options?: { timeoutMs?: number },
): Promise<AgentSnapshotPayload> {
  const timeoutMs = options?.timeoutMs ?? 15000;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timeout waiting for agent_update"));
    }, timeoutMs);

    const interval = setInterval(() => {
      for (let i = startIndex; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.type !== "agent_update") continue;
        if (msg.payload.kind !== "upsert") continue;
        if (predicate(msg.payload.agent)) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve(msg.payload.agent);
          return;
        }
      }
    }, 50);
  });
}

// This file's two tests need a live `agent_update` push, not just an RPC response, so
// they cannot use `test-utils/index.js`'s `createDaemonTestContext` as-is: that helper's
// `DaemonClient` declares no `appVersion`, and `session.ts`'s
// `isProviderVisibleToClient` treats a null/pre-"0.1.45" `appVersion` as a legacy client
// that only sees `LEGACY_PROVIDER_IDS` ("claude"/"codex"/"opencode") — a set that
// predates this repository's provider registry narrowing to Pi-only and no longer
// contains "pi". Filed as a real gap this task does not own or fix (T258's `Owns:` line
// is this file, the other two e2e files, and `fake-agent-client.ts`, not `session.ts` or
// `apps/android/src/app-shell/core.ts`): `ANDROID_DAEMON_APP_VERSION` in that Android
// file is `"0.1.0"`, below the `"0.1.45"` threshold, so the real Android app is a
// "legacy" client by this same gate and would never receive an `agent_update` push for
// its own Pi agents either — confirmed by reading `isProviderVisibleToClient` and
// `LEGACY_PROVIDER_IDS` in `session.ts`, not by running the Android app. This helper
// only opts this file's OWN test connection into the modern path, matching what a real,
// up-to-date client (`apps/web`'s `DAEMON_APP_VERSION`, `"0.3.0-beta.2"`) already does.
async function createPiVisibleDaemonTestContext(): Promise<DaemonTestContext> {
  const daemon = await createTestPaseoDaemon({ agentClients: createTestAgentClients() });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.45",
  });
  await client.connect();
  await client.fetchAgents({ subscribe: { subscriptionId: "test" } });
  return {
    daemon,
    client,
    cleanup: async () => {
      await client.close();
      await daemon.close();
    },
  };
}

function pickModelSwitchPair(provider: string, models: Array<{ id: string }>): [string, string] {
  const ids = Array.from(new Set(models.map((m) => m.id))).filter(Boolean);
  const first = ids[0];
  if (!first) {
    throw new Error(`No models returned for provider ${provider}`);
  }
  return [first, ids[1] ?? `${first}-switch-target`];
}

let ctx: DaemonTestContext;
let messages: SessionOutboundMessage[] = [];
let unsubscribe: (() => void) | null = null;

beforeEach(async () => {
  ctx = await createPiVisibleDaemonTestContext();
  messages = [];
  unsubscribe = ctx.client.subscribeRawMessages((message) => {
    messages.push(message);
  });
  await ctx.client.fetchAgents({ subscribe: { subscriptionId: "live-preferences" } });
});

afterEach(async () => {
  unsubscribe?.();
  await ctx.cleanup();
}, 60000);

describe("live model switching (pi)", () => {
  test("updates agent model without restarting", async () => {
    const cwd = tmpCwd();
    try {
      const modelList = await ctx.client.listProviderModels("pi");
      if (!modelList.models || modelList.models.length === 0) {
        throw new Error("No models returned for provider pi");
      }
      const [modelA, modelB] = pickModelSwitchPair("pi", modelList.models);

      const agent = await ctx.client.createAgent({
        provider: "pi",
        cwd,
        title: "Model Switch (pi)",
        model: modelA,
      });

      const startIndex = messages.length;
      await ctx.client.setAgentModel(agent.id, modelB);

      const updated = await waitForAgentUpdate(
        messages,
        startIndex,
        (a) => a.id === agent.id && a.model === modelB,
        { timeoutMs: 20000 },
      );

      expect(updated.model).toBe(modelB);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 180000);
});

test("live thinking switching works for Pi (off -> on)", async () => {
  const cwd = tmpCwd();
  try {
    const modelList = await ctx.client.listProviderModels("pi");
    if (!modelList.models || modelList.models.length === 0) {
      throw new Error("No Pi models returned");
    }
    const modelId = modelList.models[0].id;

    const agent = await ctx.client.createAgent({
      provider: "pi",
      cwd,
      title: "Pi Thinking Switch",
      model: modelId,
    });

    const startIndex = messages.length;
    await ctx.client.setAgentThinkingOption(agent.id, "on");

    const updated = await waitForAgentUpdate(
      messages,
      startIndex,
      (a) => a.id === agent.id && a.thinkingOptionId === "on",
      { timeoutMs: 20000 },
    );

    expect(updated.thinkingOptionId).toBe("on");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}, 120000);
