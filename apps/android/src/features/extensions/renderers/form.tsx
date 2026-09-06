/**
 * `form` kind renderer (plan.md §11.3, §11.7; T34B2) — "Structured
 * questions", rendered as a `Sheet` (`ui/primitives/Sheet.tsx`) rather
 * than an inline `Card` like the other kinds, matching
 * `docs/pi-extension-compatibility.md`'s placement column for every
 * documented form use (`btw`'s pinned composer form aside, `ask-user` and
 * `switchboard` both place their `form` section inside a `panel` at
 * `placement: "sheet"`; a bare top-level `form` element carries no
 * placement signal of its own, so this renderer's own container is the
 * one authoritative answer for what a `form` kind *looks like*, and a
 * sheet is what plan.md §11.3's "dialog / rail form / sheet" placement
 * column names).
 *
 * Every field kind, its current value, and its validation error is
 * `form-model.ts`'s concern; this file only maps that render model onto
 * the §10.3 primitive that matches each documented field kind:
 * - `text` -> `TextArea` (`multiline: true`) or `TextField`;
 * - `toggle` -> `Toggle`, with its optional `description` underneath;
 * - `select` -> `Select` (single) or one `Toggle` row per option
 *   (`multiple` — Android has no native multi-select primitive, so this
 *   composes the same primitive `toggle` fields already use, one per
 *   option, exactly as `roster.tsx`'s header comment describes composing
 *   primitives directly when no recipe fits); `searchable` adds a
 *   `SearchField` above the option list that filters it client-side
 *   (`filterFormSelectOptions`).
 *
 * Submission (plan.md §12.3 "submitted through a normal element action"):
 * every action in `element.actions` dispatches with the form's current
 * field values as its `payload`; a `primary`-variant action is
 * additionally gated by `resolveFormSubmitGate` — pressing it while a
 * required field is empty surfaces that field's own error text plus one
 * summary banner and never reaches `dispatchAction` at all. A rejected or
 * timed-out submit is `formActionFeedbackText`'s job to word ("Submission
 * failed" / "Timed out") and `ExtensionActionController.settle`'s job to
 * un-stick (T34A5's `pi-ui-session.test.ts`): either way `disabled` comes
 * back `false` and the feedback text replaces the pending "Submitting…",
 * so a rejected submit never stays spinning.
 *
 * Sheet keyboard ownership: `Sheet` itself is the primitive proven not to
 * move real IME focus away from the composer (`Sheet.test.ts`, T32S5);
 * this renderer adds nothing that would — no `TextInput` here calls
 * `.focus()` itself, and the sheet opens unconditionally with this
 * component's own mount (registry-index.ts, unowned this wave, decides
 * *whether* a `form` element is mounted at all). See `form-model.test.ts`
 * for that contract exercised directly against `resolveFocusOwner`.
 *
 * PortalHost mounting (T32S6, same wave) is what turns this `Sheet` into
 * an actual same-window overlay instead of its inline fallback — see
 * `Sheet.tsx`'s own doc comment. That host is mounted: T32S6 (commit
 * `fe6d221`) wraps `<Stack>` in `<PortalHost>` in
 * `app-shell/navigation-shell.tsx`, so this renderer's `Sheet` takes the
 * real Portal path. (Written while T32S6 was in flight, this said the
 * question was open; the P5-W10 merge gate resolved it.)
 */
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { PiUiFormField } from "@picompanion/protocol/pi-ui-bridge/schema";

import {
  Button,
  Card,
  SearchField,
  Select,
  Sheet,
  TextArea,
  TextField,
  Toggle,
} from "../../../ui/primitives";
import { asFontWeight } from "../../../ui/theme/native-style-helpers";
import { useTheme } from "../../../ui/theme/theme-context";
import type { PiUiElementRendererProps } from "../registry";
import {
  buildFormActionsModel,
  buildFormRenderModel,
  buildInitialFormValues,
  filterFormSelectOptions,
  resolveFormCloseAction,
  resolveFormSubmitGate,
  toggleMultiSelectValue,
  type PiUiFormFieldModel,
  type PiUiFormFieldValue,
  type PiUiFormValues,
} from "./form-model";

