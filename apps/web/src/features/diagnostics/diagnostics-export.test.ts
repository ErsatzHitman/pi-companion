import { describe, expect, it } from "vitest";

import type { hosts } from "@picompanion/frontend-core";
import type { ServerInfoStatusPayload } from "@picompanion/protocol/messages";

import { buildDiagnosticsSnapshot, type DiagnosticsSection } from "./diagnostics-model.js";
import {
  DIAGNOSTICS_EXPORT_FORMAT_VERSION,
  DIAGNOSTICS_EXPORT_KIND,
  DIAGNOSTICS_EXPORT_MAX_BYTES,
  DIAGNOSTICS_EXPORT_MAX_FIELD_VALUE_BYTES,
  DIAGNOSTICS_EXPORT_NOT_COLLECTED,
  DiagnosticsExportRedactionError,
  buildDiagnosticsExportBundle,
  serializeDiagnosticsExportBundle,
  type DiagnosticsExportSection,
} from "./diagnostics-export.js";

const META = {
  appVersion: "0.3.0-beta.2",
  clientId: "picompanion-web",
  exportedAt: "2026-09-05T00:00:00.000Z",
};

function fieldValue(
  sections: DiagnosticsExportSection[],
  sectionId: string,
  fieldId: string,
): string {
  const section = sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new Error(`missing section ${sectionId}`);
  const found = section.fields.find((candidate) => candidate.id === fieldId);
  if (!found) throw new Error(`missing field ${sectionId}/${fieldId}`);
  return found.value;
}

const IDLE_INFO: hosts.HostControllerConnectionInfo = {
  status: "idle",
  profileId: null,
  kind: null,
};

describe("buildDiagnosticsExportBundle — disconnected snapshot (nothing to redact)", () => {
  const sections = buildDiagnosticsSnapshot({
    appVersion: "0.3.0-beta.2",
    clientId: "picompanion-web",
    connectionInfo: IDLE_INFO,
    profile: null,
    serverInfo: null,
  });

  it("builds successfully and marks no field as redacted", () => {
    const bundle = buildDiagnosticsExportBundle(sections, META);
    for (const section of bundle.sections) {
      for (const field of section.fields) {
        expect(field.redacted).toBe(false);
      }
    }
  });

  it("discloses that prompts and file content are not collected, explicitly", () => {
    const bundle = buildDiagnosticsExportBundle(sections, META);
    expect(bundle.notCollected).toEqual(DIAGNOSTICS_EXPORT_NOT_COLLECTED);
    expect(bundle.notCollected.some((entry) => /prompt/i.test(entry))).toBe(true);
    expect(bundle.notCollected.some((entry) => /file content/i.test(entry))).toBe(true);
  });

  it("is JSON-serializable and carries the format identity", () => {
    const bundle = buildDiagnosticsExportBundle(sections, META);
    const json = serializeDiagnosticsExportBundle(bundle);
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe("picompanion-diagnostics-export");
    expect(parsed.formatVersion).toBe(1);
  });
});

/**
 * The trap this task names directly: a redaction test whose input
 * carries no actual secret proves nothing. This endpoint genuinely
 * carries a password-shaped userinfo, an API-token-shaped query
 * parameter, and a session-id-shaped fragment.
 */
function directProfileWithCredentialedEndpoint(endpoint: string): hosts.HostProfile {
  return {
    id: "profile-1",
    label: "My laptop",
    direct: { endpoint, useTls: true },
    preferDirect: true,
    createdAt: 0,
    updatedAt: 0,
    lastConnectedAt: 1000,
    lastConnectionKind: "direct",
  };
}

describe("buildDiagnosticsExportBundle — connection.endpoint genuinely carries credentials", () => {
  const CREDENTIALED_ENDPOINT =
    "wss://alice:hunter2@daemon.example:8443/ws?token=SECRETTOKEN123#session-9f8e7d";

  const sections = buildDiagnosticsSnapshot({
    appVersion: "0.3.0-beta.2",
    clientId: "picompanion-web",
    connectionInfo: { status: "connected", profileId: "profile-1", kind: "direct" },
    profile: directProfileWithCredentialedEndpoint(CREDENTIALED_ENDPOINT),
    serverInfo: null,
  });

  it("removes the password, the token, and the fragment from the exported endpoint", () => {
    const bundle = buildDiagnosticsExportBundle(sections, META);
    const value = fieldValue(bundle.sections, "connection", "endpoint");

    expect(value).not.toContain("hunter2");
    expect(value).not.toContain("alice");
    expect(value).not.toContain("SECRETTOKEN123");
    expect(value).not.toContain("session-9f8e7d");

    // The whole serialized bundle, not just this one field, must be clean.
    const json = serializeDiagnosticsExportBundle(bundle);
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("SECRETTOKEN123");
    expect(json).not.toContain("session-9f8e7d");
  });

  it("preserves the host and port — the part actually useful for diagnosis", () => {
    const bundle = buildDiagnosticsExportBundle(sections, META);
    const value = fieldValue(bundle.sections, "connection", "endpoint");
    expect(value).toContain("daemon.example:8443");
    expect(value).toContain("wss://");
  });

  it("marks the endpoint field as redacted", () => {
    const bundle = buildDiagnosticsExportBundle(sections, META);
    const section = bundle.sections.find((candidate) => candidate.id === "connection")!;
    const field = section.fields.find((candidate) => candidate.id === "endpoint")!;
    expect(field.redacted).toBe(true);
  });
});

