import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { ServerInfoStatusPayload } from "@picompanion/protocol/messages";

import {
  NOT_CONNECTED,
  NO_SERVER_INFO_YET,
  buildDiagnosticsSnapshot,
  type DiagnosticsConnectionSnapshot,
  type DiagnosticsHostProfile,
  type DiagnosticsModelInput,
} from "./diagnostics-model.js";

/**
 * T42A3's acceptance criterion is explicit: "Assert section ids and
 * field ids against the web model's real output, not against a
 * hand-typed list. A test that retypes the section names and passes is
 * a REGRESSION — it will not notice when the web screen gains a
 * section."
 *
 * `apps/web` and `apps/android` never import each other's `src` (see
 * `diagnostics-model.ts`'s own header comment), so this cannot call the
 * web module's `buildDiagnosticsSnapshot` directly. Instead it reads the
 * REAL, COMMITTED WEB SOURCE FILE'S TEXT and extracts the section
 * (id, title) pairs and field ids it actually declares — the same
 * "prove against real source text, not a hand-typed copy" instrument
 * this repo's `CLAUDE.md` already prescribes for the RN-in-vitest
 * limitation (`readComponentCode`/`readFunctionCode`, and
 * `apps/android/src/features/files/files-screen.test.ts`'s own
 * `readScreenCode()`). If T41B1 ever adds a fourth section or renames a
 * field id in `apps/web/src/features/diagnostics/diagnostics-model.ts`,
 * this extraction changes automatically and this suite's assertions
 * below — driven by what it extracts, never by a literal array typed in
 * this file — catch the drift without a human having to remember to
 * update two copies of the same list.
 */
function readWebDiagnosticsModelCode(): string {
  const source = readFileSync(
    fileURLToPath(
      new URL("../../../../web/src/features/diagnostics/diagnostics-model.ts", import.meta.url),
    ),
    "utf8",
  );
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Extracts, in first-occurrence (declaration) order, every `id: "…", title: "…"` pair whose id is one of the three known section ids. Deduped by id — `buildCapabilitiesSection` declares `id: "capabilities"` twice (its no-serverInfo branch and its final return), both with the same title. */
function extractWebSectionPairs(code: string): Map<string, string> {
  const pattern = /id:\s*"(connection|versions|capabilities)"\s*,\s*title:\s*"([^"]+)"/g;
  const pairs = new Map<string, string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code))) {
    pairs.set(match[1]!, match[2]!);
  }
  return pairs;
}

/** Every quoted `id: "…"` literal in the file EXCLUDING the three section ids — i.e. every field id. A template-literal id (`` `feature-${key}` ``) is not a quoted string literal, so it is naturally excluded rather than needing a manual filter. */
function extractWebFieldIds(code: string, sectionIds: ReadonlySet<string>): Set<string> {
  const pattern = /id:\s*"([a-zA-Z0-9_-]+)"/g;
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code))) {
    if (!sectionIds.has(match[1]!)) ids.add(match[1]!);
  }
  return ids;
}

const IDLE_CONNECTION: DiagnosticsConnectionSnapshot = {
  phase: "idle",
  path: null,
  daemonAddress: null,
};

const CONNECTED_CONNECTION: DiagnosticsConnectionSnapshot = {
  phase: "connected",
  path: "direct",
  daemonAddress: { host: "192.168.1.20", port: 8443, useTls: true, isIpv6: false },
};

const PROFILE: DiagnosticsHostProfile = { label: "My laptop", endpoint: "192.168.1.20:8443" };

function serverInfoFixture(
  overrides: Partial<ServerInfoStatusPayload> = {},
): ServerInfoStatusPayload {
  return {
    status: "server_info",
    serverId: "server-abc",
    hostname: "laptop.local",
    version: "0.3.0-beta.2",
    desktopManaged: true,
    capabilities: {},
    features: {},
    ...overrides,
  } as ServerInfoStatusPayload;
}

