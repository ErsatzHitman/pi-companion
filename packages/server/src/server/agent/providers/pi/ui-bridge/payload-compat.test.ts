import { describe, expect, it } from "vitest";
import { PiUiElementSchema } from "@picompanion/protocol/pi-ui-bridge/schema";
import {
  normalizePiUiElementInput,
  normalizePiUiElementInputs,
  projectPiUiDeltaForClient,
  projectPiUiElementForClient,
  projectPiUiStateForClient,
} from "./payload-compat.js";
import { PiUiDecoder, type PiUiDecodedOp } from "./decoder.js";
import { PIUI_MARKER } from "./schema.js";

type Rec = Record<string, unknown>;

const asRec = (value: unknown): Rec => value as Rec;

describe("normalizePiUiElementInput (plan.md §4.2 step 4)", () => {
  it("lifts v1 top-level fields into a canonical payload for every kind", () => {
    const cases: Array<{ element: Rec; expected: Rec }> = [
      {
        element: {
          id: "s",
          ns: "n",
          kind: "status",
          placement: "status",
          text: "Ready",
          tone: "success",
        },
        expected: { kind: "status", text: "Ready", tone: "success" },
      },
      {
        element: { id: "w", ns: "n", kind: "widget", placement: "pinned", lines: ["a", "b"] },
        expected: { kind: "widget", lines: ["a", "b"] },
      },
      {
        element: {
          id: "p",
          ns: "n",
          kind: "progress",
          placement: "status",
          value: 3,
          max: 7,
          label: "Build",
        },
        expected: { kind: "progress", value: 3, max: 7, label: "Build" },
      },
      {
        element: {
          id: "r",
          ns: "n",
          kind: "roster",
          placement: "inline",
          rows: [{ id: "a", label: "agent-a", state: "running" }],
        },
        expected: { kind: "roster", rows: [{ id: "a", label: "agent-a", state: "running" }] },
      },
      {
        element: {
          id: "l",
          ns: "n",
          kind: "log",
          placement: "inline",
          lines: ["one"],
          tail: 100,
          mono: true,
        },
        expected: { kind: "log", lines: ["one"], tail: 100, mono: true },
      },
      {
        element: { id: "m", ns: "n", kind: "markdown", placement: "inline", text: "# hi" },
        expected: { kind: "markdown", text: "# hi" },
      },
      {
        element: { id: "c", ns: "n", kind: "composer", placement: "inline", text: "draft" },
        expected: { kind: "composer", text: "draft" },
      },
      {
        element: {
          id: "f",
          ns: "n",
          kind: "form",
          placement: "sheet",
          fields: [{ id: "why", kind: "text", label: "Why?" }],
        },
        expected: { kind: "form", fields: [{ id: "why", kind: "text", label: "Why?" }] },
      },
    ];

    for (const { element, expected } of cases) {
      const normalized = asRec(normalizePiUiElementInput(element));
      expect(normalized.payload, `kind ${String(element.kind)}`).toEqual(expected);
    }
  });

  it("accepts the v1 `diff` alias and canonicalizes it to `unifiedDiff`", () => {
    const normalized = asRec(
      normalizePiUiElementInput({
        id: "d",
        ns: "review",
        kind: "diff",
        placement: "inline",
        diff: "--- a\n+++ b\n",
        filePath: "src/a.ts",
      }),
    );
    expect(normalized.payload).toEqual({
      kind: "diff",
      unifiedDiff: "--- a\n+++ b\n",
      filePath: "src/a.ts",
    });
  });

  it("normalizes v1 panel sections into sections with leaf payloads", () => {
    const normalized = asRec(
      normalizePiUiElementInput({
        id: "main",
        ns: "loop",
        kind: "panel",
        placement: "sheet",
        sections: [
          { id: "head", kind: "markdown", text: "## Loop" },
          { id: "tail", kind: "log", lines: ["l1", "l2"] },
        ],
      }),
    );
    const payload = asRec(normalized.payload);
    expect(payload.kind).toBe("panel");
    const sections = payload.sections as Rec[];
    expect(sections[0]?.payload).toEqual({ kind: "markdown", text: "## Loop" });
    expect(sections[1]?.payload).toEqual({ kind: "log", lines: ["l1", "l2"] });
  });

  it("keeps the legacy top-level fields in place so the v1 projection survives", () => {
    const normalized = asRec(
      normalizePiUiElementInput({
        id: "m",
        ns: "n",
        kind: "markdown",
        placement: "inline",
        text: "hello",
      }),
    );
    expect(normalized.text).toBe("hello");
  });

  it("keeps a canonical payload from a new helper authoritative", () => {
    const normalized = asRec(
      normalizePiUiElementInput({
        id: "m",
        ns: "n",
        kind: "markdown",
        placement: "inline",
        payload: { kind: "markdown", text: "canonical" },
        text: "legacy",
      }),
    );
    expect(asRec(normalized.payload).text).toBe("canonical");
  });

  it("preserves extension-specific extras through passthrough", () => {
    const normalized = asRec(
      normalizePiUiElementInput({
        id: "s",
        ns: "n",
        kind: "status",
        placement: "status",
        text: "x",
        icon: "spark",
        somethingNew: { deep: true },
      }),
    );
    expect(asRec(normalized.payload).icon).toBe("spark");
    expect(normalized.somethingNew).toEqual({ deep: true });
  });

  it("returns the element untouched when no valid payload can be derived", () => {
    // `markdown` requires `text`; an incomplete helper element must still pass through.
    const input = { id: "m", ns: "n", kind: "markdown", placement: "inline" };
    expect(normalizePiUiElementInput(input)).toBe(input);
  });

  it("passes through unknown kinds and non-objects", () => {
    const unknownKind = { id: "x", ns: "n", kind: "hologram", placement: "inline", text: "t" };
    expect(normalizePiUiElementInput(unknownKind)).toBe(unknownKind);
    expect(normalizePiUiElementInput(null)).toBeNull();
    expect(normalizePiUiElementInput("nope")).toBe("nope");
  });

  it("normalizes lists in order", () => {
    const out = normalizePiUiElementInputs([
      { id: "a", ns: "n", kind: "markdown", placement: "inline", text: "a" },
      { id: "b", ns: "n", kind: "markdown", placement: "inline", text: "b" },
    ]);
    expect(out.map((e) => asRec(asRec(e).payload).text)).toEqual(["a", "b"]);
  });

  it("produces elements that still satisfy the shared wire schema", () => {
    const normalized = normalizePiUiElementInput({
      id: "w",
      ns: "todo",
      kind: "widget",
      placement: "pinned",
      rows: [{ label: "task", value: "done" }],
    });
    expect(PiUiElementSchema.safeParse(normalized).success).toBe(true);
  });
});