describe("buildDiagnosticsExportBundle — relay endpoint credentials are redacted the same way", () => {
  const profile: hosts.HostProfile = {
    id: "profile-2",
    label: "Relay host",
    relay: {
      endpoint: "user:s3cret@relay.paseo.sh:443",
      useTls: true,
      serverId: "server-xyz",
      daemonPublicKeyB64: "not-a-secret-pin",
    },
    preferDirect: false,
    createdAt: 0,
    updatedAt: 0,
    lastConnectedAt: 1000,
    lastConnectionKind: "relay",
  };

  const sections = buildDiagnosticsSnapshot({
    appVersion: "0.3.0-beta.2",
    clientId: "picompanion-web",
    connectionInfo: { status: "connected", profileId: "profile-2", kind: "relay" },
    profile,
    serverInfo: null,
  });

  it("redacts the bare (schemeless) userinfo form too", () => {
    const bundle = buildDiagnosticsExportBundle(sections, META);
    const value = fieldValue(bundle.sections, "connection", "endpoint");
    expect(value).not.toContain("s3cret");
    expect(value).not.toContain("user:s3cret");
    expect(value).toContain("relay.paseo.sh:443");
  });
});

describe("buildDiagnosticsExportBundle — a real server_info payload has no secret-shaped field", () => {
  it("passes every value through unredacted, because none of them are endpoint-shaped or a registered field", () => {
    const serverInfo: ServerInfoStatusPayload = {
      status: "server_info",
      serverId: "server-abc",
      hostname: "laptop.local",
      version: "0.3.0-beta.2",
      desktopManaged: true,
      capabilities: {
        voice: {
          dictation: { enabled: true, reason: "microphone permission granted" },
          voice: { enabled: false, reason: "no audio device" },
        },
      },
      features: { relayConfig: true },
    } as ServerInfoStatusPayload;

    const sections = buildDiagnosticsSnapshot({
      appVersion: "0.3.0-beta.2",
      clientId: "picompanion-web",
      connectionInfo: IDLE_INFO,
      profile: null,
      serverInfo,
    });
    const bundle = buildDiagnosticsExportBundle(sections, META);
    expect(fieldValue(bundle.sections, "versions", "server-id")).toBe("server-abc");
    expect(fieldValue(bundle.sections, "versions", "hostname")).toBe("laptop.local");
  });
});

/**
 * "Redaction failures fail the build, not just warn" — the bundle-wide
 * second layer. This section/field pair (`connection/profile`, a host
 * profile's user-chosen label) has NO registered per-field redactor at
 * all, proving the second layer catches secret-shaped content the
 * registry never knew to look for, not just a registered rule that ran
 * and failed.
 */
