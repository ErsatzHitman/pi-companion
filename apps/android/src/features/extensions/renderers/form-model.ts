/**
 * `form` kind render model (plan.md §11.3, §11.7; T34B2) — "Structured
 * questions, submitted through a normal element action"
 * (`PiUiFormPayloadSchema`'s own doc comment), the shape `ask-user`'s rich
 * form (search, descriptions, multi-select, optional comment), `btw`'s
 * pinned composer form, and `switchboard`'s add/remove key form all use
 * (`docs/pi-extension-compatibility.md`'s `ask-user`/`btw`/`switchboard`
 * lines).
 *
 * Field kinds are exactly the three `PiUiFormFieldSchema` (authoritative;
 * `packages/protocol/src/pi-ui-bridge/payload.ts`) discriminates on:
 * `text` (single-line or `multiline`), `select` (single or `multiple`,
 * optionally `searchable`), and `toggle`. Every documented field the
 * fixtures exercise (`docs/pi-extension-compatibility.md`'s `btw` line —
 * a bare `text` field; its `ask-user` line — a `select` field with
 * options) maps onto one of these three; nothing in the schema names a
 * fourth kind, so none is invented here.
 *
 * This is the Android counterpart to `apps/web/src/features/extensions/
 * renderers/form.tsx`'s render logic, factored out into its own RN-free
 * module (unlike the web file, which keeps its handful of pure helpers
 * inline) because this module also owns something the web renderer does
 * not attempt: client-side required-field validation before a `primary`
 * -variant (submit) action ever dispatches. `required` only exists on the
 * `text` and `select` field schemas — `toggle` has no `required` — so
 * `formFieldError` never manufactures a rule the schema doesn't carry.
 * Non-primary actions (e.g. `cancel`/`close`) always dispatch immediately
 * — validation only ever gates the one action the payload's own
 * `submitLabel` field is about.
 *
 * Kept free of any React Native import so it is unit testable in this
 * workspace (see `status-model.ts`'s note and `../registry.test.ts`).
 */
import type {
  PiUiAction,
  PiUiElement,
  PiUiFormField,
  PiUiFormOption,
} from "@picompanion/protocol/pi-ui-bridge/schema";

import type { extensions } from "@picompanion/frontend-core";

import type { PiUiPayloadForKind } from "../registry";
import { type PiUiActionButtonKind, type PiUiActionButtonModel } from "./element-actions-model";
import type { PiUiAnnouncedText } from "./status-model";
import { humanizeNamespace } from "./tone";

/** One field's current answer. `select` is `string` (single) or `string[]` (`multiple`). */
export type PiUiFormFieldValue = string | string[] | boolean;
export type PiUiFormValues = Record<string, PiUiFormFieldValue>;

const BUTTON_KIND: Record<NonNullable<PiUiAction["variant"]>, PiUiActionButtonKind> = {
  primary: "primary",
  secondary: "secondary",
  danger: "danger",
};

/** A field's own wire `value` (or an empty default), before any user edit. */
export function defaultFormFieldValue(field: PiUiFormField): PiUiFormFieldValue {
  switch (field.kind) {
    case "text":
      return field.value ?? "";
    case "toggle":
      return field.value ?? false;
    case "select":
      if (field.multiple) {
        if (Array.isArray(field.value)) return field.value;
        return field.value ? [field.value] : [];
      }
      return Array.isArray(field.value) ? (field.value[0] ?? "") : (field.value ?? "");
    default:
      return "";
  }
}

/** One `{ [fieldId]: value }` map seeded from every field's own default, in wire order. */
export function buildInitialFormValues(fields: readonly PiUiFormField[]): PiUiFormValues {
  const values: PiUiFormValues = {};
  for (const field of fields) values[field.id] = defaultFormFieldValue(field);
  return values;
}

/**
 * One field's validation error, or `undefined` when it passes (or carries
 * no `required` rule at all — every `toggle` field, and any `text`/
 * `select` field without `required: true`).
 */
