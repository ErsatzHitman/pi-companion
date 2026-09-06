/**
 * `form` kind renderer (plan.md §11.3, §11.7; T29B2) — "Structured
 * questions", e.g. the `ask-user` extension's rich form with search,
 * descriptions, multi-select, and an optional comment.
 *
 * Field kinds (`packages/protocol/src/pi-ui-bridge/payload.ts`
 * `PiUiFormFieldSchema`) are `text` (single-line or `multiline`), `select`
 * (single or `multiple`, optionally `searchable`), and `toggle`. Every
 * field composes an existing primitive (`TextField`/`TextArea`/`Select`/
 * `Toggle`/`SearchField`) rather than a one-off input, per plan.md §10.1.
 *
 * Submission (plan.md §12.3 "submitted through a normal element action" —
 * see `PiUiFormPayloadSchema`'s own doc comment): this renderer collects
 * every field's current value into one `{ [fieldId]: value }` object and
 * attaches it as the dispatched action's `payload`, for *whichever* of the
 * element's `actions` the user clicks. There is no wire-level designation
 * of "the" submit action distinct from e.g. a `cancel` action — a namespace
 * that only cares about a subset of fields (or none) is free to ignore the
 * rest of the payload. `payload.submitLabel`, when present, overrides the
 * `primary`-variant action's own label (mirroring `ApprovalForm`'s
 * primary/secondary convention), since that is the one wire signal this
 * kind's payload carries about which action is "the" submit button.
 *
 * Dangerous (`confirm`-bearing) actions follow the same treatment as every
 * other kind's `ElementActionsRow` (see that module's header comment,
 * T29B5): a form action always dispatches through `dispatchAction`, which
 * itself gates a `confirm`-bearing dispatch behind a platform confirmation
 * dialog before sending anything — a form action is not a materially
 * different case.
 */
import { useState } from "react";

import type { extensions } from "@picompanion/frontend-core";
import type { PiUiAction, PiUiFormField } from "@picompanion/protocol/pi-ui-bridge/schema";

import {
  Button,
  Card,
  SearchField,
  Select,
  TextArea,
  TextField,
  Toggle,
  type ButtonKind,
} from "../../../ui/primitives/index.js";
import type { PiUiDispatchAction, PiUiElementRendererProps } from "../registry.js";
import "./renderers.css";

/** One field's current answer. `select` is `string` (single) or `string[]` (`multiple`). */
type FormFieldValue = string | string[] | boolean;
type FormValues = Record<string, FormFieldValue>;

const BUTTON_KIND: Record<NonNullable<PiUiAction["variant"]>, ButtonKind> = {
  primary: "primary",
  secondary: "secondary",
  danger: "danger",
};

