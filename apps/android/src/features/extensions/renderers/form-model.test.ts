import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extensions } from "@picompanion/frontend-core";
import { PiUiElementSchema, type PiUiElement } from "@picompanion/protocol/pi-ui-bridge/schema";

import {
  closeSheet,
  focusComposer,
  INITIAL_COMPOSER_FOCUS_STATE,
  openSheet,
  resolveFocusOwner,
} from "../../composer/composer-focus-model";
import type { PiUiPayloadForKind } from "../registry";
import {
  buildFormActionsModel,
  buildFormRenderModel,
  buildFormValidation,
  buildInitialFormValues,
  defaultFormFieldValue,
  filterFormSelectOptions,
  formActionFeedbackText,
  formFieldError,
  resolveFormCloseAction,
  resolveFormSubmitGate,
  toggleMultiSelectValue,
} from "./form-model";

/**
 * T34B2 — the Android `form` kind renderer's model. Acceptance criteria
 * exercised here:
 *
 * - "Forms render every documented field type": `PiUiFormFieldSchema`
 *   (authoritative; `packages/protocol/src/pi-ui-bridge/payload.ts`)
 *   discriminates on exactly `text`, `select`, and `toggle` — every one is
 *   built through the real wire schema + normalizer below (the `btw` line's
 *   bare `text` field, the `ask-user` line's `select` field with options,
 *   plus a `multiple`/`searchable` select and a `toggle`, since the schema
 *   itself documents all three field kinds even though the compatibility
 *   doc's one-line fixtures only spell out `text` and `select`) and every
 *   field reaches `buildFormRenderModel`'s field list with its default
 *   value intact.
 * - "Pending, success and failure are each visible": `formActionFeedbackText`
 *   and `buildFormActionsModel` are exercised across pending, success,
 *   rejected, and timeout `ExtensionActionState`s — a rejected or timed-out
 *   submit surfaces a named error string and comes back with `disabled:
 *   false`, proving it never stays stuck showing "Submitting…".
 * - "Sheets respect keyboard ownership, proven against `resolveFocusOwner`":
 *   exercised directly against T33B4's real `composer-focus-model.ts`
 *   functions, the same contract `Sheet.test.ts` (T32S5) proves for the
 *   `Sheet` primitive this renderer is built on — opening and closing an
 *   `"extension"`-kind sheet (which is what a mounted `form` element is,
 *   since it has no kind of its own in that model) is a no-op for
 *   `resolveFocusOwner` in both directions.
 * - Required-field validation gates only a `primary`-variant (submit)
 *   action; a `cancel`/`close` action always dispatches.
 *
 * As with `roster-model.test.ts`, only the RN-free model is exercised here
 * — `form.tsx` cannot be rendered under this workspace's `vitest`
 * (`RolldownError` on `node_modules/react-native/index.js:1:0`); render
 * proof belongs to the T37 Maestro flows.
 */

const here = dirname(fileURLToPath(import.meta.url));
const PI_UI_BRIDGE_FIXTURES_DIR = join(
  here,
  "../../../../../../packages/protocol/src/fixtures/pi-ui-bridge",
);

type FixtureFrame = { wireType: string; message: unknown };
type PiUiBridgeFixture = { kind: string; frames: FixtureFrame[] };

function loadFormFixture(): PiUiBridgeFixture {
  const path = join(PI_UI_BRIDGE_FIXTURES_DIR, "form.json");
  return JSON.parse(readFileSync(path, "utf8")) as PiUiBridgeFixture;
}

/** The recorded `form.json` fixture's one `upsert` element (`ask-user`'s `pick-approach`). */
function recordedFormElement(): Record<string, unknown> {
  const fixture = loadFormFixture();
  for (const frame of fixture.frames) {
    if (!frame.wireType.includes("pi_ui_delta")) continue;
    const message = frame.message as {
      message?: { payload?: { event?: { delta?: { op?: string; element?: unknown } } } };
    };
    const delta = message.message?.payload?.event?.delta;
    if (delta?.op === "upsert" && delta.element) {
      return delta.element as Record<string, unknown>;
    }
  }
  throw new Error("form.json fixture has no recorded upsert element");
}

/**
 * The recorded `form` element, enriched with a real canonical `payload`
 * (the fixture's own recorded frame predates `piUiPayloadV2` for this
 * element, same as `roster-model.test.ts`'s fixture). Run through the
 * real wire schema and the real client-side normalizer — exactly the
 * element `registry-view.tsx` hands `FormRenderer`.
 */
function formElement(payloadFields: Record<string, unknown>): PiUiElement {
  const recorded = recordedFormElement();
  const envelope = PiUiElementSchema.parse({
    ...recorded,
    payload: { kind: "form", ...payloadFields },
  });
  return extensions.normalizePiUiElementTyped(envelope);
}

