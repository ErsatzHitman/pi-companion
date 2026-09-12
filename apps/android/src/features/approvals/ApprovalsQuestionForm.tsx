import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { permissions } from "@picompanion/frontend-core";

import { Button, Select, TextArea, TextField } from "../../ui/primitives";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import type { QuestionApprovalPanel } from "./approvals-queue-model";
import {
  buildQuestionSubmitResponse,
  canSubmitQuestionAnswers,
  describeQuestionOptionLabel,
  explainQuestionSubmitBlock,
  initialQuestionValues,
  questionOptionGlyph,
  toggleMultiSelectQuestionValue,
  type ApprovalQuestionValue,
  type ApprovalQuestionValues,
} from "./approvals-question-model";

export interface ApprovalsQuestionFormProps {
  /** The classified `"question"` panel — see `resolveQuestionApprovalPanel`. */
  panel: QuestionApprovalPanel;
  onAnswer: (response: permissions.AgentPermissionResponse) => void;
  testId?: string;
}

/**
 * Native answer form for the Tier-1 extension dialogs
 * (`select`/`input`/`editor`/generic `question`) — the Android
 * counterpart of `PermissionDialog.tsx`'s `QuestionPanel`, rendered
 * inside `ApprovalsHost`'s existing `Sheet` exactly as `ApprovalForm`
 * is for a binary request.
 *
 * It owns exactly one thing the model does not: the draft values. Every
 * decision they feed — which questions are satisfied, whether Submit is
 * live, the sentence explaining a blocked Submit, and the response
 * Submit sends — is `approvals-question-model.ts`'s, proven by
 * execution under this workspace's plain `vitest` (which cannot parse
 * `react-native`). The field widgets below are the composition web's
 * panel describes: an option list (a `Select` for single choice, a
 * checkbox row per option for `multiSelect`), a `TextArea` for the
 * `editor` presentation, a `TextField` otherwise, and a free-text
 * override beneath a single-choice `Select` when the daemon sets
 * `allowOther`.
 *
 * **A different request must not inherit the previous request's draft**,
 * so `ApprovalsHost` keys this component by `requestId`. That is the
 * whole reset mechanism: a new key is a new mount, and `useState`'s
 * initializer runs again — the same `key={current.requestId}` rule the
 * web host applies to `PermissionDialog`.
 *
 * Submit is disabled until every required question is answered
 * (plan.md §12.3) and the reason is printed beside it, so a blocked
 * button explains itself instead of going inert silently. Dismiss always
 * sends `panel.denyResponse` — the same plain deny a tool request's Deny
 * button sends — never a silent close (plan.md §11.2 "these block the
 * extension and require a response or timeout").
 */
