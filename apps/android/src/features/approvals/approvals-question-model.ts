/**
 * Question-presentation answer model for the Android approvals surface
 * (T33B5's `"tool-actions"` sheet, extended to `select`/`input`/
 * `editor`/`question` request kinds).
 *
 * `approvals-queue-model.ts` classifies a pending request and
 * `ApprovalsQuestionForm.tsx` draws it; everything in between that can
 * be decided without a renderer lives here — the per-question draft
 * values, which of them satisfy a required answer, the sentence
 * explaining a blocked Submit, and the exact
 * `AgentPermissionResponse` Submit sends. RN-free by the same
 * convention `approvals-queue-model.ts` documents: this workspace's
 * `vitest` cannot parse `react-native`, so the view is a thin shell
 * over these pure functions.
 *
 * The semantics are `apps/web/src/features/approvals/PermissionDialog.tsx`'s
 * `QuestionPanel`, ported rather than re-invented, so the two platforms
 * send byte-for-byte the same answer for the same request:
 *
 * - a question with `options` is a choice (single or `multiSelect`);
 * - a question without `options` is free text — the `editor`
 *   presentation's multi-line field, a single-line field otherwise;
 * - `allowOther` adds a free-text override below a single-choice
 *   select, and whichever of the two the user last wrote wins, because
 *   both edit the same answer string (the ported Pi provider classifies
 *   freeform purely by "the answer does not match a listed option");
 * - every answer is keyed by the question's own `header`, the key the
 *   provider reads back through `updatedInput.answers`;
 * - a multi-select answer is joined with `", "`;
 * - Submit stays blocked while any required question is blank, and
 *   `explainQuestionSubmitBlock` names that rather than leaving the
 *   disabled button inert.
 *
 * Nothing here reads `presentation` except the view's own "which field
 * widget" choice — a `question` request with no `questions` at all
 * never reaches this module (see `resolveApprovalPanel`'s own doc
 * comment).
 */

import { permissions } from "@picompanion/frontend-core";

const { buildQuestionAnswerResponse } = permissions;

/** One question's current draft answer. `string[]` only for a `multiSelect` question. */
export type ApprovalQuestionValue = string | string[];
/** Every question's draft answer, keyed by `PermissionDialogQuestion.header`. */
export type ApprovalQuestionValues = Record<string, ApprovalQuestionValue>;

/**
 * `{ [header]: "" | [] }` for every question, in wire order — an empty
 * draft, never a guessed default answer. A multi-select starts as `[]`
 * and every other question as `""`, matching
 * `PermissionDialog.tsx`'s own `initialQuestionValues`.
 */
export function initialQuestionValues(
  questions: readonly permissions.PermissionDialogQuestion[],
): ApprovalQuestionValues {
  const values: ApprovalQuestionValues = {};
  for (const question of questions) {
    values[question.header] = question.multiSelect ? [] : "";
  }
  return values;
}

/** Whether one draft counts as answered — a non-blank string, or at least one chosen option. */
export function hasQuestionValue(value: ApprovalQuestionValue | undefined): boolean {
  if (value === undefined) return false;
  return Array.isArray(value) ? value.length > 0 : value.trim().length > 0;
}

/**
 * Whether one question is satisfied. `allowEmpty` is the daemon's own
 * "this question may stay blank" flag — the `input` method's optional
 * placeholder (`agent.ts` sets it and relabels the dismiss button
 * "Skip") and the combined `ask_user` dialog's optional comment both set
 * it — so it short-circuits the value check exactly the way the web
 * panel's `canSubmit` expression does.
 */
export function isQuestionAnswered(
  question: permissions.PermissionDialogQuestion,
  value: ApprovalQuestionValue | undefined,
): boolean {
  return question.allowEmpty === true || hasQuestionValue(value);
}

/** The `header` of every question still missing a required answer, in wire order. */
export function unansweredQuestionHeaders(
  questions: readonly permissions.PermissionDialogQuestion[],
  values: ApprovalQuestionValues,
): string[] {
  return questions
    .filter((question) => !isQuestionAnswered(question, values[question.header]))
    .map((question) => question.header);
}