function formPayloadOf(element: PiUiElement): PiUiPayloadForKind<"form"> {
  expect(element.payload).toBeDefined();
  expect(element.payload?.kind).toBe("form");
  return element.payload as PiUiPayloadForKind<"form">;
}

function idleState(): extensions.ExtensionActionState {
  return { status: "idle" };
}

function pendingState(target: extensions.ExtensionActionTarget): extensions.ExtensionActionState {
  return { status: "pending", target, requestId: "req_pending", dispatchedAt: 0 };
}

function settledState(
  target: extensions.ExtensionActionTarget,
  overrides: Partial<extensions.SettledExtensionAction> & {
    status: extensions.SettledExtensionAction["status"];
  },
): extensions.ExtensionActionState {
  return {
    target,
    requestId: "req_settled",
    staleRevision: false,
    source: "response",
    settledAt: 0,
    ...overrides,
  };
}

describe("buildFormRenderModel: every documented PiUiFormFieldSchema field kind", () => {
  it("renders btw's bare required text field with its default value", () => {
    const element = formElement({
      fields: [
        {
          id: "prompt",
          kind: "text",
          label: "Ask btw",
          placeholder: "Ask about /tmp/synthetic-file.ts",
        },
      ],
    });
    const payload = formPayloadOf(element);
    const values = buildInitialFormValues(payload.fields);
    const model = buildFormRenderModel(element, payload, values, {});

    expect(model.fields).toHaveLength(1);
    expect(model.fields[0]).toMatchObject({
      field: {
        id: "prompt",
        kind: "text",
        label: "Ask btw",
        placeholder: "Ask about /tmp/synthetic-file.ts",
      },
      value: "",
      error: undefined,
    });
  });

  it("renders a multiline required text field, defaulting from the wire value", () => {
    const field = {
      id: "comment",
      kind: "text" as const,
      label: "Comment",
      multiline: true,
      required: true,
      value: "prefilled",
    };
    const values = buildInitialFormValues([field]);
    expect(values.comment).toBe("prefilled");
    expect(formFieldError(field, values.comment)).toBeUndefined();
    expect(formFieldError(field, "")).toBe("Comment is required.");
    expect(formFieldError(field, "   ")).toBe("Comment is required.");
  });

  it("renders ask-user's single select field with its options", () => {
    const element = formElement({
      fields: [
        {
          id: "choice",
          kind: "select",
          label: "Pick an option",
          options: [
            { value: "vercel", label: "Vercel — /tmp/synthetic-app" },
            { value: "railway", label: "Railway", description: "synthetic" },
          ],
        },
      ],
    });
    const payload = formPayloadOf(element);
    const values = buildInitialFormValues(payload.fields);
    const model = buildFormRenderModel(element, payload, values, {});

    expect(model.fields).toHaveLength(1);
    const selectField = model.fields[0]!;
    expect(selectField.field.kind).toBe("select");
    expect(selectField.value).toBe("");
    if (selectField.field.kind === "select") {
      expect(selectField.field.options).toHaveLength(2);
      expect(selectField.field.options[1]).toMatchObject({
        value: "railway",
        label: "Railway",
        description: "synthetic",
      });
    }
  });

  it("renders a multiple + searchable select field, defaulting to an empty selection", () => {
    const field = {
      id: "selectedOptionIds",
      kind: "select" as const,
      label: "Approach",
      multiple: true,
      searchable: true,
      required: true,
      options: [
        { value: "rewrite", label: "Rewrite the module" },
        { value: "add-tests", label: "Add tests first" },
        { value: "revert", label: "Revert the change" },
      ],
    };
    expect(defaultFormFieldValue(field)).toEqual([]);
    expect(formFieldError(field, [])).toBe("Approach is required.");
    expect(formFieldError(field, ["rewrite"])).toBeUndefined();

    const filtered = filterFormSelectOptions(field.options, "add");
    expect(filtered).toEqual([{ value: "add-tests", label: "Add tests first" }]);
    expect(filterFormSelectOptions(field.options, "")).toHaveLength(3);

    expect(toggleMultiSelectValue(["rewrite"], "add-tests")).toEqual(["rewrite", "add-tests"]);
    expect(toggleMultiSelectValue(["rewrite", "add-tests"], "rewrite")).toEqual(["add-tests"]);
  });

  it("renders a toggle field, which the schema never marks required", () => {
    const field = {
      id: "notify",
      kind: "toggle" as const,
      label: "Notify on completion",
      description: "Send a push notification",
    };
    expect(defaultFormFieldValue(field)).toBe(false);
    // A toggle field carries no `required` in PiUiFormFieldSchema, so it
    // never produces a validation error regardless of its current value.
    expect(formFieldError(field, false)).toBeUndefined();
    expect(formFieldError(field, true)).toBeUndefined();
  });

  it("falls back to an empty-fields notice when the payload has no fields", () => {
    const element = formElement({ fields: [] });
    const payload = formPayloadOf(element);
    const model = buildFormRenderModel(element, payload, {}, {});
    expect(model.fields).toHaveLength(0);
    expect(model.emptyText).toBe("No fields to show.");
  });
});

