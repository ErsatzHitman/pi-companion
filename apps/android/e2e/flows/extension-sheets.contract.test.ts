import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  PiUiElement,
  PiUiFormField,
  PiUiPanelSection,
} from "@picompanion/protocol/pi-ui-bridge/schema";

import {
  PiUiRendererRegistry,
  type PiUiKindRenderer,
} from "../../src/features/extensions/registry";
import {
  buildPanelRenderModel,
  resolvePanelChildDecision,
} from "../../src/features/extensions/renderers/panel-model";
import { buildRosterRenderModel } from "../../src/features/extensions/renderers/roster-model";
import {
  buildFormRenderModel,
  resolveFormSubmitGate,
} from "../../src/features/extensions/renderers/form-model";
import { FORM_FLOW, PANEL_FLOW, ROSTER_FLOW } from "./extension-sheets-contract";

/**
 * T37E5 — proves every testId/string `../../maestro/extension-sheets.yaml`
 * names still exists in the real source it targets, and separately proves
 * three real state transitions with concrete values (a zero-row roster, an
 * invalid form submit, and a panel that keeps functioning while one of its
 * sections has not resolved to a renderable state) against the real
 * RN-free model modules — never a rendered component (this workspace's
 * `vitest` cannot parse `react-native`, per every sibling `*-model.test.ts`
 * in this directory).
 *
 * Two proof strategies, chosen per module, exactly matching
 * `pairing.contract.test.ts`'s precedent:
 *
 * - `roster-model.ts`, `form-model.ts`, `panel-model.ts`, and `registry.ts`
 *   are RN-free, so this file imports them directly and calls the real
 *   functions — stronger than a source-text match.
 * - `roster.tsx`, `form.tsx`, `panel.tsx` reach `react-native` and cannot
 *   be imported here, so those are proven with `readCode()`/
 *   `readComponentCode()` — comment-stripped source matched against a
 *   full JSX/prop expression or template literal, never a bare
 *   identifier (`CLAUDE.md`'s "SOURCE-TEXT REGEX TESTS ARE ON PROBATION"
 *   note), anchored to the one top-level function each assertion names
 *   (its "sibling occurrence" note) since this directory's renderer files
 *   each declare several top-level functions that could otherwise satisfy
 *   an unanchored match.
 *
 * Mutation-checked (see the wave report for the exact mutations, their
 * failures, and the byte-identical restores, diffed against a backup kept
 * outside the repo): the roster row testId template, the form sheet
 * `testId` prop wiring, and the panel nesting-limit branch's early return.
 */

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * `readCode(relativePath)` sliced to a single top-level function's body
 * (`(?:export )?function <name>(` through the next top-level `function `
 * or end of file) — see this file's doc comment and
 * `../../src/app/h/[serverId]/session/[agentId]/index.test.ts`'s
 * `readComponentCode` for why an unanchored whole-file match is not
 * trustworthy in a file that declares more than one function.
 */
