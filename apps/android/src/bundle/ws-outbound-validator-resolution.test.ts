import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * T58C — the Android bundle must not carry the generated zod-aot validator.
 *
 * T58B kept the ~12 MB `dist/generated/validation/ws-outbound.aot.js` out of
 * browser builds with a `"browser"` export condition on
 * `@picompanion/protocol`'s `./validation/ws-outbound` subpath. Vite resolves
 * `"browser"`; Metro does not — its condition set is
 * `["require", "import", "react-native"]` — so an Android bundle resolved
 * `"default"` and pulled the generated module into the APK.
 *
 * The fix adds a `"react-native"` condition beside `"browser"`, pointing at the
 * same interpreter-backed validator. This suite pins all three halves of that
 * contract:
 *
 *  1. the subpath resolves to the interpreter validator under Metro's exact
 *     condition set, and still resolves to the generated one under Node's;
 *  2. `apps/android/metro.config.js` does not override
 *     `unstable_conditionNames`, so the condition set asserted here is the one
 *     Metro actually uses (the rejected alternative fix was to add `"browser"`
 *     to that list app-wide);
 *  3. outbound validation still *runs* on Android — the module Metro resolves
 *     is a real validator that accepts and rejects exactly what the Node one
 *     does, not a stub and not nothing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const androidRoot = resolve(here, "../..");
const protocolRoot = resolve(androidRoot, "../../packages/protocol");
const SUBPATH = "./validation/ws-outbound";

/** Metro's default `resolver.unstable_conditionNames`. */
const METRO_CONDITIONS = ["require", "import", "react-native"];
/** Node's conditions for an ESM import of a package subpath. */
const NODE_CONDITIONS = ["node", "import"];

type ConditionalExport = Record<string, string>;
type Validate = (input: unknown) => { success: boolean };

function readProtocolSubpathExport(): ConditionalExport {
  const pkg = JSON.parse(readFileSync(resolve(protocolRoot, "package.json"), "utf8")) as {
    exports?: Record<string, ConditionalExport>;
  };
  const entry = pkg.exports?.[SUBPATH];
  if (!entry) {
    throw new Error(`@picompanion/protocol has no "${SUBPATH}" export`);
  }
  return entry;
}

/**
 * Node's conditional-exports algorithm for a flat condition map: keys are tried
 * in declaration order, and the first one in the resolver's condition set wins
 * ("default" always matches, "types" is consumed by TypeScript, not a runtime
 * resolver).
 */
function resolveWithConditions(entry: ConditionalExport, conditions: string[]): string {
  for (const [condition, target] of Object.entries(entry)) {
    if (condition === "types") continue;
    if (condition === "default" || conditions.includes(condition)) {
      return target;
    }
  }
  throw new Error(`no export condition matched ${conditions.join(", ")}`);
}

async function importResolved(target: string): Promise<{ validateWSOutboundMessage: Validate }> {
  const absolute = resolve(protocolRoot, target);
  return (await import(pathToFileURL(absolute).href)) as {
    validateWSOutboundMessage: Validate;
  };
}

const VALID_ENVELOPES: Array<{ name: string; value: unknown }> = [
  { name: "pong", value: { type: "pong" } },
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
  { name: "a bare string", value: "pong" },
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

describe("ws-outbound validator resolution for the Android bundle (T58C)", () => {
  it("resolves to the interpreter validator under Metro's condition set", () => {
    const target = resolveWithConditions(readProtocolSubpathExport(), METRO_CONDITIONS);
    expect(target).toBe("./dist/validation/ws-outbound.browser.js");
  });

  it("still resolves to the generated zod-aot validator for Node", () => {
    const entry = readProtocolSubpathExport();
    expect(resolveWithConditions(entry, NODE_CONDITIONS)).toBe("./dist/validation/ws-outbound.js");

    const requireFromClient = createRequire(
      resolve(protocolRoot, "../client/src/daemon-client.ts"),
    );
    expect(requireFromClient.resolve("@picompanion/protocol/validation/ws-outbound")).toBe(
      resolve(protocolRoot, "dist/validation/ws-outbound.js"),
    );

    const nodeSource = readFileSync(
      resolve(protocolRoot, "dist/validation/ws-outbound.js"),
      "utf8",
    );
    expect(nodeSource).toMatch(/generated\/validation\/ws-outbound\.aot\.js/);
  });

  it("does not resolve the generated module on the Metro path", async () => {
    const target = resolveWithConditions(readProtocolSubpathExport(), METRO_CONDITIONS);
    const source = readFileSync(resolve(protocolRoot, target), "utf8");
    expect(source).not.toMatch(/generated\/validation\/ws-outbound\.aot/);
  });

  it("leaves Metro's condition set at its default, so the export condition is what selects", () => {
    const metroConfig = readFileSync(resolve(androidRoot, "metro.config.js"), "utf8");
    expect(metroConfig).not.toMatch(/unstable_conditionNames/);
  });

  describe("the Metro-resolved validator still runs, with Node parity", () => {
    let validateMetro: Validate;
    let validateNode: Validate;

    // Loading the Node target pulls in the ~12 MB generated module — the very
    // artifact this task keeps out of Android — so give the one-time transform
    // room rather than letting it blow the default 5 s per-test timeout.
    beforeAll(async () => {
      const entry = readProtocolSubpathExport();
      validateMetro = (await importResolved(resolveWithConditions(entry, METRO_CONDITIONS)))
        .validateWSOutboundMessage;
      validateNode = (await importResolved(resolveWithConditions(entry, NODE_CONDITIONS)))
        .validateWSOutboundMessage;
    }, 120_000);

    it.each(VALID_ENVELOPES)("both accept: $name", ({ value }) => {
      expect(validateNode(value).success).toBe(true);
      expect(validateMetro(value).success).toBe(true);
    });

    it.each(INVALID_ENVELOPES)("both reject: $name", ({ value }) => {
      expect(validateNode(value).success).toBe(false);
      expect(validateMetro(value).success).toBe(false);
    });
  });
});
