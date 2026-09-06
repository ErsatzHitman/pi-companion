import { describe, expect, it } from "vitest";
import { CLIENT_CAPS } from "../client-capabilities.js";
import { ServerInfoStatusPayloadSchema, WSHelloMessageSchema } from "../messages.js";
import { validateWSOutboundMessage } from "../validation/ws-outbound.js";
import { loadAllPiUiBridgeFixtures, loadPiUiBridgeFixture } from "../fixtures/index.js";
import {
  PI_UI_PAYLOAD_KINDS,
  PI_UI_PAYLOAD_SCHEMAS,
  PiUiElementPayloadSchema,
  PiUiElementSchema,
  PiUiKindSchema,
  PiUiStateSchema,
  piUiKindSupportsAppend,
  piUiPayloadMatchesKind,
  piUiPayloadSchemaForKind,
  type PiUiElementPayload,
  type PiUiKind,
} from "./schema.js";

/**
 * Representative canonical payload for each of the ten v1 kinds
 * (plan.md §4.2 step 1, §11.3).
 */
const PAYLOAD_SAMPLES: Record<PiUiKind, PiUiElementPayload> = {
  status: { kind: "status", text: "Plan mode: reviewing changes", tone: "accent" },
  widget: {
    kind: "widget",
    text: "3 of 7 tasks complete",
    lines: ["write schema", "write tests"],
    rows: [{ id: "t1", label: "write schema", value: "done" }],
  },
  panel: {
    kind: "panel",
    sections: [
      { id: "head", ns: "loop", kind: "status", payload: { kind: "status", text: "running" } },
      {
        id: "tail",
        ns: "loop",
        kind: "log",
        payload: { kind: "log", lines: ["step 1", "step 2"], tail: 200 },
      },
    ],
  },
  progress: { kind: "progress", label: "Deploy workflow", value: 2, max: 5 },
  roster: {
    kind: "roster",
    rows: [
      {
        id: "sub_1",
        label: "reviewer",
        state: "running",
        detail: "reading diff",
        progress: { value: 1, max: 3 },
        actions: [{ id: "cancel", label: "Cancel", variant: "danger" }],
      },
    ],
  },
  log: { kind: "log", lines: ["boot", "ready"], tail: 500, mono: true },
  markdown: { kind: "markdown", text: "# Notes\n\nSome **content**." },
  diff: {
    kind: "diff",
    unifiedDiff: "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new\n",
    filePath: "src/index.ts",
  },
  form: {
    kind: "form",
    description: "How should we proceed?",
    fields: [
      { kind: "text", id: "comment", label: "Comment", multiline: true },
      {
        kind: "select",
        id: "approach",
        label: "Approach",
        multiple: true,
        searchable: true,
        options: [
          { value: "rewrite", label: "Rewrite", description: "Larger diff" },
          { value: "add-tests", label: "Add tests" },
        ],
      },
      { kind: "toggle", id: "notify", label: "Notify me", value: true },
    ],
  },
  composer: {
    kind: "composer",
    text: "Please summarize the diff.",
    mode: "replace",
    previousText: "summarize",
  },
};

function elementFor(kind: PiUiKind): Record<string, unknown> {
  return {
    id: `el-${kind}`,
    ns: "fixture",
    kind,
    placement: "inline",
    title: `Element ${kind}`,
    payload: PAYLOAD_SAMPLES[kind],
  };
}