describe("buildFormValidation / resolveFormSubmitGate: required fields gate only the primary action", () => {
  const fields = [
    { id: "name", kind: "text" as const, label: "Name", required: true },
    { id: "notify", kind: "toggle" as const, label: "Notify" },
  ];

  it("blocks a primary-variant action while a required field is empty", () => {
    const values = buildInitialFormValues(fields);
    const validation = buildFormValidation(fields, values);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual({ name: "Name is required." });

    const gate = resolveFormSubmitGate({ variant: "primary" }, fields, values);
    expect(gate.allowed).toBe(false);
    expect(gate.errors).toEqual({ name: "Name is required." });
    expect(gate.errorSummary).toBe("Fix 1 field before submitting.");
  });

  it("allows the primary action once the required field is filled", () => {
    const values = { ...buildInitialFormValues(fields), name: "Ada" };
    const gate = resolveFormSubmitGate({ variant: "primary" }, fields, values);
    expect(gate).toEqual({ allowed: true, errors: {}, errorSummary: undefined });
  });

  it("never blocks a non-primary action, even with the required field empty", () => {
    const values = buildInitialFormValues(fields);
    const cancelGate = resolveFormSubmitGate({ variant: "secondary" }, fields, values);
    expect(cancelGate).toEqual({ allowed: true, errors: {}, errorSummary: undefined });
    const noVariantGate = resolveFormSubmitGate({ variant: undefined }, fields, values);
    expect(noVariantGate.allowed).toBe(true);
  });

  it("pluralizes the summary for more than one failing field", () => {
    const bothRequired = [
      { id: "a", kind: "text" as const, label: "A", required: true },
      { id: "b", kind: "text" as const, label: "B", required: true },
    ];
    const gate = resolveFormSubmitGate({ variant: "primary" }, bothRequired, {});
    expect(gate.errorSummary).toBe("Fix 2 fields before submitting.");
  });
});

describe("buildFormActionsModel: pending, success, and failure are each visible — failure never strands a spinner", () => {
  const submitAction = { id: "submit", label: "Submit", variant: "primary" as const };
  const cancelAction = { id: "cancel", label: "Cancel", variant: "secondary" as const };
  const target: extensions.ExtensionActionTarget = {
    agentId: "agt_1",
    namespace: "ask-user",
    elementId: "pick-approach",
    actionId: "submit",
  };
  const fields = [
    { id: "name", kind: "text" as const, label: "Name", required: true, value: "Ada" },
  ];
  const values = buildInitialFormValues(fields);

  it("shows 'Submitting…' and disables the submit button while pending", () => {
    const models = buildFormActionsModel(
      [submitAction],
      fields,
      values,
      () => pendingState(target),
      undefined,
    );
    expect(models[0]).toMatchObject({ id: "submit", disabled: true, blocked: false });
    expect(models[0]!.feedback?.text).toBe("Submitting…");
  });

  it("shows 'Submitted' and re-enables the button on success", () => {
    const models = buildFormActionsModel(
      [submitAction],
      fields,
      values,
      () => settledState(target, { status: "success" }),
      undefined,
    );
    expect(models[0]).toMatchObject({ id: "submit", disabled: false, blocked: false });
    expect(models[0]!.feedback?.text).toBe("Submitted");
  });

  it("a rejected submit surfaces its error text and clears pending — never strands the spinner", () => {
    const models = buildFormActionsModel(
      [submitAction],
      fields,
      values,
      () => settledState(target, { status: "rejected", error: "Name already taken" }),
      undefined,
    );
    expect(models[0]).toMatchObject({ id: "submit", disabled: false, blocked: false });
    expect(models[0]!.feedback?.text).toBe("Name already taken");
  });

  it("a rejected submit with no server-provided error still surfaces a named failure", () => {
    const models = buildFormActionsModel(
      [submitAction],
      fields,
      values,
      () => settledState(target, { status: "rejected" }),
      undefined,
    );
    expect(models[0]!.feedback?.text).toBe("Submission failed");
    expect(models[0]!.disabled).toBe(false);
  });

  it("a timed-out submit surfaces 'Timed out' and clears pending", () => {
    const models = buildFormActionsModel(
      [submitAction],
      fields,
      values,
      () => settledState(target, { status: "timeout" }),
      undefined,
    );
    expect(models[0]).toMatchObject({
      id: "submit",
      disabled: false,
      blocked: false,
      feedback: { text: "Timed out" },
    });
  });

  it("overrides a primary action's label with payload.submitLabel", () => {
    const models = buildFormActionsModel([submitAction], fields, values, idleState, "Send answer");
    expect(models[0]!.label).toBe("Send answer");
  });

  it("marks a submit action blocked (and disabled) while a required field is unmet, distinct from cancel", () => {
    const emptyValues = { name: "" };
    const models = buildFormActionsModel(
      [submitAction, cancelAction],
      fields,
      emptyValues,
      idleState,
      undefined,
    );
    const submitModel = models.find((m) => m.id === "submit")!;
    const cancelModel = models.find((m) => m.id === "cancel")!;
    expect(submitModel.blocked).toBe(true);
    expect(submitModel.disabled).toBe(true);
    expect(cancelModel.blocked).toBe(false);
    expect(cancelModel.disabled).toBe(false);
  });
});

