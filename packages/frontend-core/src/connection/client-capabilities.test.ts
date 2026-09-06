import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLIENT_CAPS } from "@picompanion/protocol/client-capabilities";
import { PI_COMPANION_CLIENT_CAPABILITIES } from "./client-capabilities.js";

// Loads the recorded T06B fixture directly by relative path (test-only; the
// fixture's JSON is not copied into @picompanion/protocol's published dist,
// see packages/protocol/src/fixtures/README.md). Production code in this
// domain never reads fixtures — see daemon-client-lifecycle.ts.
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(
  here,
  "..",
  "..",
  "..",
  "protocol",
  "src",
  "fixtures",
  "daemon-ws",
  "hello-capability-negotiation.json",
);

interface FixtureFrame {
  id: string;
  message: unknown;
}

function loadHelloMessage(): Record<string, unknown> {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { frames: FixtureFrame[] };
  const frame = fixture.frames.find((candidate) => candidate.id === "hello-1");
  if (!frame) {
    throw new Error("hello-capability-negotiation fixture is missing its hello-1 frame");
  }
  return frame.message as Record<string, unknown>;
}

describe("PI_COMPANION_CLIENT_CAPABILITIES", () => {
  it("declares every CLIENT_CAPS entry Pi Companion supports as true", () => {
    for (const capabilityId of [
      CLIENT_CAPS.selectiveAgentTimeline,
      CLIENT_CAPS.reasoningMergeEnum,
      CLIENT_CAPS.customModeIcons,
      CLIENT_CAPS.terminalReflowableSnapshot,
      CLIENT_CAPS.providerSubagents,
      CLIENT_CAPS.projectUpdates,
      CLIENT_CAPS.compactProviderSnapshots,
      CLIENT_CAPS.piUiBridge,
    ]) {
      expect(PI_COMPANION_CLIENT_CAPABILITIES[capabilityId]).toBe(true);
    }
  });

  it("does not declare piUiPayloadV2 (T21B/T21C's decision, not T19A's)", () => {
    expect(PI_COMPANION_CLIENT_CAPABILITIES[CLIENT_CAPS.piUiPayloadV2]).toBeUndefined();
  });

  it("does not declare browserHost (Pi Companion is not a browser-automation host)", () => {
    expect(PI_COMPANION_CLIENT_CAPABILITIES[CLIENT_CAPS.browserHost]).toBeUndefined();
  });

  it("matches every capability id and value declared by the recorded hello fixture (T06B)", () => {
    const helloMessage = loadHelloMessage();
    const fixtureCapabilities = helloMessage.capabilities as Record<string, boolean>;
    expect(fixtureCapabilities).toEqual(PI_COMPANION_CLIENT_CAPABILITIES);
  });
});