describe("PiUiDecoder normalization (plan.md §4.2 steps 4-5)", () => {
  function decode(lines: string[]): PiUiDecodedOp[] {
    const ops: PiUiDecodedOp[] = [];
    const notices: string[] = [];
    const decoder = new PiUiDecoder({
      onOp: (op) => ops.push(op),
      onNotice: (level, message) => notices.push(`${level}: ${message}`),
    });
    for (const line of lines) decoder.ingest(PIUI_MARKER + line);
    decoder.destroy();
    expect(notices).toEqual([]);
    return ops;
  }

  it("accepts an old helper `set` message and attaches a canonical payload", () => {
    const [op] = decode([
      JSON.stringify({
        v: 1,
        op: "set",
        el: { id: "activity", ns: "advisor", kind: "log", placement: "inline", lines: ["boot"] },
      }),
    ]);
    expect(op?.kind).toBe("set");
    const el = asRec(op && "el" in op ? op.el : undefined);
    expect(el.payload).toEqual({ kind: "log", lines: ["boot"] });
    expect(el.lines).toEqual(["boot"]);
  });

  it("accepts a canonical payload `set` message unchanged", () => {
    const [op] = decode([
      JSON.stringify({
        v: 1,
        op: "set",
        el: {
          id: "activity",
          ns: "advisor",
          kind: "log",
          placement: "inline",
          payload: { kind: "log", lines: ["boot"] },
        },
      }),
    ]);
    const el = asRec(op && "el" in op ? op.el : undefined);
    expect(el.payload).toEqual({ kind: "log", lines: ["boot"] });
  });

  it("normalizes every element of a `sync` op", () => {
    const [op] = decode([
      JSON.stringify({
        v: 1,
        op: "sync",
        elements: [
          { id: "s", ns: "goal", kind: "status", placement: "status", text: "Running" },
          {
            id: "m",
            ns: "btw",
            kind: "markdown",
            placement: "inline",
            payload: { kind: "markdown", text: "note" },
          },
        ],
      }),
    ]);
    expect(op?.kind).toBe("sync");
    const elements = (op && "elements" in op ? op.elements : []) as Rec[];
    expect(elements.map((e) => asRec(e.payload).kind)).toEqual(["status", "markdown"]);
  });
});