type Styles = ReturnType<typeof createStyles>;

function TextFormField({
  field,
  value,
  error,
  disabled,
  onChange,
  testId,
}: {
  field: Extract<PiUiFormField, { kind: "text" }>;
  value: PiUiFormFieldValue;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
  testId: string;
}) {
  const text = typeof value === "string" ? value : "";
  if (field.multiline) {
    return (
      <TextArea
        label={field.label}
        placeholder={field.placeholder}
        required={field.required}
        error={error}
        editable={!disabled}
        value={text}
        onChangeText={onChange}
        testId={testId}
      />
    );
  }
  return (
    <TextField
      label={field.label}
      placeholder={field.placeholder}
      required={field.required}
      error={error}
      editable={!disabled}
      value={text}
      onChangeText={onChange}
      testId={testId}
    />
  );
}

function ToggleFormField({
  field,
  value,
  disabled,
  onChange,
  styles,
  testId,
}: {
  field: Extract<PiUiFormField, { kind: "toggle" }>;
  value: PiUiFormFieldValue;
  disabled: boolean;
  onChange: (value: boolean) => void;
  styles: Styles;
  testId: string;
}) {
  return (
    <View style={styles.toggleField}>
      <Toggle
        label={field.label}
        checked={typeof value === "boolean" ? value : false}
        onCheckedChange={onChange}
        disabled={disabled}
        testId={testId}
      />
      {field.description ? <Text style={styles.fieldDescription}>{field.description}</Text> : null}
    </View>
  );
}

function SelectFormField({
  field,
  value,
  error,
  disabled,
  onChange,
  styles,
  testId,
}: {
  field: Extract<PiUiFormField, { kind: "select" }>;
  value: PiUiFormFieldValue;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: PiUiFormFieldValue) => void;
  styles: Styles;
  testId: string;
}) {
  const [query, setQuery] = useState("");
  const options = filterFormSelectOptions(field.options, field.searchable ? query : "");

  const search = field.searchable ? (
    <SearchField
      label={`Search ${field.label} options`}
      placeholder="Search options"
      value={query}
      onChangeText={setQuery}
      editable={!disabled}
      testId={`${testId}-search`}
    />
  ) : null;

  if (field.multiple) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <View style={styles.selectField}>
        <Text style={styles.label}>{field.label}</Text>
        {search}
        <View style={styles.multiSelectOptions}>
          {options.map((option) => (
            <View key={option.value} style={styles.toggleField}>
              <Toggle
                label={
                  option.description ? `${option.label} — ${option.description}` : option.label
                }
                checked={selected.includes(option.value)}
                onCheckedChange={() => onChange(toggleMultiSelectValue(selected, option.value))}
                disabled={disabled}
                testId={`${testId}-option-${option.value}`}
              />
            </View>
          ))}
        </View>
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.selectField}>
      {search}
      <Select
        label={field.label}
        options={options.map((option) => ({
          value: option.value,
          label: option.description ? `${option.label} — ${option.description}` : option.label,
        }))}
        value={typeof value === "string" ? value : ""}
        onValueChange={onChange}
        testId={testId}
      />
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function FormFieldRow({
  model,
  disabled,
  onChange,
  styles,
  testId,
}: {
  model: PiUiFormFieldModel;
  disabled: boolean;
  onChange: (value: PiUiFormFieldValue) => void;
  styles: Styles;
  testId: string;
}) {
  const { field, value, error } = model;
  if (field.kind === "text") {
    return (
      <TextFormField
        field={field}
        value={value}
        error={error}
        disabled={disabled}
        onChange={onChange}
        testId={testId}
      />
    );
  }
  if (field.kind === "toggle") {
    return (
      <ToggleFormField
        field={field}
        value={value}
        disabled={disabled}
        onChange={onChange}
        styles={styles}
        testId={testId}
      />
    );
  }
  return (
    <SelectFormField
      field={field}
      value={value}
      error={error}
      disabled={disabled}
      onChange={onChange}
      styles={styles}
      testId={testId}
    />
  );
}

