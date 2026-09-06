import { useCallback, useEffect, useState } from "react";

import { permissions } from "@picompanion/frontend-core";
import { buildToolCallDisplayModel } from "@picompanion/protocol/tool-call-display";

import { Button, Select, TextArea, TextField, type ButtonKind } from "../../ui/primitives/index.js";
import "../../ui/primitives/primitives.css";
import { useModalBehavior } from "../../ui/primitives/use-modal-behavior.js";
import { ApprovalForm } from "../../ui/recipes/ApprovalForm.js";
import "../../ui/recipes/recipes.css";
import "./approvals.css";

/**
 * Local aliases for the three response builders (T21A,
 * `packages/frontend-core/src/permissions/responses.ts`) this file
 * dispatches through `onAnswer` below. `@picompanion/frontend-core` only
 * exports one package root (plan.md §6: apps depend on package
 * *exports*, never source-relative cross-workspace paths, and there is
 * no `/permissions` subpath), so these come off the `permissions`
 * namespace import rather than a second import line.
 */
const { buildActionResponse, buildDenyResponse, buildQuestionAnswerResponse } = permissions;

const BUTTON_KIND: Record<NonNullable<permissions.AgentPermissionAction["variant"]>, ButtonKind> = {
  primary: "primary",
  secondary: "secondary",
  danger: "danger",
};

/**
 * One-line detail text for a `"tool-actions"` request (plan.md §11.6-
 * style tool-call summarization, reused here rather than re-derived):
 * `AgentPermissionRequest.detail` is the exact same `ToolCallDetail`
 * shape a `tool_call` timeline item carries, so
 * `@picompanion/protocol/tool-call-display`'s `buildToolCallDisplayModel`
 * — already the canonical "turn a `ToolCallDetail` into a human summary"
 * function `tools/view-model.ts` uses — applies unchanged. `status` has
 * no real analogue for a permission request (nothing has "completed" or
 * "failed" yet); `"running"` is supplied only because the input type
 * requires *some* status, and `errorText` (the only field that actually
 * branches on it) is never read below.
 */
function toolCallDetailSummary(view: permissions.PermissionDialogViewModel): string {
  const raw = view.raw;
  if (raw.detail) {
    try {
      const display = buildToolCallDisplayModel({
        name: raw.name,
        status: "running",
        error: null,
        metadata: raw.metadata,
        detail: raw.detail,
      });
      if (display.summary) return display.summary;
    } catch {
      // A malformed `detail` must never block rendering the dialog
      // itself — fall through to the generic description below.
    }
  }
  return view.description ?? view.title ?? view.name;
}

/**
 * No wire field marks a permission request "dangerous" — the daemon
 * (`packages/protocol/src/agent-types.ts`) carries no such flag. The one
 * real signal available is `AgentPermissionAction.variant`: the recorded
 * `permission-dialog.json` fixture
 * (`packages/protocol/src/fixtures/daemon-ws/`) marks its `deny` action
 * `variant: "danger"` for exactly this kind of request (`rm -rf
 * ./build`). Treating "any offered action is flagged `danger`" as the
 * dangerous signal is therefore an honest heuristic on the only signal
 * that exists, not an invented one.
 */
function isDangerousRequest(actions: readonly permissions.AgentPermissionAction[]): boolean {
  return actions.some((action) => action.variant === "danger");
}

/** A binary allow/deny action pair fits the `ApprovalForm` recipe's fixed two-button shape as-is. */
function binaryActionPair(
  actions: readonly permissions.AgentPermissionAction[],
): { allow: permissions.AgentPermissionAction; deny: permissions.AgentPermissionAction } | null {
  if (actions.length !== 2) return null;
  const allow = actions.find((action) => action.behavior === "allow");
  const deny = actions.find((action) => action.behavior === "deny");
  return allow && deny ? { allow, deny } : null;
}

interface ToolActionsPanelProps {
  view: permissions.PermissionDialogViewModel;
  onAnswer: (response: permissions.AgentPermissionResponse) => void;
  testId: string;
}

