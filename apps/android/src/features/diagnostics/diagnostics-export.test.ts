import { describe, expect, it } from "vitest";

import { buildDiagnosticsSnapshot, type DiagnosticsSection } from "./diagnostics-model.js";
import {
  DIAGNOSTICS_EXPORT_KIND,
  DIAGNOSTICS_EXPORT_FORMAT_VERSION,
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
  clientId: "picompanion-android",
  exportedAt: "2026-09-06T00:00:00.000Z",
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

const DISCONNECTED_SECTIONS: DiagnosticsSection[] = buildDiagnosticsSnapshot({
  appVersion: "0.3.0-beta.2",
  clientId: "picompanion-android",
  connection: { phase: "idle", path: null, daemonAddress: null },
  profile: null,
  serverInfo: null,
});

describe("buildDiagnosticsExportBundle — disconnected snapshot (nothing to redact)", () => {
  it("builds successfully and marks no field as redacted", () => {
    const bundle = buildDiagnosticsExportBundle(DISCONNECTED_SECTIONS, META);
    for (const section of bundle.sections) {
      for (const field of section.fields) {
        expect(field.redacted).toBe(false);
      }
    }
  });

  it("is JSON-serializable and carries the format identity", () => {
    const bundle = buildDiagnosticsExportBundle(DISCONNECTED_SECTIONS, META);
    const json = serializeDiagnosticsExportBundle(bundle);
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe(DIAGNOSTICS_EXPORT_KIND);
    expect(parsed.formatVersion).toBe(DIAGNOSTICS_EXPORT_FORMAT_VERSION);
  });
});

/**
 * Forbidden category 1/4: no password. A redaction test whose input
 * carries no actual secret proves nothing — this endpoint genuinely
 * carries a password-shaped userinfo. Verified by mutation (see this
 * task's report): removing `"connection/endpoint": redactEndpointLikeValue`
 * from `FIELD_REDACTORS` in `diagnostics-export.ts` makes the first
 * assertion below fail (`value` still contains `"hunter2"`), and
 * restoring the line makes it pass again.
 */
describe("buildDiagnosticsExportBundle — forbidden category: password", () => {
  const CREDENTIALED_ENDPOINT = "wss://alice:hunter2@daemon.example:8443/ws";

  const sections = buildDiagnosticsSnapshot({
    appVersion: "0.3.0-beta.2",
    clientId: "picompanion-android",
    connection: { phase: "connected", path: "direct", daemonAddress: null },
    profile: { label: "My laptop", endpoint: CREDENTIALED_ENDPOINT },
    serverInfo: null,
  });

  it("removes the password from the exported endpoint field and from the whole serialized bundle", () => {
    const bundle = buildDiagnosticsExportBundle(sections, META);
    const value = fieldValue(bundle.sections, "connection", "endpoint");
    expect(value).not.toContain("hunter2");
    expect(value).not.toContain("alice");
    expect(value).toContain("daemon.example:8443");

    const json = serializeDiagnosticsExportBundle(bundle);
    expect(json).not.toContain("hunter2");
  });

  it("marks the endpoint field as redacted", () => {
    const bundle = buildDiagnosticsExportBundle(sections, META);
    const field = bundle.sections
      .find((s) => s.id === "connection")!
      .fields.find((f) => f.id === "endpoint")!;
    expect(field.value).not.toBe(CREDENTIALED_ENDPOINT);
    expect(field.redacted).toBe(true);
  });
});

/**
 * Forbidden category 2/4: no key/token. A query-string-shaped API key,
 * caught by the second, residual-scan layer since no per-field
 * redactor is registered for `connection/profile`.
 */
describe("buildDiagnosticsExportBundle — forbidden category: key/token", () => {
  it("refuses to export a field carrying a query-string API key, even with no registered redactor for it", () => {
    const sections: DiagnosticsSection[] = [
      {
        id: "connection",
        title: "Connection",
        fields: [
          {
            id: "profile",
            label: "Host profile",
            value: "https://daemon.example/x?apikey=SECRETTOKEN123",
          },
        ],
      },
    ];
    expect(() => buildDiagnosticsExportBundle(sections, META)).toThrow(
      DiagnosticsExportRedactionError,
    );
  });

  it("redacts a token embedded directly in a connection endpoint's query string", () => {
    const sections = buildDiagnosticsSnapshot({
      appVersion: "0.3.0-beta.2",
      clientId: "picompanion-android",
      connection: { phase: "connected", path: "relay", daemonAddress: null },
      profile: {
        label: "Relay host",
        endpoint: "relay.paseo.sh:443/ws?token=SECRETTOKEN123",
      },
      serverInfo: null,
    });
    const bundle = buildDiagnosticsExportBundle(sections, META);
    const value = fieldValue(bundle.sections, "connection", "endpoint");
    expect(value).not.toContain("SECRETTOKEN123");
    expect(value).toContain("relay.paseo.sh:443");
    const json = serializeDiagnosticsExportBundle(bundle);
    expect(json).not.toContain("SECRETTOKEN123");
  });

  it("does not false-positive on a legitimate query parameter that merely contains 'key' as a substring", () => {
    const sections: DiagnosticsSection[] = [
      {
        id: "connection",
        title: "Connection",
        fields: [
          { id: "profile", label: "Host profile", value: "https://daemon.example/x?sortkey=name" },
        ],
      },
    ];
    expect(() => buildDiagnosticsExportBundle(sections, META)).not.toThrow();
  });
});

/**
 * Forbidden category 3/4: no prompt text. Nothing this model reads ever
 * carries a prompt, so the guarantee here is the explicit disclosure,
 * not a redaction rule with nothing to find — verified by mutation (see
 * this task's report): deleting the "Prompt text — …" entry from
 * `DIAGNOSTICS_EXPORT_NOT_COLLECTED` makes this test fail.
 */
describe("buildDiagnosticsExportBundle — forbidden category: prompt text", () => {
  it("discloses, inside the bundle, that prompt text is never collected, and names the real source that carries none", () => {
    const bundle = buildDiagnosticsExportBundle(DISCONNECTED_SECTIONS, META);
    expect(bundle.notCollected).toEqual(DIAGNOSTICS_EXPORT_NOT_COLLECTED);
    const entry = bundle.notCollected.find((candidate) => /prompt/i.test(candidate));
    expect(entry).toBeDefined();
    expect(entry).toContain("buildDiagnosticsSnapshot");
  });
});

/** Forbidden category 4/4: no file content. Same disclosure-based guarantee as prompt text. */
describe("buildDiagnosticsExportBundle — forbidden category: file content", () => {
  it("discloses, inside the bundle, that file content is never collected, and names the real source that carries none", () => {
    const bundle = buildDiagnosticsExportBundle(DISCONNECTED_SECTIONS, META);
    const entry = bundle.notCollected.find((candidate) => /file content/i.test(candidate));
    expect(entry).toBeDefined();
    expect(entry).toContain("buildDiagnosticsSnapshot");
  });
});

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

describe("buildDiagnosticsExportBundle — bounded size, with truncation disclosed inside the bundle", () => {
  function byteLength(value: string): number {
    return new TextEncoder().encode(value).length;
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
  });

  it("drops whole fields, last-to-first, when many small fields push the bundle over the whole-bundle byte limit", () => {
    const manyFields: DiagnosticsSection[] = [
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
    const bundle = buildDiagnosticsExportBundle(manyFields, META);
    const json = serializeDiagnosticsExportBundle(bundle);

    expect(byteLength(json)).toBeLessThanOrEqual(DIAGNOSTICS_EXPORT_MAX_BYTES);
    expect(bundle.truncation.truncated).toBe(true);
    expect(bundle.sections[0]!.fields.some((f) => f.id === "f1199")).toBe(false);
    const dropNote = bundle.truncation.notes.find((note) => note.includes("many/f1199"));
    expect(dropNote).toBeDefined();
    expect(dropNote).not.toContain("value-1199");
  });

  it("does not truncate a normal-sized, disconnected bundle", () => {
    const bundle = buildDiagnosticsExportBundle(DISCONNECTED_SECTIONS, META);
    expect(bundle.truncation).toEqual({ truncated: false, notes: [] });
  });
});
