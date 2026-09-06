/**
 * Approvals feature barrel (T33B5, plan.md §6 `features/approvals/`).
 * See `ApprovalsContainer.tsx`'s doc comment for what a mount needs.
 */
export { ApprovalsContainer } from "./ApprovalsContainer";
export type { ApprovalsContainerProps } from "./ApprovalsContainer";
export { ApprovalsHost } from "./ApprovalsHost";
export type { ApprovalsHostProps } from "./ApprovalsHost";
export {
  EMPTY_APPROVALS_QUEUE_SNAPSHOT,
  fireApprovalDecisionHaptic,
  fireBlockedHapticOnNewRequest,
} from "./approvals-haptics-model";
export {
  binaryActionPair,
  describeWaitingCount,
  getApprovalsQueueSnapshot,
  isDangerousRequest,
  resolveApprovalPanel,
  toolCallSummary,
} from "./approvals-queue-model";
export type {
  ActionsRowApprovalPanel,
  ApprovalPanel,
  ApprovalsQueueSnapshot,
  BinaryApprovalPanel,
  UnsupportedApprovalPanel,
} from "./approvals-queue-model";
export { sendPermissionAnswer, wirePermissionsController } from "./daemon-permissions-client";
export type {
  DaemonPermissionRequestMessage,
  DaemonPermissionResolvedMessage,
  DaemonPermissionsSource,
} from "./daemon-permissions-client";
export { useApprovalsQueue } from "./use-approvals-queue";
export type { ApprovalsQueueState, UseApprovalsQueueOptions } from "./use-approvals-queue";
