import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateWSOutboundMessage as validateNode } from "../../src/validation/ws-outbound.js";
import { validateWSOutboundMessage as validateBrowser } from "../../src/validation/ws-outbound.browser.js";

// T58B: the browser build of "@picompanion/protocol/validation/ws-outbound" resolves
// (via the package.json "browser" export condition) to ws-outbound.browser.ts instead
// of ws-outbound.ts, to keep the ~517KB gzip zod-aot generated validator out of
// browser bundles. This suite proves that swap does not weaken validation: both
// implementations must accept and reject the exact same inputs, and the browser
// implementation must never statically pull in the generated module it exists to avoid.

const protocolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const VALID_ENVELOPES: Array<{ name: string; value: unknown }> = [
  { name: "pong", value: { type: "pong" } },
  {
    name: "session-wrapped provider snapshot response",
    value: {
      type: "session",
      message: {
        type: "get_providers_snapshot_response",
        payload: {
          entries: [],
          compactSnapshot: {
            entries: [
              {
                provider: "pi",
                status: "ready",
                enabled: true,
                models: [{ id: "model-a", label: "Model A", thinkingSet: 0 }],
              },
            ],
            thinkingSets: [
              {
                options: [{ id: "high", label: "High", isDefault: true }],
                defaultOptionId: "high",
              },
            ],
          },
          snapshotHash: "snapshot-hash",
          generatedAt: "2026-08-04T00:00:00.000Z",
          requestId: "provider-snapshot",
        },
      },
    },
  },
  {
    name: "session-wrapped attention event",
    value: {
      type: "session",
      message: {
        type: "agent_attention_required",
        payload: {
          agentId: "agent-1",
          reason: "finished",
          timestamp: "2026-07-22T18:00:00.000Z",
          shouldNotify: true,
        },
      },
    },
  },
];

const INVALID_ENVELOPES: Array<{ name: string; value: unknown }> = [
  { name: "unknown top-level type", value: { type: "not_a_message" } },
  { name: "null", value: null },
  { name: "session envelope missing message", value: { type: "session" } },
  {
    name: "session envelope with unknown message type",
    value: { type: "session", message: { type: "not_a_real_response_type", payload: {} } },
  },
  {
    name: "attention event missing required field",
    value: {
      type: "session",
      message: {
        type: "agent_attention_required",
        payload: { agentId: "agent-1", reason: "finished" },
      },
    },
  },
];

describe("browser validator parity with the Node/daemon validator (T58B)", () => {
  it.each(VALID_ENVELOPES)("both accept: $name", ({ value }) => {
    const nodeResult = validateNode(value);
    const browserResult = validateBrowser(value);
    expect(nodeResult.success).toBe(true);
    expect(browserResult.success).toBe(true);
    expect(browserResult).toEqual(nodeResult);
  });

  it.each(INVALID_ENVELOPES)("both reject: $name", ({ value }) => {
    const nodeResult = validateNode(value);
    const browserResult = validateBrowser(value);
    expect(nodeResult.success).toBe(false);
    expect(browserResult.success).toBe(false);
  });

  it("never statically imports the generated zod-aot module", async () => {
    const source = await readFile(
      resolve(protocolRoot, "src/validation/ws-outbound.browser.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/generated\/validation\/ws-outbound\.aot/);
  });

  it("is wired as the package's browser export condition for this subpath", async () => {
    const pkg = JSON.parse(await readFile(resolve(protocolRoot, "package.json"), "utf8")) as {
      exports?: Record<string, Record<string, string>>;
    };
    const entry = pkg.exports?.["./validation/ws-outbound"];
    expect(entry?.browser).toBe("./dist/validation/ws-outbound.browser.js");
    expect(entry?.default).toBe("./dist/validation/ws-outbound.js");
  });
});
