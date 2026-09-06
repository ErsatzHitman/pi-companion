/**
 * Permissions domain — plan.md §6/§7.1, §11.2, §12.3.
 *
 * Owns permission requests and extension dialog requests (select,
 * confirm, input, editor) with pending/answered/timeout states and
 * response dispatch (T21A, `docs/issues-from-plan.md`).
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */

export { PermissionsController } from "./controller.js";
export type {
  PermissionMessageHandlingResult,
  PermissionsControllerOptions,
} from "./controller.js";

export {
  buildActionResponse,
  buildDenyResponse,
  buildQuestionAnswerResponse,
} from "./responses.js";

export { isExtensionDialogMethod } from "./types.js";
export type {
  AgentPermissionAction,
  AgentPermissionRequest,
  AgentPermissionRequestKind,
  AgentPermissionResponse,
  AgentPermissionResponseWireMessage,
  ExtensionDialogMethod,
  PermissionDialogEntry,
  PermissionDialogPresentation,
  PermissionDialogQuestion,
  PermissionDialogQuestionOption,
  PermissionDialogStatus,
  PermissionDialogViewModel,
} from "./types.js";

export { toPermissionDialogViewModel } from "./view-model.js";