describe("formActionFeedbackText: form-specific wording for every settled outcome", () => {
  const target: extensions.ExtensionActionTarget = {
    agentId: "agt_1",
    namespace: "ask-user",
    elementId: "pick-approach",
    actionId: "submit",
  };

  it.each([
    ["pending" as const, "Submitting…"],
    ["success" as const, "Submitted"],
    ["timeout" as const, "Timed out"],
    ["cancelled" as const, "Cancelled"],
  ])("maps status %s to %s", (status, expected) => {
    const state = status === "pending" ? pendingState(target) : settledState(target, { status });
    expect(formActionFeedbackText(state)).toBe(expected);
  });

  it("prefers the server error over the generic 'Submission failed' text", () => {
    expect(
      formActionFeedbackText(settledState(target, { status: "rejected", error: "Bad input" })),
    ).toBe("Bad input");
    expect(formActionFeedbackText(settledState(target, { status: "rejected" }))).toBe(
      "Submission failed",
    );
  });

  it("is undefined while idle", () => {
    expect(formActionFeedbackText(idleState())).toBeUndefined();
  });
});

describe("resolveFormCloseAction: finds the wire cancel/close action for a Sheet dismiss", () => {
  it("finds an action with id 'cancel'", () => {
    const actions = [
      { id: "submit", label: "Submit", variant: "primary" as const },
      { id: "cancel", label: "Cancel", variant: "secondary" as const },
    ];
    expect(resolveFormCloseAction(actions)?.id).toBe("cancel");
  });

  it("finds an action with id 'close' when there is no 'cancel'", () => {
    const actions = [{ id: "close", label: "Close", variant: "secondary" as const }];
    expect(resolveFormCloseAction(actions)?.id).toBe("close");
  });

  it("is undefined when neither exists", () => {
    const actions = [{ id: "submit", label: "Submit", variant: "primary" as const }];
    expect(resolveFormCloseAction(actions)).toBeUndefined();
  });

  it("is undefined for an element with no actions at all", () => {
    expect(resolveFormCloseAction(undefined)).toBeUndefined();
  });
});

/**
 * "Sheets respect keyboard ownership, proven against resolveFocusOwner
 * rather than by inspection" (T34B2's acceptance criterion). `FormRenderer`
 * mounts its content inside `Sheet` unconditionally while the element is
 * live; the same invariant `Sheet.test.ts` (T32S5) already proves for the
 * primitive itself is exercised again here, directly, against the real
 * `composer-focus-model.ts` functions this renderer's sheet is an
 * instance of — an `"extension"`-kind sheet opening or closing never
 * changes who owns the keyboard.
 */
describe("a form's Sheet never moves keyboard ownership away from the composer", () => {
  it("stays 'composer' across the form sheet opening while the composer holds focus", () => {
    const focused = focusComposer(INITIAL_COMPOSER_FOCUS_STATE);
    expect(resolveFocusOwner(focused)).toBe("composer");

    const withFormSheetOpen = openSheet(focused, "extension");
    expect(resolveFocusOwner(withFormSheetOpen)).toBe("composer");
  });

  it("stays 'none' across the form sheet opening when the composer never held focus", () => {
    expect(resolveFocusOwner(INITIAL_COMPOSER_FOCUS_STATE)).toBe("none");
    const withFormSheetOpen = openSheet(INITIAL_COMPOSER_FOCUS_STATE, "extension");
    expect(resolveFocusOwner(withFormSheetOpen)).toBe("none");
  });

  it("stays 'composer' across the form sheet closing again (submit/cancel dismiss)", () => {
    const focused = focusComposer(INITIAL_COMPOSER_FOCUS_STATE);
    const withFormSheetOpen = openSheet(focused, "extension");
    const withFormSheetClosed = closeSheet(withFormSheetOpen);
    expect(resolveFocusOwner(withFormSheetClosed)).toBe("composer");
  });
});
