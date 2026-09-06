/**
 * Maps a raw daemon `AgentPermissionRequest` (plan.md §12.3, §7.1) onto
 * the platform-neutral `PermissionDialogViewModel`. Never throws: an
 * unrecognized shape degrades to the generic `"question"` or
 * `"tool-actions"` presentation rather than being dropped, matching the
 * "unknown input becomes a visible diagnostic" rule in plan.md §11.2.
 */

import type {
  AgentPermissionAction,
  AgentPermissionRequest,
  ExtensionDialogMethod,
  PermissionDialogPresentation,
  PermissionDialogQuestion,
  PermissionDialogQuestionOption,
  PermissionDialogViewModel,
} from "./types.js";
import { isExtensionDialogMethod } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readQuestionOptions(value: unknown): PermissionDialogQuestionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const options: PermissionDialogQuestionOption[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      options.push({ label: entry });
      continue;
    }
    if (isRecord(entry) && typeof entry.label === "string") {
      const description = readString(entry.description);
      options.push(description ? { label: entry.label, description } : { label: entry.label });
    }
  }
  return options;
}

function readQuestions(value: unknown): PermissionDialogQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const questions: PermissionDialogQuestion[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const question = readString(entry.question);
    const header = readString(entry.header);
    if (question === undefined || header === undefined) {
      continue;
    }
    const placeholder = readString(entry.placeholder);
    const dismissLabel = readString(entry.dismissLabel);
    const allowEmpty = readBoolean(entry.allowEmpty);
    const allowOther = readBoolean(entry.allowOther);
    questions.push({
      question,
      header,
      options: readQuestionOptions(entry.options),
      multiSelect: readBoolean(entry.multiSelect) ?? false,
      ...(placeholder !== undefined ? { placeholder } : {}),
      ...(allowEmpty !== undefined ? { allowEmpty } : {}),
      ...(allowOther !== undefined ? { allowOther } : {}),
      ...(dismissLabel !== undefined ? { dismissLabel } : {}),
    });
  }
  return questions;
}

function presentationFor(
  kind: AgentPermissionRequest["kind"],
  extensionUiMethod: ExtensionDialogMethod | null,
): PermissionDialogPresentation {
  if (kind === "question") {
    return extensionUiMethod ?? "question";
  }
  return "tool-actions";
}

/** Builds the renderer-ready view model for one `agentId` + `AgentPermissionRequest` pair. */
export function toPermissionDialogViewModel(
  agentId: string,
  request: AgentPermissionRequest,
): PermissionDialogViewModel {
  const metadata: Record<string, unknown> = isRecord(request.metadata) ? request.metadata : {};
  const extensionUiMethod = isExtensionDialogMethod(metadata.extensionUiMethod)
    ? metadata.extensionUiMethod
    : null;
  const actions: AgentPermissionAction[] = Array.isArray(request.actions) ? request.actions : [];
  const questions = isRecord(request.input) ? readQuestions(request.input.questions) : [];

  return {
    requestId: request.id,
    agentId,
    provider: request.provider,
    name: request.name,
    kind: request.kind,
    presentation: presentationFor(request.kind, extensionUiMethod),
    extensionUiMethod,
    ...(request.title !== undefined ? { title: request.title } : {}),
    ...(request.description !== undefined ? { description: request.description } : {}),
    actions,
    questions,
    metadata,
    raw: request,
  };
}