describe("pi ui typed payload schemas", () => {
  it("covers all ten frozen kinds", () => {
    expect(PI_UI_PAYLOAD_KINDS).toEqual(PiUiKindSchema.options);
    expect(PI_UI_PAYLOAD_KINDS).toHaveLength(10);
    expect(Object.keys(PI_UI_PAYLOAD_SCHEMAS).sort()).toEqual([...PiUiKindSchema.options].sort());
  });

  it.each(PiUiKindSchema.options)("parses a canonical %s payload", (kind) => {
    const parsed = piUiPayloadSchemaForKind(kind).safeParse(PAYLOAD_SAMPLES[kind]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(PAYLOAD_SAMPLES[kind]);
  });

  it.each(PiUiKindSchema.options)("discriminates a %s payload in the union", (kind) => {
    const parsed = PiUiElementPayloadSchema.safeParse(PAYLOAD_SAMPLES[kind]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(PAYLOAD_SAMPLES[kind]);
  });

  it("rejects a payload whose discriminator is not a known kind", () => {
    expect(PiUiElementPayloadSchema.safeParse({ kind: "teapot", text: "x" }).success).toBe(false);
  });

  it("keeps extension-specific extras inside a payload", () => {
    const parsed = PiUiElementPayloadSchema.parse({
      kind: "roster",
      rows: [{ id: "a", label: "a", subagentId: "sub_1" }],
      channel: "subagents:fleet",
    });
    expect(parsed).toMatchObject({ channel: "subagents:fleet" });
    expect((parsed as { rows: Array<Record<string, unknown>> }).rows[0]).toMatchObject({
      subagentId: "sub_1",
    });
  });

  it("reports which kinds support append", () => {
    expect(piUiKindSupportsAppend("log")).toBe(true);
    for (const kind of PiUiKindSchema.options.filter((k) => k !== "log")) {
      expect(piUiKindSupportsAppend(kind)).toBe(false);
    }
  });

  it("matches a payload discriminator against an element kind", () => {
    expect(piUiPayloadMatchesKind("log", PAYLOAD_SAMPLES.log)).toBe(true);
    expect(piUiPayloadMatchesKind("log", PAYLOAD_SAMPLES.markdown)).toBe(false);
    expect(piUiPayloadMatchesKind("log", undefined)).toBe(true);
  });
});

describe("pi ui element envelope", () => {
  it.each(PiUiKindSchema.options)("accepts an element carrying a %s payload", (kind) => {
    const element = elementFor(kind);
    const parsed = PiUiElementSchema.safeParse(element);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(element);
  });

  it("treats the canonical payload as optional", () => {
    const element = { id: "a", ns: "n", kind: "status", placement: "status" };
    const parsed = PiUiElementSchema.parse(element);
    expect(parsed).toEqual(element);
    expect("payload" in parsed).toBe(false);
  });

  it("does not strip the legacy v1 top-level fields", () => {
    const legacy = {
      id: "legacy",
      ns: "advisor",
      kind: "log",
      placement: "inline",
      text: "line one\nline two",
      lines: ["line one", "line two"],
      rows: [{ label: "row" }],
      sections: [{ id: "s", kind: "status" }],
      value: 3,
      fields: [{ id: "f", kind: "text", label: "F" }],
    };
    expect(PiUiElementSchema.parse(legacy)).toEqual(legacy);
  });

  it("does not strip unlisted helper fields", () => {
    const element = {
      id: "diffy",
      ns: "review",
      kind: "diff",
      placement: "inline",
      unifiedDiff: "@@ -1 +1 @@\n-a\n+b\n",
      filePath: "a.ts",
      tone: "accent",
      entries: [1, 2, 3],
    };
    expect(PiUiElementSchema.parse(element)).toEqual(element);
  });

  it("applies no transform: parsing is identity for both projections", () => {
    // plan.md §4.2: "Do not use a Zod transform in the shared wire schema."
    const dual = {
      ...elementFor("markdown"),
      text: "# Notes\n\nSome **content**.",
    };
    const parsed = PiUiElementSchema.parse(dual);
    expect(parsed).toEqual(dual);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(dual);
  });

  it("keeps a payload-mismatched element parseable so the daemon can reconcile it", () => {
    const mismatched = { ...elementFor("log"), payload: PAYLOAD_SAMPLES.markdown };
    const parsed = PiUiElementSchema.parse(mismatched);
    expect(parsed).toEqual(mismatched);
    expect(piUiPayloadMatchesKind("log", parsed.payload)).toBe(false);
  });

  it("carries payloads through a full state snapshot", () => {
    const state = {
      agentId: "agt_1",
      revision: 4,
      elements: PiUiKindSchema.options.map((kind) => elementFor(kind)),
      updatedAt: "2026-08-31T10:00:00.000Z",
    };
    expect(PiUiStateSchema.parse(state)).toEqual(state);
  });
});

describe("piUiPayloadV2 capability gate", () => {
  it("is a distinct capability from piUiBridge", () => {
    expect(CLIENT_CAPS.piUiPayloadV2).toBe("pi_ui_payload_v2");
    expect(CLIENT_CAPS.piUiPayloadV2).not.toBe(CLIENT_CAPS.piUiBridge);
  });

  it("is accepted on the client hello capabilities", () => {
    const hello = {
      type: "hello",
      clientId: "client-1",
      clientType: "browser",
      protocolVersion: 1,
      capabilities: {
        [CLIENT_CAPS.piUiBridge]: true,
        [CLIENT_CAPS.piUiPayloadV2]: true,
      },
    };
    const parsed = WSHelloMessageSchema.parse(hello);
    expect(parsed.capabilities?.[CLIENT_CAPS.piUiPayloadV2]).toBe(true);
  });

  it("allows a bridge-capable client that does not understand canonical payloads", () => {
    const parsed = WSHelloMessageSchema.parse({
      type: "hello",
      clientId: "client-2",
      clientType: "cli",
      protocolVersion: 1,
      capabilities: { [CLIENT_CAPS.piUiBridge]: true },
    });
    expect(parsed.capabilities?.[CLIENT_CAPS.piUiPayloadV2]).toBeUndefined();
  });

  it("is advertised separately in server_info.features", () => {
    const parsed = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "srv_1",
      features: { piUiBridge: true, piUiPayloadV2: true },
    });
    expect(parsed.features?.piUiPayloadV2).toBe(true);
    expect(parsed.features?.piUiBridge).toBe(true);
  });

  it("keeps piUiPayloadV2 absent when the daemon only advertises the bridge", () => {
    const parsed = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "srv_1",
      features: { piUiBridge: true },
    });
    expect(parsed.features?.piUiPayloadV2).toBeUndefined();
  });
});