export function ApprovalsQuestionForm({ panel, onAnswer, testId }: ApprovalsQuestionFormProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [values, setValues] = useState<ApprovalQuestionValues>(() =>
    initialQuestionValues(panel.questions),
  );

  const canSubmit = canSubmitQuestionAnswers(panel.questions, values);
  const blockedReason = explainQuestionSubmitBlock(panel.questions, values);
  const formTestId = testId ?? "approvals-question";

  function updateValue(header: string, value: ApprovalQuestionValue): void {
    setValues((previous) => ({ ...previous, [header]: value }));
  }

  function submit(): void {
    onAnswer(buildQuestionSubmitResponse(panel.questions, values));
  }

  return (
    <View
      style={styles.form}
      accessibilityRole="none"
      accessibilityLabel={`${panel.toolLabel} needs your response`}
      testID={formTestId}
    >
      <Text style={styles.legend}>{panel.toolLabel}</Text>
      <View style={styles.fields}>
        {panel.questions.map((question) => (
          <QuestionField
            key={question.header}
            question={question}
            presentation={panel.presentation}
            value={values[question.header] ?? (question.multiSelect ? [] : "")}
            onChange={(value) => updateValue(question.header, value)}
            testId={`${formTestId}-field-${question.header}`}
          />
        ))}
      </View>
      {blockedReason ? (
        <Text
          style={styles.blocked}
          accessibilityLiveRegion="polite"
          testID={`${formTestId}-submit-block`}
        >
          {blockedReason}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          kind="secondary"
          label={panel.dismissLabel}
          onPress={() => onAnswer(panel.denyResponse)}
          testId={`${formTestId}-dismiss`}
        />
        <Button
          kind="primary"
          label="Submit"
          onPress={submit}
          disabled={!canSubmit}
          testId={`${formTestId}-submit`}
        />
      </View>
    </View>
  );
}

/**
 * A required marker for the labels this component composes itself. The
 * `TextField`/`TextArea` primitives already render their own
 * `required` marker (an accessibility-hidden `*`) and are passed
 * `required` directly; `Select` and the multi-select group have no such
 * prop, so their label carries the same `*` convention rather than a
 * second, differently-shaped indicator.
 */
function questionFieldLabel(question: permissions.PermissionDialogQuestion): string {
  return question.allowEmpty === true ? question.question : `${question.question} *`;
}

interface QuestionFieldProps {
  question: permissions.PermissionDialogQuestion;
  presentation: permissions.PermissionDialogPresentation;
  value: ApprovalQuestionValue;
  onChange: (value: ApprovalQuestionValue) => void;
  testId: string;
}

/** One question's field — the composition rule is this file's doc comment. */
function QuestionField({ question, presentation, value, onChange, testId }: QuestionFieldProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (question.options.length > 0) {
    const options = question.options.map((option) => ({
      value: option.label,
      label: describeQuestionOptionLabel(option),
    }));

    if (question.multiSelect) {
      return (
        <MultiSelectField
          question={question}
          selected={Array.isArray(value) ? value : []}
          onChange={onChange}
          testId={testId}
        />
      );
    }

    return (
      <View style={styles.field}>
        <Select
          label={questionFieldLabel(question)}
          options={options}
          value={typeof value === "string" ? value : ""}
          onValueChange={onChange}
          testId={testId}
        />
        {question.allowOther ? (
          <TextField
            label="Or type your own answer"
            placeholder={question.placeholder}
            value={typeof value === "string" ? value : ""}
            onChangeText={onChange}
            testId={`${testId}-other`}
          />
        ) : null}
      </View>
    );
  }

  if (presentation === "editor") {
    return (
      <TextArea
        label={question.question}
        placeholder={question.placeholder}
        required={question.allowEmpty !== true}
        value={typeof value === "string" ? value : ""}
        onChangeText={onChange}
        testId={testId}
      />
    );
  }

  return (
    <TextField
      label={question.question}
      placeholder={question.placeholder}
      required={question.allowEmpty !== true}
      value={typeof value === "string" ? value : ""}
      onChangeText={onChange}
      testId={testId}
    />
  );
}

interface MultiSelectFieldProps {
  question: permissions.PermissionDialogQuestion;
  selected: readonly string[];
  onChange: (value: ApprovalQuestionValue) => void;
  testId: string;
}

/**
 * A `multiSelect` question as a checkbox row per option — the closest
 * native analogue of web's `<select multiple>`, and the reason
 * `questionOptionGlyph` exists: the chosen and unchosen rows differ by a
 * glyph as well as by tint (plan.md §10.5 "non-colour status text"), so
 * the state survives a colour-blind reader and a screen reader alike
 * (`accessibilityState.checked` carries it for TalkBack).
 */
function MultiSelectField({ question, selected, onChange, testId }: MultiSelectFieldProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const label = questionFieldLabel(question);

  return (
    <View
      accessible={false}
      accessibilityRole="none"
      accessibilityLabel={label}
      style={styles.field}
      testID={testId}
    >
      <Text style={styles.label}>{label}</Text>
      {question.options.map((option, index) => {
        const checked = selected.includes(option.label);
        return (
          <Pressable
            key={option.label}
            accessibilityRole="checkbox"
            accessibilityLabel={describeQuestionOptionLabel(option)}
            accessibilityState={{ checked }}
            onPress={() => onChange(toggleMultiSelectQuestionValue([...selected], option.label))}
            style={styles.optionRow}
            testID={`${testId}-option-${index}`}
          >
            <Text style={styles.optionGlyph}>{questionOptionGlyph(checked)}</Text>
            <Text style={styles.optionText}>{describeQuestionOptionLabel(option)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    form: { gap: theme.spacing[2] },
    legend: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.heading.fontWeight),
    },
    fields: { gap: theme.spacing[3] },
    field: { gap: theme.spacing[1] },
    label: {
      color: theme.colors["ink-2"],
      fontSize: theme.typography.variant.label.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    optionRow: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    optionGlyph: { color: theme.colors.ink, fontSize: theme.typography.variant.body.fontSize },
    optionText: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      flexShrink: 1,
    },
    blocked: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  });
}

export default ApprovalsQuestionForm;
