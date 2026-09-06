/**
 * Approvals feature barrel (T28B7, plan.md §6 `features/approvals/`).
 */
export { ApprovalsContainer } from "./ApprovalsContainer.js";
export type { ApprovalsContainerProps } from "./ApprovalsContainer.js";
export { ApprovalsHost } from "./ApprovalsHost.js";
export type { ApprovalsHostProps } from "./ApprovalsHost.js";
export { PermissionDialog } from "./PermissionDialog.js";
export type { PermissionDialogProps } from "./PermissionDialog.js";
export { OutcomeNoticeDialog } from "./OutcomeNotice.js";
export type { OutcomeNoticeDialogProps } from "./OutcomeNotice.js";
export {
  sendPermissionAnswer,
  wirePermissionsController,
  wireRequestArbitrator,
} from "./daemon-permissions-client.js";
export type {
  DaemonPermissionRequestMessage,
  DaemonPermissionResolvedMessage,
  DaemonPermissionsSource,
} from "./daemon-permissions-client.js";
export { buildOutcomeNotice, describeAnsweredBy, describeOutcome } from "./outcome-notice.js";
export type { OutcomeNoticeViewModel } from "./outcome-notice.js";
export { useApprovalsQueue } from "./use-approvals-queue.js";
export type { ApprovalsQueueState, UseApprovalsQueueOptions } from "./use-approvals-queue.js";