describe("buildDiagnosticsExportBundle — refuses a field with no registered rule that still carries credentials", () => {
  const sectionsWithUnexpectedSecret: DiagnosticsSection[] = [
    {
      id: "connection",
      title: "Connection",
      fields: [{ id: "profile", label: "Host profile", value: "bob:s3cr3t@evil.example" }],
    },
  ];

  it("throws DiagnosticsExportRedactionError rather than exporting the field unredacted", () => {
    expect(() => buildDiagnosticsExportBundle(sectionsWithUnexpectedSecret, META)).toThrow(
      DiagnosticsExportRedactionError,
    );
  });

  it("names the offending section/field in the thrown message", () => {
    try {
      buildDiagnosticsExportBundle(sectionsWithUnexpectedSecret, META);
      throw new Error("expected buildDiagnosticsExportBundle to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DiagnosticsExportRedactionError);
      expect((error as Error).message).toContain("connection/profile");
    }
  });
});

describe("buildDiagnosticsExportBundle — a query-string-shaped secret with no userinfo is still caught", () => {
  const sectionsWithQuerySecret: DiagnosticsSection[] = [
    {
      id: "connection",
      title: "Connection",
      fields: [
        { id: "profile", label: "Host profile", value: "https://daemon.example/x?token=abc123" },
      ],
    },
  ];

  it("throws because the second layer's query-secret-marker scan matches", () => {
    expect(() => buildDiagnosticsExportBundle(sectionsWithQuerySecret, META)).toThrow(
      DiagnosticsExportRedactionError,
    );
  });
});

/**
 * T154: broadens the residual query-secret scan beyond bare `token=`,
 * `key=`, etc. to also catch the compound-name style — `apikey`/
 * `access_token` and their separator variants — that the bare-word
 * alternation could never match (it requires the parameter's ENTIRE
 * name, not a substring, to equal one of its words).
 */
describe("buildDiagnosticsExportBundle — broadened residual query-secret markers (T154)", () => {
  function sectionsWithQueryValue(value: string): DiagnosticsSection[] {
    return [
      {
        id: "connection",
        title: "Connection",
        fields: [{ id: "profile", label: "Host profile", value }],
      },
    ];
  }

  it.each(["apikey", "api_key", "api-key"])(
    "throws for an apikey-style query marker spelled %s",
    (marker) => {
      const sections = sectionsWithQueryValue(`https://daemon.example/x?${marker}=abc123`);
      expect(() => buildDiagnosticsExportBundle(sections, META)).toThrow(
        DiagnosticsExportRedactionError,
      );
    },
  );

  it.each(["access_token", "access-token", "accesstoken"])(
    "throws for an access_token-style query marker spelled %s",
    (marker) => {
      const sections = sectionsWithQueryValue(`https://daemon.example/x?${marker}=abc123`);
      expect(() => buildDiagnosticsExportBundle(sections, META)).toThrow(
        DiagnosticsExportRedactionError,
      );
    },
  );

  it("still catches the marker when it is not the first query parameter", () => {
    const sections = sectionsWithQueryValue("https://daemon.example/x?foo=bar&apikey=abc123");
    expect(() => buildDiagnosticsExportBundle(sections, META)).toThrow(
      DiagnosticsExportRedactionError,
    );
  });

  it("does not false-positive on a legitimate query parameter that merely contains one of these words as a substring", () => {
    const sections = sectionsWithQueryValue("https://daemon.example/x?sortkey=name&keyword=test");
    expect(() => buildDiagnosticsExportBundle(sections, META)).not.toThrow();
  });

  it("does not false-positive on a path segment or hostname spelling one of these words outside a query", () => {
    const sections = sectionsWithQueryValue("https://apikey.example.com/apikeys/123");
    expect(() => buildDiagnosticsExportBundle(sections, META)).not.toThrow();
  });
});

/**
 * T41B3: reproducibility. `exportedAt` is caller-supplied precisely so a
 * FIXED timestamp cannot be what makes these tests pass — the property
 * under test here is everything else: field/section order and, in the
 * "feature order" case below, that a difference in an UPSTREAM object's
 * key insertion order (`ServerInfoStatusPayload.features`) never reaches
 * the serialized bundle. Comparing the SERIALIZED strings, not the
 * objects, matters because `toEqual` is blind to key order and
 * `JSON.stringify` is not.
 */
describe("buildDiagnosticsExportBundle — reproducible for the same logical state", () => {
  function serverInfoWithFeatureKeyOrder(order: "a-then-b" | "b-then-a"): ServerInfoStatusPayload {
    const features: Record<string, boolean> = {};
    if (order === "a-then-b") {
      features.relayConfig = true;
      features.voiceCapture = false;
    } else {
      features.voiceCapture = false;
      features.relayConfig = true;
    }
    return {
      status: "server_info",
      serverId: "server-abc",
      hostname: "laptop.local",
      version: "0.3.0-beta.2",
      desktopManaged: true,
      capabilities: {
        voice: {
          dictation: { enabled: true, reason: "microphone permission granted" },
          voice: { enabled: false, reason: "no audio device" },
        },
      },
      features,
    } as ServerInfoStatusPayload;
  }

  it("serializes byte-identically for two inputs differing only in an upstream object's key insertion order", () => {
    const sectionsA = buildDiagnosticsSnapshot({
      appVersion: "0.3.0-beta.2",
      clientId: "picompanion-web",
      connectionInfo: IDLE_INFO,
      profile: null,
      serverInfo: serverInfoWithFeatureKeyOrder("a-then-b"),
    });
    const sectionsB = buildDiagnosticsSnapshot({
      appVersion: "0.3.0-beta.2",
      clientId: "picompanion-web",
      connectionInfo: IDLE_INFO,
      profile: null,
      serverInfo: serverInfoWithFeatureKeyOrder("b-then-a"),
    });

    const jsonA = serializeDiagnosticsExportBundle(buildDiagnosticsExportBundle(sectionsA, META));
    const jsonB = serializeDiagnosticsExportBundle(buildDiagnosticsExportBundle(sectionsB, META));

    expect(jsonA).toBe(jsonB);
  });

  it("produces identical serialized output for two freshly-constructed but equal, already-oversized inputs", () => {
    const manyFields = (): DiagnosticsSection[] => [
      {
        id: "many",
        title: "Many",
        fields: Array.from({ length: 1200 }, (_, i) => ({
          id: `f${i}`,
          label: `Field ${i}`,
          value: `value-${i}`,
        })),
      },
    ];

    const jsonA = serializeDiagnosticsExportBundle(
      buildDiagnosticsExportBundle(manyFields(), META),
    );
    const jsonB = serializeDiagnosticsExportBundle(
      buildDiagnosticsExportBundle(manyFields(), META),
    );

    expect(jsonA).toBe(jsonB);
  });
});

/**
 * T41B3: bounding and disclosure. Each test here constructs an input that
 * genuinely exceeds the relevant bound — a single value over the
 * per-field cap, and a section with enough fields to exceed the
 * whole-bundle cap — rather than asserting on a small fixture that could
 * never fail regardless of whether bounding exists at all.
 */
describe("buildDiagnosticsExportBundle — bounded size, with truncation disclosed inside the bundle", () => {
  function byteLength(value: string): number {
    return new TextEncoder().encode(value).length;
  }

  function manyFieldSections(count: number): DiagnosticsSection[] {
    return [
      {
        id: "many",
        title: "Many",
        fields: Array.from({ length: count }, (_, i) => ({
          id: `f${i}`,
          label: `Field ${i}`,
          value: `value-${i}`,
        })),
      },
    ];
  }

  it("shortens a single field value that alone exceeds the per-field byte limit, and discloses it", () => {
    const oversizedValue = "x".repeat(DIAGNOSTICS_EXPORT_MAX_FIELD_VALUE_BYTES + 500);
    const sections: DiagnosticsSection[] = [
      {
        id: "big",
        title: "Big",
        fields: [{ id: "huge", label: "Huge field", value: oversizedValue }],
      },
    ];

    const bundle = buildDiagnosticsExportBundle(sections, META);

    expect(bundle.truncation.truncated).toBe(true);
    expect(bundle.truncation.notes.some((note) => note.includes("big/huge"))).toBe(true);

    const shortenedValue = fieldValue(bundle.sections, "big", "huge");
    expect(byteLength(shortenedValue)).toBeLessThanOrEqual(
      DIAGNOSTICS_EXPORT_MAX_FIELD_VALUE_BYTES,
    );
    expect(shortenedValue).toContain("truncated");
    // The disclosure states the field that was shortened, never a value long enough to be the content itself.
    expect(
      bundle.truncation.notes.every(
        (note) => byteLength(note) < DIAGNOSTICS_EXPORT_MAX_FIELD_VALUE_BYTES,
      ),
    ).toBe(true);

    const json = serializeDiagnosticsExportBundle(bundle);
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe(DIAGNOSTICS_EXPORT_KIND);
    expect(parsed.formatVersion).toBe(DIAGNOSTICS_EXPORT_FORMAT_VERSION);
    expect(parsed.truncation.truncated).toBe(true);
  });

  it("drops whole fields, last-to-first, when many small fields push the bundle over the whole-bundle byte limit", () => {
    const bundle = buildDiagnosticsExportBundle(manyFieldSections(1200), META);
    const json = serializeDiagnosticsExportBundle(bundle);

    expect(byteLength(json)).toBeLessThanOrEqual(DIAGNOSTICS_EXPORT_MAX_BYTES);
    expect(bundle.truncation.truncated).toBe(true);
    expect(bundle.sections[0]!.fields.length).toBeLessThan(1200);
    // Dropped last-to-first: the very last input field is always among the first dropped.
    expect(bundle.sections[0]!.fields.some((f) => f.id === "f1199")).toBe(false);

    const dropNote = bundle.truncation.notes.find((note) => note.includes("many/f1199"));
    expect(dropNote).toBeDefined();
    expect(dropNote).not.toContain("value-1199");

    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe(DIAGNOSTICS_EXPORT_KIND);
    expect(parsed.formatVersion).toBe(DIAGNOSTICS_EXPORT_FORMAT_VERSION);
    expect(Array.isArray(parsed.truncation.notes)).toBe(true);
  });

  it("does not truncate a normal-sized bundle, and does not leak a prior call's truncation notes into it", () => {
    buildDiagnosticsExportBundle(manyFieldSections(1200), META); // exercises the bounding path first

    const sections = buildDiagnosticsSnapshot({
      appVersion: "0.3.0-beta.2",
      clientId: "picompanion-web",
      connectionInfo: IDLE_INFO,
      profile: null,
      serverInfo: null,
    });
    const bundle = buildDiagnosticsExportBundle(sections, META);

    expect(bundle.truncation).toEqual({ truncated: false, notes: [] });
  });
});