/**
 * Renders the `"tool-actions"` presentation (`kind: "tool" | "plan" |
 * "mode" | "other"`) — real Pi tool/plan/mode permission requests — on
 * the `ApprovalForm` recipe (plan.md §10.4), this task's named building
 * block.
 *
 * `ApprovalForm` is a fixed Approve/Deny pair, which fits every request
 * with zero offered `actions` (a plain allow/deny decision — build the
 * response directly) or exactly one `allow` + one `deny` action (build
 * it from those two actions via `buildActionResponse`, so a daemon that
 * relabels them, e.g. "Run it"/"Don't run it", is reflected exactly).
 *
 * The recorded `permission-dialog.json` fixture shows Pi can also offer
 * a *third* choice ("Always allow") — three actions, not two — which
 * `ApprovalForm`'s two-button API has no slot for. Rather than fork the
 * recipe (plan.md §10 "do not fork a primitive to tweak it") or force a
 * three-choice request through a two-button component (silently
 * dropping "Always allow"), that case renders `ActionsRow` below instead:
 * the same fieldset/legend/detail/warning card language, reusing
 * `ui/recipes/recipes.css`'s `.pc-approval*` classes as-is (they are not
 * `ApprovalForm`-private — nothing about their selectors assumes exactly
 * two buttons), with one button per daemon-offered action.
 */
function ToolActionsPanel({ view, onAnswer, testId }: ToolActionsPanelProps) {
  const detail = toolCallDetailSummary(view);
  const toolLabel = view.title ?? view.name;
  const pair = binaryActionPair(view.actions);

  if (view.actions.length === 0) {
    return (
      <ApprovalForm
        toolLabel={toolLabel}
        detail={detail}
        onApprove={() => onAnswer({ behavior: "allow" })}
        onDeny={() => onAnswer(buildDenyResponse())}
        testId={testId}
      />
    );
  }

  if (pair) {
    return (
      <ApprovalForm
        toolLabel={toolLabel}
        detail={detail}
        dangerous={isDangerousRequest(view.actions)}
        onApprove={() => onAnswer(buildActionResponse(pair.allow))}
        onDeny={() => onAnswer(buildActionResponse(pair.deny))}
        testId={testId}
      />
    );
  }

  return (
    <ActionsRow
      title={toolLabel}
      detail={detail}
      actions={view.actions}
      onAnswer={onAnswer}
      testId={testId}
    />
  );
}

interface ActionsRowProps {
  title: string;
  detail: string;
  actions: readonly permissions.AgentPermissionAction[];
  onAnswer: (response: permissions.AgentPermissionResponse) => void;
  testId: string;
}

/**
 * N-action fallback for a `"tool-actions"` request `ApprovalForm` cannot
 * represent as a fixed pair — see `ToolActionsPanel`'s doc comment.
 *
 * Deny-behavior actions render *first*, matching every other two-choice
 * surface in this design system's own established order (`ApprovalForm`:
 * Deny then Approve; the `Dialog` primitive: Cancel then Confirm) and,
 * critically, matching `useModalBehavior`'s own "focus the first
 * focusable element in the panel on open" rule: that rule runs in a
 * `useEffect` *after* React's own `autoFocus` handling, so it would
 * otherwise silently override an `autoFocus` placed on a later button
 * (a keyboard user must never land on "approve" by default — the same
 * concern `ApprovalForm`'s own doc comment raises for its fixed pair,
 * generalized to however many actions are on offer here).
 */