/** Whether Submit may be pressed: no required question is still blank. */
export function canSubmitQuestionAnswers(
  questions: readonly permissions.PermissionDialogQuestion[],
  values: ApprovalQuestionValues,
): boolean {
  return unansweredQuestionHeaders(questions, values).length === 0;
}

/**
 * One sentence naming why Submit is blocked, or `null` when it is not —
 * shown beside the disabled button so a blocked control states what is
 * missing rather than going inert silently. Sibling to
 * `features/files/file-browser-client.ts`'s `explain*` helpers, which
 * name a failure in the same voice; a count is named rather than the
 * headers, because a header is a wire key (`Response`) and not
 * necessarily something a reader recognises.
 */
export function explainQuestionSubmitBlock(
  questions: readonly permissions.PermissionDialogQuestion[],
  values: ApprovalQuestionValues,
): string | null {
  const missing = unansweredQuestionHeaders(questions, values);
  if (missing.length === 0) return null;
  return missing.length === 1
    ? "Answer the remaining question before submitting."
    : `Answer the remaining ${missing.length} questions before submitting.`;
}

/**
 * The `{ [header]: answer }` map Submit sends — arrays joined with
 * `", "` exactly as the web panel does. An unanswered optional question
 * contributes `""`, which is what the provider's own `permissionAnswer`
 * reads back for an explicitly blank comment.
 */
export function buildQuestionAnswers(
  questions: readonly permissions.PermissionDialogQuestion[],
  values: ApprovalQuestionValues,
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const question of questions) {
    const value = values[question.header];
    answers[question.header] = Array.isArray(value) ? value.join(", ") : (value ?? "");
  }
  return answers;
}

/**
 * The exact `AgentPermissionResponse` Submit sends (plan.md §12.3's
 * "single-answer semantics"): `buildQuestionAnswerResponse` over every
 * header, byte-identical to `PermissionDialog.tsx`'s own `submit`.
 */
export function buildQuestionSubmitResponse(
  questions: readonly permissions.PermissionDialogQuestion[],
  values: ApprovalQuestionValues,
): permissions.AgentPermissionResponse {
  return buildQuestionAnswerResponse(buildQuestionAnswers(questions, values));
}

/**
 * The request's own one-line detail: the first question's text, falling
 * back to the description/title/name. This is what a permission
 * notification's private body carries and what the sheet's legend
 * names, so it is derived here rather than in the view.
 */
export function explainQuestionPanelDetail(view: permissions.PermissionDialogViewModel): string {
  return view.questions[0]?.question ?? view.description ?? view.title ?? view.name;
}

/**
 * The daemon's own dismiss wording for this request, defaulting to
 * "Cancel" — the `input` method's optional placeholder relabels it
 * "Skip". Matches `PermissionDialog.tsx`'s own lookup (the first
 * question carrying a `dismissLabel`).
 */
export function questionPanelDismissLabel(view: permissions.PermissionDialogViewModel): string {
  return view.questions.find((question) => question.dismissLabel)?.dismissLabel ?? "Cancel";
}

/** Option text with its description appended, matching the web panel's own option labels. */
export function describeQuestionOptionLabel(
  option: permissions.PermissionDialogQuestionOption,
): string {
  return option.description ? `${option.label} — ${option.description}` : option.label;
}

/**
 * Adds or removes one option label from a multi-select draft. Never a
 * duplicate: choosing the same option twice removes it, matching the
 * web panel's `multiple` select where re-toggling is the only way to
 * deselect.
 */
export function toggleMultiSelectQuestionValue(
  current: ApprovalQuestionValue | undefined,
  optionLabel: string,
): string[] {
  const selected = Array.isArray(current) ? current : [];
  return selected.includes(optionLabel)
    ? selected.filter((value) => value !== optionLabel)
    : [...selected, optionLabel];
}

/**
 * The visible state mark for one multi-select option row: `"✓"` chosen,
 * `"○"` not. Two distinct glyphs rather than a tint change alone
 * (plan.md §10.5), the same choice `transcript/todo-row-model.ts`'s
 * `todoGlyph` makes for the todo rows, and the reason the multi-select
 * list is not a bare set of switches whose only difference is colour.
 */
export function questionOptionGlyph(checked: boolean): string {
  return checked ? "✓" : "○";
}