export function formFieldError(
  field: PiUiFormField,
  value: PiUiFormFieldValue | undefined,
): string | undefined {
  if (field.kind === "text") {
    if (!field.required) return undefined;
    const text = typeof value === "string" ? value : "";
    return text.trim().length === 0 ? `${field.label} is required.` : undefined;
  }
  if (field.kind === "select") {
    if (!field.required) return undefined;
    if (field.multiple) {
      const selected = Array.isArray(value) ? value : [];
      return selected.length === 0 ? `${field.label} is required.` : undefined;
    }
    const selected = typeof value === "string" ? value : "";
    return selected.length === 0 ? `${field.label} is required.` : undefined;
  }
  // `toggle`: the schema declares no `required` field, so a toggle can
  // never fail validation.
  return undefined;
}

export interface PiUiFormValidation {
  /** `{ [fieldId]: message }`, only for fields that currently fail. */
  errors: Record<string, string>;
  valid: boolean;
}

/** Every field's error, computed against one values snapshot. */
export function buildFormValidation(
  fields: readonly PiUiFormField[],
  values: PiUiFormValues,
): PiUiFormValidation {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const error = formFieldError(field, values[field.id]);
    if (error) errors[field.id] = error;
  }
  return { errors, valid: Object.keys(errors).length === 0 };
}

export interface PiUiFormSubmitGate {
  /** `false` blocks the dispatch this gate was asked about. */
  allowed: boolean;
  /** Per-field errors to surface, `{}` when `allowed` is `true`. */
  errors: Record<string, string>;
  /** One summary line for a form-level banner, `undefined` when `allowed` is `true`. */
  errorSummary: string | undefined;
}

/**
 * Whether one action's dispatch may proceed. Only a `primary`-variant
 * action is gated — plan.md §12.3 and this payload's own doc comment
 * name no wire-level "the submit action" distinct from `primary`, and a
 * `cancel`/`close` action must always be reachable even with invalid
 * fields (a user abandoning a form should never be trapped in it by a
 * validation error).
 */
export function resolveFormSubmitGate(
  action: Pick<PiUiAction, "variant">,
  fields: readonly PiUiFormField[],
  values: PiUiFormValues,
): PiUiFormSubmitGate {
  if (action.variant !== "primary") return { allowed: true, errors: {}, errorSummary: undefined };
  const { errors, valid } = buildFormValidation(fields, values);
  const count = Object.keys(errors).length;
  return {
    allowed: valid,
    errors,
    errorSummary: valid
      ? undefined
      : count === 1
        ? "Fix 1 field before submitting."
        : `Fix ${count} fields before submitting.`,
  };
}

/** Adds or removes `optionValue` from a `multiple` select field's current selection. */
export function toggleMultiSelectValue(
  current: PiUiFormFieldValue | undefined,
  optionValue: string,
): string[] {
  const selected = Array.isArray(current) ? current : [];
  return selected.includes(optionValue)
    ? selected.filter((value) => value !== optionValue)
    : [...selected, optionValue];
}

/** Client-side filter for a `searchable` select field's option list. */
export function filterFormSelectOptions(
  options: readonly PiUiFormOption[],
  query: string,
): PiUiFormOption[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return [...options];
  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(trimmed) ||
      (option.description ?? "").toLowerCase().includes(trimmed),
  );
}

/**
 * Visible/announced outcome text for a form's submit-style action.
 * Distinct wording from `element-actions-model.ts`'s
 * `actionFeedbackText` (which says "Working…"/"Done"/"Failed") because a
 * form submission reads better in its own voice — matching the web
 * `form.tsx` renderer's `feedbackText` exactly, so the same element
 * announces the same words on both platforms (plan.md §18.3).
 */
export function formActionFeedbackText(state: extensions.ExtensionActionState): string | undefined {
  switch (state.status) {
    case "pending":
      return "Submitting…";
    case "success":
      return "Submitted";
    case "rejected":
      return state.error ?? "Submission failed";
    case "timeout":
      return "Timed out";
    case "cancelled":
      return "Cancelled";
    default:
      return undefined;
  }
}

export interface PiUiFormActionModel extends PiUiActionButtonModel {
  /**
   * `true` while this action's dispatch is gated shut by
   * `resolveFormSubmitGate`. Distinct from `disabled` (T347): a blocked
   * action is still pressable, and pressing it is what surfaces the
   * per-field errors and the summary line.
   */
  blocked: boolean;
}