function ActionsRow({ title, detail, actions, onAnswer, testId }: ActionsRowProps) {
  const dangerous = isDangerousRequest(actions);
  const ordered = [...actions].sort(
    (a, b) => Number(a.behavior !== "deny") - Number(b.behavior !== "deny"),
  );

  return (
    <fieldset
      className={`pc-approval${dangerous ? " pc-approval--dangerous" : ""}`}
      data-testid={testId}
    >
      <legend className="pc-approval__legend">{title} needs your approval</legend>
      <p className="pc-approval__detail">{detail}</p>
      {dangerous ? (
        <p className="pc-approval__warning">Requires extra caution — this cannot be undone.</p>
      ) : null}
      <div className="pc-approval__actions" role="group" aria-label={`${title} actions`}>
        {ordered.map((action, index) => (
          <Button
            key={action.id}
            kind={BUTTON_KIND[action.variant ?? "secondary"]}
            autoFocus={index === 0}
            onClick={() => onAnswer(buildActionResponse(action))}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

type QuestionValue = string | string[];
type QuestionValues = Record<string, QuestionValue>;

function initialQuestionValues(
  questions: readonly permissions.PermissionDialogQuestion[],
): QuestionValues {
  const values: QuestionValues = {};
  for (const question of questions) {
    values[question.header] = question.multiSelect ? [] : "";
  }
  return values;
}

function hasValue(value: QuestionValue | undefined): boolean {
  if (value === undefined) return false;
  return Array.isArray(value) ? value.length > 0 : value.trim().length > 0;
}

interface QuestionFieldProps {
  question: permissions.PermissionDialogQuestion;
  presentation: permissions.PermissionDialogPresentation;
  value: QuestionValue;
  onChange: (value: QuestionValue) => void;
  testId: string;
}

/**
 * Renders one `PermissionDialogQuestion` (the Tier-1 `select`/`input`/
 * `editor`/`confirm` extension dialogs, plan.md §11.2, all normalized to
 * this same shape by `toPermissionDialogViewModel`). A question with
 * `options` is a choice (`Select`, `multiple` when `multiSelect`); one
 * with none is free text (`TextArea` for the `"editor"` presentation,
 * `TextField` otherwise). `allowOther` adds a plain-text override field
 * below the `Select`: whichever of the two the user last typed/chose
 * into wins, since both call the same `onChange` — there is no wire
 * concept of "selected option vs. freeform" beyond the final answer
 * string itself (the ported Pi provider's own
 * `buildCombinedAskUserSelectionResponse` in
 * `packages/server/src/server/agent/providers/pi/agent.ts` classifies
 * freeform purely by "the answer text doesn't match a listed option").
 */
function QuestionField({ question, presentation, value, onChange, testId }: QuestionFieldProps) {
  if (question.options.length > 0) {
    const options = question.options.map((option) => ({
      value: option.label,
      label: option.description ? `${option.label} — ${option.description}` : option.label,
    }));

    if (question.multiSelect) {
      const selected = Array.isArray(value) ? value : [];
      return (
        <Select
          label={question.question}
          options={options}
          multiple
          value={selected}
          onChange={(event) =>
            onChange(Array.from(event.target.selectedOptions).map((option) => option.value))
          }
          testId={testId}
        />
      );
    }

    return (
      <div className="pc-approvals-question__field">
        <Select
          label={question.question}
          options={options}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          testId={testId}
        />
        {question.allowOther ? (
          <TextField
            label="Or type your own answer"
            placeholder={question.placeholder}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
            testId={`${testId}-other`}
          />
        ) : null}
      </div>
    );
  }

  if (presentation === "editor") {
    return (
      <TextArea
        label={question.question}
        placeholder={question.placeholder}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        testId={testId}
      />
    );
  }

  return (
    <TextField
      label={question.question}
      placeholder={question.placeholder}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      testId={testId}
    />
  );
}

interface QuestionPanelProps {
  view: permissions.PermissionDialogViewModel;
  onAnswer: (response: permissions.AgentPermissionResponse) => void;
  testId: string;
}

/**
 * Renders every non-`"tool-actions"` presentation: `select`, `input`,
 * `editor`, `confirm`, and the generic `question` fallback (plan.md
 * §11.2 tier 1). Answers every `view.questions` entry into one
 * `{ [header]: answer }` object via `buildQuestionAnswerResponse`,
 * keyed exactly the way the ported Pi provider reads them back
 * (`permissionAnswer`/`firstPermissionAnswer` in
 * `packages/server/src/server/agent/providers/pi/agent.ts`) — this
 * naturally covers the two-question "select + optional comment"
 * combined `ask_user` dialog without special-casing it, since it is
 * just `view.questions.length === 2`.
 */
function QuestionPanel({ view, onAnswer, testId }: QuestionPanelProps) {
  const [values, setValues] = useState<QuestionValues>(() => initialQuestionValues(view.questions));

  // A fresh request (a different `requestId`) must never inherit a
  // stale draft left over from whichever request was just answered.
  useEffect(() => {
    setValues(initialQuestionValues(view.questions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.requestId]);

  const title = view.title ?? view.name;
  const dismissLabel =
    view.questions.find((question) => question.dismissLabel)?.dismissLabel ?? "Cancel";
  const canSubmit = view.questions.every(
    (question) => question.allowEmpty || hasValue(values[question.header]),
  );

  function updateValue(header: string, value: QuestionValue): void {
    setValues((previous) => ({ ...previous, [header]: value }));
  }

  function submit(): void {
    const answers: Record<string, string> = {};
    for (const question of view.questions) {
      const value = values[question.header];
      answers[question.header] = Array.isArray(value) ? value.join(", ") : (value ?? "");
    }
    onAnswer(buildQuestionAnswerResponse(answers));
  }

  return (
    <fieldset className="pc-approval" data-testid={testId}>
      <legend className="pc-approval__legend">{title}</legend>
      <div className="pc-approvals-question__fields">
        {view.questions.map((question) => (
          <QuestionField
            key={question.header}
            question={question}
            presentation={view.presentation}
            value={values[question.header] ?? (question.multiSelect ? [] : "")}
            onChange={(value) => updateValue(question.header, value)}
            testId={`${testId}-field-${question.header}`}
          />
        ))}
      </div>
      <div className="pc-approval__actions">
        <Button kind="secondary" onClick={() => onAnswer(buildDenyResponse())} autoFocus>
          {dismissLabel}
        </Button>
        <Button kind="primary" onClick={submit} disabled={!canSubmit}>
          Submit
        </Button>
      </div>
    </fieldset>
  );
}

export interface PermissionDialogProps {
  view: permissions.PermissionDialogViewModel;
  /** How many further requests are queued behind `view` (surfaced in text, not just a badge count). */
  waitingCount: number;
  onAnswer: (response: permissions.AgentPermissionResponse) => void;
  testId?: string;
}

/**
 * One modal permission/approval dialog (T28B7, plan.md §12.3 "Dialogs
 * trap focus and are dismissible by keyboard"). Reuses `useModalBehavior`
 * — the same shared hook `Dialog`/`Sheet` (plan.md §10.3) already use —
 * directly, rather than the `Dialog` primitive itself: `Dialog` bakes in
 * its own fixed confirm/cancel button pair, which does not fit either
 * `ApprovalForm`'s own Approve/Deny row or the N-action/question layouts
 * this component switches between, so composing the shared *behavior*
 * hook without the shared *chrome* is the correct reuse here (plan.md
 * §10 "compose the existing primitives... do not fork").
 *
 * `role="alertdialog"` (matching `Dialog`'s own dangerous-confirmation
 * convention) when the request itself is flagged dangerous; `"dialog"`
 * otherwise. Escape and a backdrop click both resolve as a deny/cancel
 * response — never as a silent, unresolved close — because the daemon
 * is still blocked waiting for *some* answer (plan.md §11.2 "these block
 * the extension and require a response or timeout"); leaving the
 * dialog open is always available as the third option.
 */
export function PermissionDialog({ view, waitingCount, onAnswer, testId }: PermissionDialogProps) {
  const dangerous = view.presentation === "tool-actions" && isDangerousRequest(view.actions);
  // Stabilized so `useModalBehavior`'s effect (which refocuses the panel
  // and rebinds the Escape listener on every dependency change) only
  // re-runs when `onAnswer` itself changes — i.e. when `current` genuinely
  // becomes a *different* request — rather than on every unrelated parent
  // re-render (e.g. `ApprovalsHost`'s send-failure banner appearing),
  // which would otherwise yank keyboard focus back to the panel mid-type.
  const dismiss = useCallback(() => onAnswer(buildDenyResponse()), [onAnswer]);
  const panelRef = useModalBehavior(true, dismiss);
  const dialogLabel = view.title ?? view.name;
  const dialogTestId = testId ?? "approvals-dialog";

  return (
    <div
      className="pc-overlay-scrim pc-overlay-scrim--dialog"
      data-testid="approvals-overlay"
      onMouseDown={dismiss}
    >
      <div
        ref={panelRef}
        className="pc-approvals-panel"
        role={dangerous ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-label={dialogLabel}
        tabIndex={-1}
        data-testid={dialogTestId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {view.presentation === "tool-actions" ? (
          <ToolActionsPanel view={view} onAnswer={onAnswer} testId={`${dialogTestId}-tool`} />
        ) : (
          <QuestionPanel view={view} onAnswer={onAnswer} testId={`${dialogTestId}-question`} />
        )}
        {waitingCount > 0 ? (
          <p className="pc-approvals-panel__waiting" data-testid={`${dialogTestId}-waiting`}>
            {waitingCount === 1
              ? "1 more request is waiting."
              : `${waitingCount} more requests are waiting.`}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default PermissionDialog;
