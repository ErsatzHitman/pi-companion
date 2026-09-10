/**
 * `features/composer` barrel (T33B1, plan.md §9.2; steer/follow-up/abort
 * T33B2). Route stubs and other features import the composer from here
 * rather than reaching into individual files.
 */
export { Composer } from "./Composer";
export type { ComposerProps } from "./Composer";
// T355: the redesign's `.blk` surfaces and geometry for the composer's
// queued-entry stack. See `entry-block-model.ts`'s module doc.
export {
  ENTRY_BLOCK_GAP,
  ENTRY_BLOCK_PADDING_HORIZONTAL,
  ENTRY_BLOCK_PADDING_VERTICAL,
  ENTRY_BLOCK_RADIUS,
  entryBlockIsOutlined,
  entryBlockSurface,
} from "./entry-block-model";
export type { EntryBlockSurface } from "./entry-block-model";
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
  SLASH_COMMANDS_ACTION_LABEL,
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

// T353: the context ring and the menu it opens — the redesign's
// replacement for the four control pills that used to sit above the
// prompt bar. See `context-ring-model.ts`'s module doc.
export {
  CONTEXT_RING_CIRCUMFERENCE,
  CONTEXT_RING_RADIUS,
  CONTEXT_RING_SIZE,
  CONTEXT_RING_STROKE,
  buildContextRingViewModel,
} from "./context-ring-model";
export type { ContextRingViewModel } from "./context-ring-model";
export { ContextRing } from "./ContextRing";
export type { ContextRingProps } from "./ContextRing";
export { PromptControlsMenu } from "./PromptControlsMenu";
export type { PromptControlsMenuProps } from "./PromptControlsMenu";

// T354: the Build/Plan mode control and the auto-compaction switch the
// context-ring menu's MODE and CONTEXT groups mount. See
// `session-controls-model.ts`'s module doc for why one controller owns
// both settings.
export {
  INITIAL_SESSION_CONTROLS_STATE,
  createSessionControlsController,
  currentModeLabel,
  describeAutoCompaction,
  describeSessionControlsUnavailable,
  supportsSessionControls,
} from "./session-controls-model";
export type {
  DaemonSessionControlsSource,
  SessionControlsAgentSnapshot,
  SessionControlsAvailability,
  SessionControlsController,
  SessionControlsControllerDeps,
  SessionControlsNotice,
  SessionControlsState,
  SessionModeOption,
} from "./session-controls-model";
export { SessionControlsPicker } from "./SessionControlsPicker";
export type { SessionControlsPickerProps } from "./SessionControlsPicker";

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

// --- T292: slash-command completion ---------------------------------------
export {
  INITIAL_SLASH_COMMANDS_STATE,
  createSlashCommandsController,
  describeSlashCommand,
  isBareSlashPrefix,
  slashCommandDraftText,
} from "./slash-command-model";
export type {
  DaemonSlashCommandSource,
  SlashCommand,
  SlashCommandsController,
  SlashCommandsControllerDeps,
  SlashCommandsState,
} from "./slash-command-model";
export { SlashCommandPicker } from "./SlashCommandPicker";
export type { SlashCommandPickerProps } from "./SlashCommandPicker";

// --- T293: getEditorText / pasteToEditor composer read --------------------
export { wireEditorTextResponder } from "./editor-text-model";
export type { DaemonEditorTextRequestMessage, DaemonEditorTextSource } from "./editor-text-model";
