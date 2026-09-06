import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WSInboundMessageSchema, WSOutboundMessageSchema } from "../messages.js";
import { PiUiKindSchema } from "../pi-ui-bridge/schema.js";
import {
  listDaemonWsScenarios,
  listPiUiBridgeKinds,
  loadAllDaemonWsFixtures,
  loadAllPiUiBridgeFixtures,
  loadDaemonWsFixture,
  loadPiUiBridgeFixture,
} from "./index.js";
import type { DaemonWsFixture, FixtureFrame, PiUiBridgeFixture } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));

// plan.md §14.2 required daemon-side WebSocket scenarios in T06B's scope:
// hello/capability negotiation, session lifecycle (new/imported terminal/resume/archive),
// permission dialog, reconnect with a timeline gap.
const REQUIRED_DAEMON_WS_SCENARIOS = [
  "hello-capability-negotiation",
  "session-new",
  "session-import-terminal",
  "session-resume",
  "session-archive",
  "permission-dialog",
  "reconnect-with-gap",
];

// plan.md §11.3 frozen bridge vocabulary: the ten v1 kinds.
const REQUIRED_PI_UI_KINDS = PiUiKindSchema.options;

function validateFrame(frame: FixtureFrame): void {
  const schema =
    frame.direction === "client_to_daemon" ? WSInboundMessageSchema : WSOutboundMessageSchema;
  const result = schema.safeParse(frame.message);
  if (!result.success) {
    throw new Error(
      `Frame "${frame.id}" (${frame.direction}) failed wire schema validation: ${result.error.message}`,
    );
  }
}

// Forbidden substrings that would indicate a fixture leaked real machine data
// instead of using synthetic paths/secrets, per plan.md §14.2.
const FORBIDDEN_PATTERNS: RegExp[] = [
  /C:\\Users\\/i,
  /\/home\/[a-z0-9_-]+/i,
  /\/Users\/[a-z0-9_-]+/i,
  /D:\\pi-companion/i,
  /D:\\paseo/i,
  /\baksha\b/i,
  /sk-[a-zA-Z0-9]{10,}/,
  /ghp_[a-zA-Z0-9]{10,}/,
  /AKIA[0-9A-Z]{10,}/,
];

function assertNoRealData(raw: string, fileLabel: string): void {
  for (const pattern of FORBIDDEN_PATTERNS) {
    expect(
      raw,
      `${fileLabel} appears to contain real machine data matching ${pattern}`,
    ).not.toMatch(pattern);
  }
}

describe("daemon WebSocket fixtures (plan.md §14.2)", () => {
  it("has every required scenario recorded", () => {
    const available = new Set(listDaemonWsScenarios());
    for (const scenario of REQUIRED_DAEMON_WS_SCENARIOS) {
      expect(available.has(scenario), `missing daemon-ws fixture: ${scenario}`).toBe(true);
    }
  });

  it.each(REQUIRED_DAEMON_WS_SCENARIOS)("replays %s without a live daemon", (scenario) => {
    const fixture: DaemonWsFixture = loadDaemonWsFixture(scenario);
    expect(fixture.scenario).toBe(scenario);
    expect(fixture.frames.length).toBeGreaterThan(0);
    for (const frame of fixture.frames) {
      validateFrame(frame);
    }
  });

  it("contains only synthetic paths and secrets", () => {
    for (const scenario of listDaemonWsScenarios()) {
      const raw = readFileSync(join(here, "daemon-ws", `${scenario}.json`), "utf8");
      assertNoRealData(raw, `daemon-ws/${scenario}.json`);
    }
  });

  it("loads every fixture through the shared loader", () => {
    const all = loadAllDaemonWsFixtures();
    expect(all.map((f) => f.scenario).sort()).toEqual([...REQUIRED_DAEMON_WS_SCENARIOS].sort());
  });
});

describe("Pi UI Bridge kind fixtures (plan.md §11.3)", () => {
  it("represents all ten frozen bridge kinds", () => {
    expect(REQUIRED_PI_UI_KINDS).toHaveLength(10);
    const available = new Set(listPiUiBridgeKinds());
    for (const kind of REQUIRED_PI_UI_KINDS) {
      expect(available.has(kind), `missing pi-ui-bridge fixture for kind: ${kind}`).toBe(true);
    }
  });

  it.each(REQUIRED_PI_UI_KINDS)("replays the %s kind without a live daemon", (kind) => {
    const fixture: PiUiBridgeFixture = loadPiUiBridgeFixture(kind);
    expect(fixture.kind).toBe(kind);
    expect(fixture.frames.length).toBeGreaterThan(0);
    for (const frame of fixture.frames) {
      validateFrame(frame);
    }
  });

  it("declares an element whose kind matches the fixture file", () => {
    for (const fixture of loadAllPiUiBridgeFixtures()) {
      const deltaFrame = fixture.frames.find((frame) => frame.wireType.includes("pi_ui_delta"));
      expect(deltaFrame, `${fixture.kind} fixture is missing a pi_ui_delta frame`).toBeDefined();
      const message = deltaFrame!.message as {
        message: { payload: { event: { delta: { element: { kind: string } } } } };
      };
      expect(message.message.payload.event.delta.element.kind).toBe(fixture.kind);
    }
  });

  it("contains only synthetic paths and secrets", () => {
    for (const kind of listPiUiBridgeKinds()) {
      const raw = readFileSync(join(here, "pi-ui-bridge", `${kind}.json`), "utf8");
      assertNoRealData(raw, `pi-ui-bridge/${kind}.json`);
    }
  });
});