function readComponentCode(relativePath: string, name: string): string {
  const code = readCode(relativePath);
  const startPattern = new RegExp(`^(?:export )?function ${name}\\(`, "m");
  const startMatch = startPattern.exec(code);
  expect(startMatch, `${relativePath} should declare a top-level function ${name}`).not.toBeNull();
  const start = startMatch!.index;
  const nextPattern = /^(?:export )?function \w+\(/gm;
  nextPattern.lastIndex = start + 1;
  const nextMatch = nextPattern.exec(code);
  const end = nextMatch ? nextMatch.index : code.length;
  return code.slice(start, end);
}

describe("extension-sheets.yaml anchors exist in source", () => {
  describe("session/[agentId]/index.tsx (the arrival screen)", () => {
    it('SessionTranscript renders TranscriptWindowList with testId="session-transcript"', () => {
      const code = readComponentCode(
        "../../src/app/h/[serverId]/session/[agentId]/index.tsx",
        "SessionTranscript",
      );
      expect(code).toMatch(
        /<TranscriptWindowList\s+entries=\{entries\}\s+testId="session-transcript"/,
      );
    });
  });

  describe("roster.tsx", () => {
    it("RosterRenderer's Card carries testID={testId} built as `pi-roster-${element.ns}-${element.id}`", () => {
      const code = readComponentCode(
        "../../src/features/extensions/renderers/roster.tsx",
        "RosterRenderer",
      );
      expect(code).toMatch(/const testId = `pi-roster-\$\{element\.ns\}-\$\{element\.id\}`;/);
      expect(code).toMatch(/<Card style=\{styles\.card\} testID=\{testId\}/);
    });

    it("RosterRow's outer View carries testID={`pi-roster-row-${row.key}`}", () => {
      const code = readComponentCode(
        "../../src/features/extensions/renderers/roster.tsx",
        "RosterRow",
      );
      expect(code).toMatch(/testID=\{`pi-roster-row-\$\{row\.key\}`\}/);
    });

    it("RosterRow's row-action Button carries testId={`pi-roster-row-${row.key}-action-${action.id}`}", () => {
      const code = readComponentCode(
        "../../src/features/extensions/renderers/roster.tsx",
        "RosterRow",
      );
      expect(code).toMatch(/testId=\{`pi-roster-row-\$\{row\.key\}-action-\$\{action\.id\}`\}/);
    });

    it("ROSTER_FLOW's id helpers agree with the templates above", () => {
      expect(ROSTER_FLOW.cardTestId("subagents", "fleet")).toBe("pi-roster-subagents-fleet");
      expect(ROSTER_FLOW.rowTestId("agent-1")).toBe("pi-roster-row-agent-1");
      expect(ROSTER_FLOW.rowActionTestId("agent-1", "stop")).toBe(
        "pi-roster-row-agent-1-action-stop",
      );
    });
  });

  describe("form.tsx", () => {
    it("FormRenderer wraps its content in Sheet with testId built as `pi-form-${element.ns}-${element.id}`, unconditionally (no placement check)", () => {
      const code = readComponentCode(
        "../../src/features/extensions/renderers/form.tsx",
        "FormRenderer",
      );
      expect(code).toMatch(/const testId = `pi-form-\$\{element\.ns\}-\$\{element\.id\}`;/);
      expect(code).toMatch(/<Sheet\s+open\s+title=\{model\.title\}/);
      expect(code).not.toMatch(/element\.placement/);
      expect(code).toMatch(/testId=\{testId\}/);
    });

    it("FormRenderer's Sheet description falls back to 'Fill in the form below.' when payload.description is unset", () => {
      const code = readComponentCode(
        "../../src/features/extensions/renderers/form.tsx",
        "FormRenderer",
      );
      expect(code).toMatch(/description=\{model\.description \?\? "Fill in the form below\."\}/);
    });

    it("FormFieldRow's field primitive carries testId={testId}, one row per field.id", () => {
      const code = readComponentCode(
        "../../src/features/extensions/renderers/form.tsx",
        "FormRenderer",
      );
      expect(code).toMatch(/testId=\{`\$\{testId\}-field-\$\{fieldModel\.field\.id\}`\}/);
    });

    it("FormRenderer's action Button carries testId={`${testId}-action-${actionModel.id}`}", () => {
      const code = readComponentCode(
        "../../src/features/extensions/renderers/form.tsx",
        "FormRenderer",
      );
      expect(code).toMatch(/testId=\{`\$\{testId\}-action-\$\{actionModel\.id\}`\}/);
    });

    it("FORM_FLOW's id helpers agree with the templates above", () => {
      expect(FORM_FLOW.sheetTestId("ask-user", "confirm")).toBe("pi-form-ask-user-confirm");
      expect(FORM_FLOW.fieldTestId("pi-form-ask-user-confirm", "host")).toBe(
        "pi-form-ask-user-confirm-field-host",
      );
      expect(FORM_FLOW.actionTestId("pi-form-ask-user-confirm", "submit")).toBe(
        "pi-form-ask-user-confirm-action-submit",
      );
    });
  });

  describe("panel.tsx", () => {
    it("PanelRenderer's testId is built as `pi-panel-${element.ns}-${element.id}`, and only element.placement === 'sheet' opens a Sheet", () => {
      const code = readComponentCode(
        "../../src/features/extensions/renderers/panel.tsx",
        "PanelRenderer",
      );
      expect(code).toMatch(/const testId = `pi-panel-\$\{element\.ns\}-\$\{element\.id\}`;/);
      expect(code).toMatch(/if \(element\.placement === "sheet"\) \{/);
    });

    it("PanelBody renders every resolved section inside a `${testId}-sections` ScrollView, each section wrapped in `${testId}-section-${decision.sectionId}`", () => {
      const code = readComponentCode(
        "../../src/features/extensions/renderers/panel.tsx",
        "PanelBody",
      );
      expect(code).toMatch(/testID=\{`\$\{testId\}-sections`\}/);
    });

    it("PanelChildView's section View carries testID={testId} built from `${parentTestId}-section-${decision.sectionId}`", () => {
      const code = readComponentCode(
        "../../src/features/extensions/renderers/panel.tsx",
        "PanelChildView",
      );
      expect(code).toMatch(
        /const testId = `\$\{parentTestId\}-section-\$\{decision\.sectionId\}`;/,
      );
      expect(code).toMatch(/<View style=\{styles\.section\} testID=\{testId\}>/);
    });

    it("PANEL_FLOW's id helpers agree with the templates above", () => {
      expect(PANEL_FLOW.cardTestId("loop", "loop")).toBe("pi-panel-loop-loop");
      expect(PANEL_FLOW.sectionsTestId("pi-panel-loop-loop")).toBe("pi-panel-loop-loop-sections");
      expect(PANEL_FLOW.sectionTestId("pi-panel-loop-loop", "status")).toBe(
        "pi-panel-loop-loop-section-status",
      );
    });
  });
});

describe("real state transitions (concrete values, RN-free models)", () => {
  it("a roster with zero rows resolves emptyText to 'No rows to show.' and an empty rows array — never a thrown error or a placeholder row", () => {
    const model = buildRosterRenderModel(
      { ns: "subagents", title: undefined },
      { kind: "roster", rows: [] },
    );
    expect(model.rows).toEqual([]);
    expect(model.emptyText).toBe(ROSTER_FLOW.emptyText);
  });

  it("submitting a form's primary action with a required text field left empty is blocked: allowed=false, one field error, and the one-field summary line", () => {
    const fields: PiUiFormField[] = [
      { kind: "text", id: "host", label: "Host name", required: true },
    ];
    const gate = resolveFormSubmitGate({ variant: "primary" }, fields, {});
    expect(gate.allowed).toBe(false);
    expect(gate.errors).toEqual({ host: "Host name is required." });
    expect(gate.errorSummary).toBe(FORM_FLOW.oneFieldErrorSummary);
  });

  it("the same gate allows submission once the required field is filled", () => {
    const fields: PiUiFormField[] = [
      { kind: "text", id: "host", label: "Host name", required: true },
    ];
    const gate = resolveFormSubmitGate({ variant: "primary" }, fields, { host: "10.0.2.2" });
    expect(gate).toEqual({ allowed: true, errors: {}, errorSummary: undefined });
  });

  it("a form with zero fields resolves emptyText to 'No fields to show.'", () => {
    const model = buildFormRenderModel(
      { ns: "ask-user", title: undefined },
      { kind: "form", fields: [] },
      {},
      {},
    );
    expect(model.fields).toEqual([]);
    expect(model.emptyText).toBe(FORM_FLOW.emptyText);
  });

  it("a panel dismissed mid-load: one section still unresolved ('no-renderer', nothing registered for it) sits alongside a sibling that resolved 'ok' — the panel's own render model still computes cleanly for both, and dismissing (panel.tsx's onClose, proven above to be unconditional on element.placement, never on a section's status) is never blocked by the unresolved section", () => {
    const registry = new PiUiRendererRegistry();
    function FakeStatusRenderer() {
      return null;
    }
    registry.register("status", FakeStatusRenderer as unknown as PiUiKindRenderer<"status">);
    // "log" is deliberately left unregistered, modelling a section still
    // mid-load from the daemon's point of view (no renderer claimed it yet).

    const parent: Pick<PiUiElement, "id" | "ns"> = { id: "loop", ns: "loop" };
    const sections: PiUiPanelSection[] = [
      { id: "status", kind: "status", payload: { kind: "status", text: "Running" } },
      { id: "log", kind: "log" },
    ];

    const okDecision = resolvePanelChildDecision(parent, sections[0]!, registry);
    const pendingDecision = resolvePanelChildDecision(parent, sections[1]!, registry);
    expect(okDecision.status).toBe("ok");
    expect(pendingDecision.status).toBe("no-renderer");

    const model = buildPanelRenderModel(
      { id: "loop", ns: "loop", title: undefined },
      { kind: "panel", sections },
      registry,
    );
    expect(model.children.map((child) => child.status)).toEqual(["ok", "no-renderer"]);
    expect(model.emptyText).toBeUndefined();
  });

  it("a panel with zero sections resolves emptyText to 'No sections to show.'", () => {
    const registry = new PiUiRendererRegistry();
    const model = buildPanelRenderModel(
      { id: "loop", ns: "loop", title: undefined },
      { kind: "panel", sections: [] },
      registry,
    );
    expect(model.children).toEqual([]);
    expect(model.emptyText).toBe(PANEL_FLOW.emptyText);
  });
});