describe("projectPiUiElementForClient (plan.md §4.2 step 6)", () => {
  const legacyHelperElement = {
    id: "activity",
    ns: "advisor",
    kind: "log",
    placement: "inline",
    title: "Advisor",
    lines: ["one", "two"],
    tail: 50,
  };
  const canonicalElement = {
    id: "activity",
    ns: "advisor",
    kind: "log",
    placement: "inline",
    title: "Advisor",
    payload: { kind: "log", lines: ["one", "two"], tail: 50 },
  };

  it("old helper → new client: canonical payload, no duplicated top-level fields", () => {
    const projected = asRec(
      projectPiUiElementForClient(normalizePiUiElementInput(legacyHelperElement), true),
    );
    expect(projected.payload).toEqual({ kind: "log", lines: ["one", "two"], tail: 50 });
    expect(projected.lines).toBeUndefined();
    expect(projected.tail).toBeUndefined();
    expect(projected.title).toBe("Advisor");
  });

  it("old helper → old client: unchanged v1 top-level fields, no payload", () => {
    const projected = asRec(
      projectPiUiElementForClient(normalizePiUiElementInput(legacyHelperElement), false),
    );
    expect(projected.payload).toBeUndefined();
    expect(projected.lines).toEqual(["one", "two"]);
    expect(projected.tail).toBe(50);
  });

  it("new helper → old client: payload is projected back to top-level fields", () => {
    const projected = asRec(projectPiUiElementForClient(canonicalElement, false));
    expect(projected.payload).toBeUndefined();
    expect(projected.lines).toEqual(["one", "two"]);
    expect(projected.tail).toBe(50);
  });

  it("new helper → new client: payload survives untouched", () => {
    const projected = asRec(projectPiUiElementForClient(canonicalElement, true));
    expect(projected.payload).toEqual({ kind: "log", lines: ["one", "two"], tail: 50 });
  });

  it("round-trips a payload through the legacy projection without loss", () => {
    for (const source of [legacyHelperElement, canonicalElement]) {
      const normalized = normalizePiUiElementInput(source);
      const downgraded = projectPiUiElementForClient(normalized, false);
      const upgraded = asRec(projectPiUiElementForClient(downgraded, true));
      expect(upgraded.payload).toEqual(asRec(normalizePiUiElementInput(source)).payload);
    }
  });

  it("downgrades a diff payload to both `unifiedDiff` and the v1 `diff` alias", () => {
    const projected = asRec(
      projectPiUiElementForClient(
        {
          id: "d",
          ns: "review",
          kind: "diff",
          placement: "inline",
          payload: { kind: "diff", unifiedDiff: "--- a\n+++ b\n" },
        },
        false,
      ),
    );
    expect(projected.unifiedDiff).toBe("--- a\n+++ b\n");
    expect(projected.diff).toBe("--- a\n+++ b\n");
  });

  it("downgrades panel sections recursively", () => {
    const normalized = normalizePiUiElementInput({
      id: "main",
      ns: "loop",
      kind: "panel",
      placement: "sheet",
      sections: [{ id: "head", kind: "markdown", text: "## Loop" }],
    });
    const downgraded = asRec(projectPiUiElementForClient(normalized, false));
    const sections = downgraded.sections as Rec[];
    expect(downgraded.payload).toBeUndefined();
    expect(sections[0]?.payload).toBeUndefined();
    expect(sections[0]?.text).toBe("## Loop");
  });

  it("keeps both projections valid against the shared wire schema", () => {
    const normalized = normalizePiUiElementInput(legacyHelperElement);
    for (const capable of [true, false]) {
      const projected = projectPiUiElementForClient(normalized, capable);
      expect(PiUiElementSchema.safeParse(projected).success).toBe(true);
    }
  });
});

describe("state and delta projection", () => {
  const element = normalizePiUiElementInput({
    id: "s",
    ns: "goal",
    kind: "status",
    placement: "status",
    text: "Running",
  });

  it("projects every element of a state", () => {
    const state = {
      agentId: "a",
      revision: 3,
      elements: [element],
      updatedAt: "2026-08-31T00:00:00.000Z",
    };
    expect(asRec(asRec(projectPiUiStateForClient(state, true).elements[0]).payload).text).toBe(
      "Running",
    );
    expect(asRec(projectPiUiStateForClient(state, false).elements[0]).payload).toBeUndefined();
  });

  it("projects `upsert` and `reset` deltas and leaves `remove` alone", () => {
    const upsert = projectPiUiDeltaForClient({ op: "upsert", element }, false);
    expect(asRec(asRec(upsert).element).payload).toBeUndefined();

    const reset = projectPiUiDeltaForClient(
      { op: "reset", elements: [element], revision: 4 },
      true,
    );
    expect(asRec((asRec(reset).elements as unknown[])[0]).payload).toBeDefined();

    const remove = { op: "remove", id: "s", ns: "goal" };
    expect(projectPiUiDeltaForClient(remove, true)).toBe(remove);
  });
});