export function FormRenderer({
  element,
  payload,
  dispatchAction,
  getActionState,
}: PiUiElementRendererProps<"form">) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [values, setValues] = useState<PiUiFormValues>(() =>
    buildInitialFormValues(payload.fields),
  );
  const [submitErrors, setSubmitErrors] = useState<Record<string, string>>({});
  const [submitSummary, setSubmitSummary] = useState<string | undefined>(undefined);

  const model = buildFormRenderModel(element, payload, values, submitErrors);
  const actionModels = buildFormActionsModel(
    element.actions,
    payload.fields,
    values,
    getActionState,
    payload.submitLabel,
  );
  const testId = `pi-form-${element.ns}-${element.id}`;

  function updateField(fieldId: string, value: PiUiFormFieldValue): void {
    setValues((previous) => ({ ...previous, [fieldId]: value }));
    setSubmitErrors((previous) => {
      if (!(fieldId in previous)) return previous;
      const next = { ...previous };
      delete next[fieldId];
      return next;
    });
  }

  const closeAction = resolveFormCloseAction(element.actions);
  const anyPending = actionModels.some((action) => getActionState(action.id).status === "pending");

  return (
    <Sheet
      open
      title={model.title}
      description={model.description ?? "Fill in the form below."}
      onClose={() => {
        if (closeAction)
          void dispatchAction(closeAction.id, { action: closeAction, payload: values });
      }}
      testId={testId}
    >
      <Card style={styles.card}>
        {model.fields.length > 0 ? (
          <View style={styles.fields}>
            {model.fields.map((fieldModel) => (
              <FormFieldRow
                key={fieldModel.field.id}
                model={fieldModel}
                disabled={anyPending}
                onChange={(value) => updateField(fieldModel.field.id, value)}
                styles={styles}
                testId={`${testId}-field-${fieldModel.field.id}`}
              />
            ))}
          </View>
        ) : (
          <Text style={styles.empty}>{model.emptyText}</Text>
        )}
        {submitSummary ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {submitSummary}
          </Text>
        ) : null}
        {actionModels.length > 0 ? (
          <View
            style={styles.actions}
            accessible={false}
            accessibilityRole="none"
            accessibilityLabel={model.actionsAccessibilityLabel}
          >
            {actionModels.map((actionModel) => (
              <View style={styles.action} key={actionModel.id}>
                <Button
                  kind={actionModel.kind}
                  label={actionModel.label}
                  disabled={actionModel.disabled}
                  onPress={() => {
                    const gate = resolveFormSubmitGate(actionModel.action, payload.fields, values);
                    if (!gate.allowed) {
                      setSubmitErrors(gate.errors);
                      setSubmitSummary(gate.errorSummary);
                      return;
                    }
                    setSubmitErrors({});
                    setSubmitSummary(undefined);
                    void dispatchAction(actionModel.id, {
                      action: actionModel.action,
                      payload: values,
                    });
                  }}
                  testId={`${testId}-action-${actionModel.id}`}
                />
                {actionModel.feedback ? (
                  <Text
                    style={styles.actionFeedback}
                    accessibilityLiveRegion={actionModel.feedback.accessibilityLiveRegion}
                    accessibilityLabel={actionModel.feedback.accessibilityLabel}
                  >
                    {actionModel.feedback.text}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </Sheet>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    card: { gap: theme.spacing[3] },
    fields: { gap: theme.spacing[4] },
    label: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    fieldDescription: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    toggleField: { gap: theme.spacing[1] },
    selectField: { gap: theme.spacing[2] },
    multiSelectOptions: { gap: theme.spacing[1] },
    error: {
      color: theme.colors.status.danger.foreground,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    action: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
    actionFeedback: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    empty: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.body.fontSize,
    },
  });
}