describe("regenerated ahead-of-time validator", () => {
  function deltaMessage(element: Record<string, unknown>): unknown {
    return {
      type: "session",
      message: {
        type: "agent_stream",
        payload: {
          agentId: "agt_1",
          timestamp: "2026-08-31T10:00:00.000Z",
          event: {
            type: "pi_ui_delta",
            provider: "pi",
            agentId: "agt_1",
            revision: 1,
            delta: { op: "upsert", element },
          },
        },
      },
    };
  }

  it.each(PiUiKindSchema.options)("round-trips a canonical %s payload", (kind) => {
    const element = elementFor(kind);
    const result = validateWSOutboundMessage(deltaMessage(element));
    expect(result.success).toBe(true);
    if (!result.success) return;
    const message = result.data as {
      message: { payload: { event: { delta: { element: unknown } } } };
    };
    expect(message.message.payload.event.delta.element).toEqual(element);
  });

  it("round-trips the legacy top-level projection without loss", () => {
    const legacy = {
      id: "activity",
      ns: "advisor",
      kind: "log",
      placement: "inline",
      lines: ["one", "two"],
      tail: 200,
    };
    const result = validateWSOutboundMessage(deltaMessage(legacy));
    expect(result.success).toBe(true);
    if (!result.success) return;
    const message = result.data as {
      message: { payload: { event: { delta: { element: unknown } } } };
    };
    expect(message.message.payload.event.delta.element).toEqual(legacy);
  });
});

describe("recorded Pi UI bridge fixtures", () => {
  it("has a recorded fixture for each kind that also has a typed payload schema", () => {
    const recorded = loadAllPiUiBridgeFixtures()
      .map((fixture) => fixture.kind)
      .sort();
    expect(recorded).toEqual([...PI_UI_PAYLOAD_KINDS].sort());
  });

  it.each(PiUiKindSchema.options)(
    "accepts the recorded %s fixture element enriched with its canonical payload",
    (kind) => {
      const fixture = loadPiUiBridgeFixture(kind);
      const upserts = fixture.frames
        .map((frame) => frame.message as Record<string, unknown>)
        .map((message) => {
          const session = message.message as Record<string, unknown> | undefined;
          const payload = session?.payload as Record<string, unknown> | undefined;
          const event = payload?.event as Record<string, unknown> | undefined;
          const delta = event?.delta as Record<string, unknown> | undefined;
          return delta?.op === "upsert" ? (delta.element as Record<string, unknown>) : undefined;
        })
        .filter((element): element is Record<string, unknown> => element !== undefined);

      expect(upserts.length).toBeGreaterThan(0);
      for (const element of upserts) {
        const enriched = { ...element, payload: PAYLOAD_SAMPLES[kind] };
        const parsed = PiUiElementSchema.safeParse(enriched);
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data).toEqual(enriched);
      }
    },
  );
});