const CONNECTED_INPUT: DiagnosticsModelInput = {
  appVersion: "0.3.0-beta.2",
  clientId: "picompanion-android",
  connection: CONNECTED_CONNECTION,
  profile: PROFILE,
  serverInfo: serverInfoFixture(),
};

const DISCONNECTED_INPUT: DiagnosticsModelInput = {
  appVersion: "0.3.0-beta.2",
  clientId: "picompanion-android",
  connection: IDLE_CONNECTION,
  profile: null,
  serverInfo: null,
};

describe("buildDiagnosticsSnapshot — parity with the web model's real, committed source", () => {
  const webCode = readWebDiagnosticsModelCode();
  const webSectionPairs = extractWebSectionPairs(webCode);
  const webFieldIds = extractWebFieldIds(webCode, new Set(webSectionPairs.keys()));

  it("the extraction itself finds the three sections this task's brief names — a canary that this test is reading real content, not an empty/mismatched file", () => {
    expect(webSectionPairs.size).toBe(3);
    expect([...webSectionPairs.entries()]).toEqual([
      ["connection", "Connection"],
      ["versions", "Versions"],
      ["capabilities", "Capabilities"],
    ]);
    // If a fourth section ever appears, this task's premise (stated in
    // its own brief and in T203) changes and must be re-examined —
    // failing loudly here is exactly the intended behaviour, not a bug
    // in this test.
  });

  it("produces exactly the web model's sections, same ids, same titles, same order — driven by the extraction above, not a literal array", () => {
    const sections = buildDiagnosticsSnapshot(CONNECTED_INPUT);
    expect(sections.map((section) => [section.id, section.title])).toEqual([
      ...webSectionPairs.entries(),
    ]);
  });

  it("the union of field ids across a connected and a disconnected snapshot exactly matches the web model's own field ids", () => {
    const connectedIds = new Set(
      buildDiagnosticsSnapshot(CONNECTED_INPUT).flatMap((section) =>
        section.fields.map((field) => field.id),
      ),
    );
    const disconnectedIds = new Set(
      buildDiagnosticsSnapshot(DISCONNECTED_INPUT).flatMap((section) =>
        section.fields.map((field) => field.id),
      ),
    );
    const unionIds = new Set([...connectedIds, ...disconnectedIds]);
    expect(unionIds).toEqual(webFieldIds);
  });

  it("a feature flag reported by the daemon renders as its own feature-<key> field, matching the web model's dynamic-id convention", () => {
    const sections = buildDiagnosticsSnapshot({
      ...CONNECTED_INPUT,
      serverInfo: serverInfoFixture({
        features: { relayConfig: true, daemonStatusRpc: false },
      }),
    });
    const capabilities = sections.find((section) => section.id === "capabilities")!;
    const ids = capabilities.fields.map((field) => field.id);
    expect(ids).toContain("feature-relayConfig");
    expect(ids).toContain("feature-daemonStatusRpc");
    expect(ids).not.toContain("features-none");
  });
});

