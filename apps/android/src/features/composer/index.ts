/**
 * `features/composer` barrel (T33B1, plan.md §9.2; steer/follow-up/abort
 * T33B2). Route stubs and other features import the composer from here
 * rather than reaching into individual files.
 */
export { Composer } from "./Composer";
export type { ComposerProps } from "./Composer";
export { ComposerIconAction } from "./composer-icon-action";
export type { ComposerIconActionProps } from "./composer-icon-action";
export {
  ABORT_ACTION_LABEL,
  ATTACH_ACTION_LABEL,
  COMPOSER_ACCESSIBILITY_LABEL,
  COMPOSER_INPUT_LABEL,
  DEFAULT_DISPATCH_MODE,
  EMPTY_COMPOSER_STATE,
  FOLLOW_UP_ACTION_LABEL,
  MIC_ACTION_LABEL,
  QUEUE_MODE_LABEL,
  STEER_ACTION_LABEL,
  abortTurn,
  canAbort,
  canFollowUpDraft,
  canSteerDraft,
  canSubmitDraft,
  describeEntryStatus,
  describeQueueStatus,
  dispatchModeLabel,
  entryStatusLabel,
  finishTurn,
  markEntryFailed,
  markEntrySent,
  markFollowUpFailed,
  markFollowUpSent,
  markSteerFailed,
  markSteerSent,
  pendingCount,
  queueDepth,
  queueDepthLabel,
  recoverFailedDraft,
  retryActionLabel,
  revertDispatchMode,
  setDispatchMode,
  startTurn,
  submitDraft,
  submitFollowUp,
  submitSteer,
} from "./composer-model";
export type {
  AbortTurnResult,
  ComposerEntry,
  ComposerEntryStatus,
  ComposerModelDeps,
  ComposerState,
  QueueDepth,
  QueueDispatchMode,
  RecoverFailedDraftResult,
  SetDispatchModeResult,
  SubmitDraftResult,
  TurnService,
} from "./composer-model";
export {
  COMPOSER_LAYOUT_CONTRACT,
  INITIAL_COMPOSER_FOCUS_STATE,
  blurComposer,
  closeSheet,
  focusComposer,
  openSheet,
  resolveFocusOwner,
  rotate,
} from "./composer-focus-model";
export type {
  ComposerFocusState,
  ComposerLayoutContract,
  Dimensions,
  FocusOwner,
  SheetKind,
} from "./composer-focus-model";

// --- T33B7: attachments + mic permission recovery -----------------------
export {
  DEFAULT_ATTACHMENT_LIMITS,
  EMPTY_ATTACHMENTS_STATE,
  attachmentStatusLabel,
  clearAttachments,
  describeAttachmentLimits,
  evaluateAttachmentCandidate,
  formatAttachmentBytes,
  hasPendingUploads,
  hasSendableAttachments,
  markAttachmentError,
  markAttachmentUploaded,
  removeAttachment,
  stageAttachment,
  totalStagedBytes,
  uploadedAttachmentRefs,
} from "./attachment-model";
export type {
  AttachmentAcceptance,
  AttachmentCandidate,
  AttachmentLimits,
  AttachmentRejectionReason,
  AttachmentUploadClient,
  AttachmentsState,
  ComposerUploadedAttachment,
  StagedAttachment,
  StagedAttachmentStatus,
} from "./attachment-model";
export {
  createUnavailableAttachmentSourcePort,
  createUnavailableCameraCapturePort,
  readUriAsBytes,
} from "./attachment-source-port";
export type {
  AttachmentFilePickOptions,
  AttachmentSourcePort,
  CameraCapturePort,
  PickedAttachmentFile,
} from "./attachment-source-port";
// T290: the real, `expo-document-picker`/`expo-image-picker`-backed
// ports. Exported from their own files, not `attachment-source-port.ts`
// — see that file's header for why (transitively importing
// `react-native`). Mirrors `../voice/index.ts`'s identical treatment of
// `createExpoAudioVoiceCapturePort`.
export { createExpoAttachmentSourcePort } from "./expo-attachment-source-port";
export { createExpoCameraCapturePort } from "./expo-camera-capture-port";
export { describePermissionRecovery, resolvePermission } from "./permission-recovery";
export type {
  PermissionKind,
  PermissionPort,
  PermissionRecoveryActionKind,
  PermissionRecoveryCopy,
  PermissionState,
} from "./permission-recovery";
export { PermissionRecoveryNotice } from "./PermissionRecoveryNotice";
export type { PermissionRecoveryNoticeProps } from "./PermissionRecoveryNotice";
export { createInMemoryStructuredStorage, createSystemClock } from "./in-memory-outbox-runtime";

// --- T39B: model/thinking-level selection --------------------------------
export {
  INITIAL_MODEL_THINKING_STATE,
  createModelThinkingController,
  currentModelLabel,
  currentThinkingLabel,
  describeModelThinkingUnavailable,
  selectedModelOption,
  supportsModelThinking,
  thinkingOptionsForSelection,
} from "./model-thinking-model";
export type {
  DaemonModelThinkingSource,
  ModelThinkingAgentSnapshot,
  ModelThinkingAvailability,
  ModelThinkingController,
  ModelThinkingControllerDeps,
  ModelThinkingModelOption,
  ModelThinkingOption,
  ModelThinkingProviderNotice,
  ModelThinkingState,
} from "./model-thinking-model";
export { ModelThinkingPicker } from "./ModelThinkingPicker";
export type { ModelThinkingPickerProps } from "./ModelThinkingPicker";

// --- T39C: session-wide steer/follow-up queue mode ------------------------
export {
  INITIAL_QUEUE_MODES_STATE,
  createQueueModesController,
  describeQueueModesUnavailable,
  queueModeLabel,
  supportsQueueModes,
} from "./queue-mode-model";
export type {
  AgentQueueModes,
  DaemonQueueModeSource,
  QueueMode,
  QueueModeProviderNotice,
  QueueModesAvailability,
  QueueModesController,
  QueueModesControllerDeps,
  QueueModesState,
} from "./queue-mode-model";
export { QueueModePicker } from "./QueueModePicker";
export type { QueueModePickerProps } from "./QueueModePicker";

// --- T39C: retry/compaction live status ------------------------------------
export {
  INITIAL_TURN_STATUS_STATE,
  applyTurnStreamEvent,
  clearRetryForNewTurn,
  createTurnStatusController,
  describeCompactionStatus,
  describeRetryStatus,
  describeTurnStatusUnavailable,
} from "./turn-status-model";
export type {
  DaemonTurnStatusSource,
  TurnCompactionStatus,
  TurnCompactionTimelineItem,
  TurnRetryEvent,
  TurnRetryStatus,
  TurnStatusAvailability,
  TurnStatusController,
  TurnStatusControllerDeps,
  TurnStatusState,
  TurnStreamEvent,
  TurnStreamMessage,
  TurnTimelineEvent,
} from "./turn-status-model";
export { TurnStatusBanner } from "./TurnStatusBanner";
export type { TurnStatusBannerProps } from "./TurnStatusBanner";