/**
 * One model per action in `element.actions`, each dispatching with the
 * form's current values as its `payload` (plan.md §12.3 "submitted
 * through a normal element action"). `submitLabel`, when present,
 * overrides the `primary`-variant action's own label — the one wire
 * signal `PiUiFormPayloadSchema` carries about which action is "the"
 * submit button (mirrored from the web renderer's identical rule).
 *
 * `disabled` means one thing only: a dispatch for this action is already
 * in-flight. Validation is reported through `blocked` instead, and a
 * blocked action stays PRESSABLE on purpose.
 *
 * (CORRECTED at T347: this said `disabled` covered validation too --
 * "either way the button must not be pressable" -- and the model set
 * `disabled: pending || !gate.allowed` accordingly. That made
 * `form.tsx`'s own submit gate unreachable code: the view answers a press
 * on a blocked action by setting the per-field errors and the
 * "Fix N field(s) before submitting." summary and returning without
 * dispatching, but a disabled `Button` never fires `onPress`, so neither
 * ever appeared. The two halves were written against different designs
 * and never met -- nothing read `blocked` either. Maestro run
 * 34518287677 caught it: shard-4's `extension-sheets` tapped
 * `pi-form-ask-user-confirm-action-submit` with the required field empty
 * and the hierarchy dump came back `enabled: "false"` with no summary
 * anywhere in the sheet. Maestro reports a tap on a disabled node as
 * COMPLETED, which is why every earlier run failed one step later
 * instead of here.)
 *
 * Press-to-reveal is the design `form.tsx`'s own header describes, and it
 * is the better of the two: a submit button that is merely inert states
 * that something is wrong without ever saying what, and the user has no
 * way to ask. Pressing it names the fields.
 */
export function buildFormActionsModel(
  actions: readonly PiUiAction[] | undefined,
  fields: readonly PiUiFormField[],
  values: PiUiFormValues,
  getActionState: (actionId: string) => extensions.ExtensionActionState,
  submitLabel: string | undefined,
): PiUiFormActionModel[] {
  if (!actions || actions.length === 0) return [];
  return actions.map((action) => {
    const state = getActionState(action.id);
    const gate = resolveFormSubmitGate(action, fields, values);
    const feedbackText = formActionFeedbackText(state);
    const label = action.variant === "primary" && submitLabel ? submitLabel : action.label;
    const pending = state.status === "pending";
    return {
      id: action.id,
      label,
      kind: BUTTON_KIND[action.variant ?? "secondary"],
      disabled: pending,
      blocked: !gate.allowed,
      action,
      feedback: feedbackText
        ? ({
            text: feedbackText,
            accessibilityLabel: `${label}: ${feedbackText}`,
            accessibilityLiveRegion: "polite",
          } satisfies PiUiAnnouncedText)
        : undefined,
    };
  });
}

/** Finds the wire action a `Sheet`'s dismiss gesture should dispatch, if any. */
export function resolveFormCloseAction(
  actions: readonly PiUiAction[] | undefined,
): PiUiAction | undefined {
  if (!actions) return undefined;
  return actions.find((action) => action.id === "cancel" || action.id === "close");
}

export interface PiUiFormFieldModel {
  field: PiUiFormField;
  value: PiUiFormFieldValue;
  error: string | undefined;
}

/** One model per field, pairing each with its current value and validation error. */
export function buildFormFieldsModel(
  fields: readonly PiUiFormField[],
  values: PiUiFormValues,
  errors: Record<string, string>,
): PiUiFormFieldModel[] {
  return fields.map((field) => ({
    field,
    value: values[field.id] ?? defaultFormFieldValue(field),
    error: errors[field.id],
  }));
}

export interface PiUiFormRenderModel {
  title: string;
  description: string | undefined;
  fields: PiUiFormFieldModel[];
  /** Shown instead of the field list when there are no fields at all. */
  emptyText: string | undefined;
  submitLabel: string | undefined;
  actionsAccessibilityLabel: string;
}

export function buildFormRenderModel(
  element: Pick<PiUiElement, "ns" | "title">,
  payload: PiUiPayloadForKind<"form">,
  values: PiUiFormValues,
  errors: Record<string, string>,
): PiUiFormRenderModel {
  const title = element.title ?? humanizeNamespace(element.ns);
  return {
    title,
    description: payload.description,
    fields: buildFormFieldsModel(payload.fields, values, errors),
    emptyText: payload.fields.length === 0 ? "No fields to show." : undefined,
    submitLabel: payload.submitLabel,
    actionsAccessibilityLabel: `${title} actions`,
  };
}