function defaultValue(field: PiUiFormField): FormFieldValue {
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

function initialValues(fields: readonly PiUiFormField[]): FormValues {
  const values: FormValues = {};
  for (const field of fields) values[field.id] = defaultValue(field);
  return values;
}

function feedbackText(state: extensions.ExtensionActionState): string | undefined {
  switch (state.status) {
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

interface SelectFormFieldProps {
  field: Extract<PiUiFormField, { kind: "select" }>;
  value: FormFieldValue;
  onChange: (value: FormFieldValue) => void;
  disabled: boolean;
  testId: string;
}

/** The `select` field kind: single or `multiple`, with an optional client-side search filter. */
function SelectFormField({ field, value, onChange, disabled, testId }: SelectFormFieldProps) {
  const [query, setQuery] = useState("");
  const matches = field.searchable
    ? field.options.filter(
        (option) =>
          option.label.toLowerCase().includes(query.toLowerCase()) ||
          (option.description ?? "").toLowerCase().includes(query.toLowerCase()),
      )
    : field.options;
  const options = matches.map((option) => ({
    value: option.value,
    label: option.description ? `${option.label} — ${option.description}` : option.label,
  }));

  const searchField = field.searchable ? (
    <SearchField
      label={`Search ${field.label} options`}
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      disabled={disabled}
      placeholder="Search options"
      testId={`${testId}-search`}
    />
  ) : null;

  if (field.multiple) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="pc-pi-form__select-field">
        {searchField}
        <Select
          label={field.label}
          options={options}
          multiple
          required={field.required}
          disabled={disabled}
          value={selected}
          onChange={(event) =>
            onChange(Array.from(event.target.selectedOptions).map((option) => option.value))
          }
          testId={testId}
        />
      </div>
    );
  }

  return (
    <div className="pc-pi-form__select-field">
      {searchField}
      <Select
        label={field.label}
        options={options}
        required={field.required}
        disabled={disabled}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        testId={testId}
      />
    </div>
  );
}

interface FormFieldRowProps {
  field: PiUiFormField;
  value: FormFieldValue;
  onChange: (value: FormFieldValue) => void;
  disabled: boolean;
  testId: string;
}

/** Dispatches one field to the primitive that renders its documented kind. */
function FormFieldRow({ field, value, onChange, disabled, testId }: FormFieldRowProps) {
  if (field.kind === "text") {
    const text = typeof value === "string" ? value : "";
    if (field.multiline) {
      return (
        <TextArea
          label={field.label}
          placeholder={field.placeholder}
          required={field.required}
          disabled={disabled}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          testId={testId}
        />
      );
    }
    return (
      <TextField
        label={field.label}
        placeholder={field.placeholder}
        required={field.required}
        disabled={disabled}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        testId={testId}
      />
    );
  }

  if (field.kind === "toggle") {
    return (
      <div className="pc-pi-form__toggle-field">
        <Toggle
          label={field.label}
          checked={typeof value === "boolean" ? value : false}
          onCheckedChange={onChange}
          disabled={disabled}
          testId={testId}
        />
        {field.description ? (
          <p className="pc-pi-form__field-description">{field.description}</p>
        ) : null}
      </div>
    );
  }

  return (
    <SelectFormField
      field={field}
      value={value}
      onChange={onChange}
      disabled={disabled}
      testId={testId}
    />
  );
}

interface FormActionsProps {
  actions: readonly PiUiAction[] | undefined;
  values: FormValues;
  dispatchAction: PiUiDispatchAction;
  getActionState: (actionId: string) => extensions.ExtensionActionState;
  submitLabel: string | undefined;
  ariaLabel: string;
}

/**
 * A form's own action row: same visible pending/success/failure/dangerous
 * treatment as `ElementActionsRow`, but every dispatch also carries the
 * form's current field values as its payload (see this module's header
 * comment).
 */
function FormActions({
  actions,
  values,
  dispatchAction,
  getActionState,
  submitLabel,
  ariaLabel,
}: FormActionsProps) {
  if (!actions || actions.length === 0) return null;

  return (
    <div className="pc-pi-form__actions" role="group" aria-label={ariaLabel}>
      {actions.map((action) => {
        const state = getActionState(action.id);
        const pending = state.status === "pending";
        const feedback = feedbackText(state);
        const label = action.variant === "primary" && submitLabel ? submitLabel : action.label;
        return (
          <span className="pc-pi-form__action" key={action.id}>
            <Button
              kind={BUTTON_KIND[action.variant ?? "secondary"]}
              disabled={pending}
              title={action.confirm}
              onClick={() => {
                void dispatchAction(action.id, { action, payload: values });
              }}
            >
              {label}
            </Button>
            <span className="pc-pi-form__action-state" aria-live="polite">
              {pending ? "Submitting…" : (feedback ?? "")}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function FormRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"form">) {
  const title = element.title ?? "Form";
  const [values, setValues] = useState<FormValues>(() => initialValues(payload.fields));

  const anyPending = (element.actions ?? []).some(
    (action) => getActionState(action.id).status === "pending",
  );

  function updateField(fieldId: string, value: FormFieldValue): void {
    setValues((previous) => ({ ...previous, [fieldId]: value }));
  }

  const description = payload.description;

  return (
    <Card className="pc-pi-form" data-testid={`pi-form-${element.ns}-${element.id}`}>
      <fieldset className="pc-pi-form__fieldset">
        <legend className="pc-pi-form__title">{title}</legend>
        {description ? <p className="pc-pi-form__description">{description}</p> : null}
        {payload.fields.length > 0 ? (
          <div className="pc-pi-form__fields">
            {payload.fields.map((field) => (
              <FormFieldRow
                key={field.id}
                field={field}
                value={values[field.id] ?? defaultValue(field)}
                onChange={(value) => updateField(field.id, value)}
                disabled={anyPending}
                testId={`pi-form-field-${element.id}-${field.id}`}
              />
            ))}
          </div>
        ) : (
          <p className="pc-pi-form__empty">No fields to show.</p>
        )}
      </fieldset>
      <FormActions
        actions={element.actions}
        values={values}
        dispatchAction={dispatchAction}
        getActionState={getActionState}
        submitLabel={payload.submitLabel}
        ariaLabel={`${title} actions`}
      />
    </Card>
  );
}