describe("buildDiagnosticsSnapshot — the screen works while disconnected", () => {
  const sections = buildDiagnosticsSnapshot(DISCONNECTED_INPUT);

  function fieldValue(sectionId: string, fieldId: string): string {
    const section = sections.find((candidate) => candidate.id === sectionId);
    if (!section) throw new Error(`missing section ${sectionId}`);
    const field = section.fields.find((candidate) => candidate.id === fieldId);
    if (!field) throw new Error(`missing field ${sectionId}/${fieldId}`);
    return field.value;
  }

  it("never throws building a fully disconnected snapshot", () => {
    expect(() => buildDiagnosticsSnapshot(DISCONNECTED_INPUT)).not.toThrow();
  });

  it("still returns all three sections", () => {
    expect(sections.map((section) => section.id)).toEqual([
      "connection",
      "versions",
      "capabilities",
    ]);
  });

  it("reports every connection-derived field truthfully as not connected", () => {
    expect(fieldValue("connection", "status")).toBe("idle");
    expect(fieldValue("connection", "kind")).toBe("Not established");
    expect(fieldValue("connection", "profile")).toBe("None selected");
    expect(fieldValue("connection", "endpoint")).toBe(NOT_CONNECTED);
  });

  it("still reports this app's own hello identity — that never depends on a connection", () => {
    expect(fieldValue("connection", "client-id")).toBe("picompanion-android");
    expect(fieldValue("versions", "app-version")).toBe("0.3.0-beta.2");
  });

  it("reports every server-derived field as unknown, never blank or fabricated", () => {
    expect(fieldValue("versions", "daemon-version")).toBe(NO_SERVER_INFO_YET);
    expect(fieldValue("versions", "server-id")).toBe(NO_SERVER_INFO_YET);
    expect(fieldValue("versions", "hostname")).toBe(NO_SERVER_INFO_YET);
    expect(fieldValue("versions", "desktop-managed")).toBe(NO_SERVER_INFO_YET);
    expect(fieldValue("capabilities", "capabilities-unavailable")).toBe(NO_SERVER_INFO_YET);
  });

  it("a profile chosen but no path established yet still reports 'Not connected' for the endpoint (a profile alone is not a live connection)", () => {
    const sections2 = buildDiagnosticsSnapshot({
      ...DISCONNECTED_INPUT,
      profile: PROFILE,
    });
    const section = sections2.find((candidate) => candidate.id === "connection")!;
    expect(section.fields.find((field) => field.id === "endpoint")!.value).toBe(NOT_CONNECTED);
    expect(section.fields.find((field) => field.id === "profile")!.value).toBe("My laptop");
  });
});

describe("buildDiagnosticsSnapshot — connected values", () => {
  it("reports the real connection path, profile label, and endpoint", () => {
    const sections = buildDiagnosticsSnapshot(CONNECTED_INPUT);
    const connection = sections.find((section) => section.id === "connection")!;
    expect(connection.fields.find((f) => f.id === "status")!.value).toBe("connected");
    expect(connection.fields.find((f) => f.id === "kind")!.value).toBe("Direct");
    expect(connection.fields.find((f) => f.id === "profile")!.value).toBe("My laptop");
    expect(connection.fields.find((f) => f.id === "endpoint")!.value).toBe("192.168.1.20:8443");
  });

  it("labels a relay path distinctly from a direct one", () => {
    const sections = buildDiagnosticsSnapshot({
      ...CONNECTED_INPUT,
      connection: { phase: "connected", path: "relay", daemonAddress: null },
    });
    const connection = sections.find((section) => section.id === "connection")!;
    expect(connection.fields.find((f) => f.id === "kind")!.value).toBe("Relay");
  });

  it("reports real server_info fields verbatim", () => {
    const sections = buildDiagnosticsSnapshot(CONNECTED_INPUT);
    const versions = sections.find((section) => section.id === "versions")!;
    expect(versions.fields.find((f) => f.id === "daemon-version")!.value).toBe("0.3.0-beta.2");
    expect(versions.fields.find((f) => f.id === "server-id")!.value).toBe("server-abc");
    expect(versions.fields.find((f) => f.id === "hostname")!.value).toBe("laptop.local");
    expect(versions.fields.find((f) => f.id === "desktop-managed")!.value).toBe("true");
  });

  it("reports advertised voice capability state", () => {
    const sections = buildDiagnosticsSnapshot({
      ...CONNECTED_INPUT,
      serverInfo: serverInfoFixture({
        capabilities: {
          voice: {
            dictation: { enabled: true, reason: "microphone permission granted" },
            voice: { enabled: false, reason: "no audio device" },
          },
        },
      }),
    });
    const capabilities = sections.find((section) => section.id === "capabilities")!;
    expect(capabilities.fields.find((f) => f.id === "voice-dictation")!.value).toBe(
      "Enabled — microphone permission granted",
    );
    expect(capabilities.fields.find((f) => f.id === "voice-capture")!.value).toBe(
      "Disabled — no audio device",
    );
  });
});
