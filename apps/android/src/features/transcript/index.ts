/**
 * `features/transcript` barrel (T33A1, extended by T33A2). Exports the
 * header/status strip (T33A1) for the plan.md §9.2 compact session
 * layout's `header`/`statusStrip` `CompactSessionShell` slots, and the
 * message row + streaming batcher (T33A2) for its `transcript` slot.
 *
 * Thinking sections (T33A3) and tool-call rows (T33A4) are exported
 * below. The pinned live extension area (T34A4) is out of this task's
 * scope.
 */
export { TranscriptHeader } from "./header";
export type { TranscriptHeaderProps } from "./header";
export {
  buildTranscriptHeaderViewModel,
  type TranscriptHeaderInput,
  type TranscriptHeaderViewModel,
} from "./header-model";

export { TranscriptStatusStrip } from "./status-strip";
export type { TranscriptStatusStripProps } from "./status-strip";
export {
  TRANSCRIPT_STATUSES,
  buildTranscriptStatusViewModel,
  deriveTranscriptStatus,
  type DeriveTranscriptStatusInput,
  type TranscriptStatus,
  type TranscriptStatusViewModel,
} from "./status-model";

export { TranscriptMessageRow, isCoreMessageEntry } from "./message-row";
export type { CoreMessageEntry, TranscriptMessageRowProps } from "./message-row";
export {
  MAX_TEXT_CHARS,
  TRUNCATION_SUFFIX,
  areMessageRowPropsEqual,
  boundedText,
  roleAffordanceFor,
  speakerFor,
} from "./message-row-model";
export type { RoleAffordance } from "./message-row-model";

export { MessageAttachments } from "./message-attachments";
export type { MessageAttachmentsProps, ResolveImageUri } from "./message-attachments";
export {
  MAX_IMAGES_PER_ENTRY,
  MAX_INLINE_IMAGE_BYTES,
  accessibleImageName,
  boundImages,
  formatImageKind,
  formatImageSize,
  imageAttachmentViewModel,
  imageGroupAccessibilityLabel,
} from "./message-attachments-model";
export type { AttachmentImageContext, ImageAttachmentViewModel } from "./message-attachments-model";

export { createTranscriptMessageBatcher } from "./transcript-message-batcher";
export type {
  TranscriptMessageBatcher,
  TranscriptMessageBatcherListener,
} from "./transcript-message-batcher";

export { TranscriptThinkingRow, filterThinkingEntries, isThinkingEntry } from "./thinking-row";
export type { ThinkingTranscriptEntry, TranscriptThinkingRowProps } from "./thinking-row";
export {
  MAX_BODY_CHARS,
  MAX_SUMMARY_CHARS,
  areThinkingRowPropsEqual,
  bodyFor as thinkingBodyFor,
  formatElapsedDuration,
  shouldAnimateShimmer,
  summaryFor as thinkingSummaryFor,
} from "./thinking-row-model";

export { TranscriptToolCallRow, isToolCallEntry } from "./tool-call-row";
export type { ToolCallTranscriptEntry, TranscriptToolCallRowProps } from "./tool-call-row";
export { TranscriptWindowList } from "./transcript-window";
export type { TranscriptWindowListProps } from "./transcript-window";
export {
  createTranscriptWindow,
  DEFAULT_TRANSCRIPT_WINDOW_CONFIG,
  isNearBottom,
} from "./transcript-window-model";
export type {
  TranscriptScrollMetrics,
  TranscriptWindow,
  TranscriptWindowConfig,
  TranscriptWindowEntry,
  TranscriptWindowSnapshot,
} from "./transcript-window-model";

export { fireTranscriptStatusHaptic } from "./transcript-status-haptics-model";

export { RecoveredTurnBanner } from "./recovered-turn-banner";
export type { RecoveredTurnBannerProps } from "./recovered-turn-banner";
export {
  selectRecoveredTurnsForSession,
  describeRecoveredTurn,
  confirmRecoveredTurn,
  discardRecoveredTurn,
} from "./recovered-turn-model";
export type { AwaitingConfirmationTurn, RecoveredTurnOutbox } from "./recovered-turn-model";

export {
  MAX_PAYLOAD_CHARS as TOOL_CALL_MAX_PAYLOAD_CHARS,
  STATUS_TEXT as TOOL_CALL_STATUS_TEXT,
  STATUS_TONE as TOOL_CALL_STATUS_TONE,
  areToolCallRowPropsEqual,
  boundedRedactedSummary,
  cardKindFor,
  DIFF_LINE_CAP as TOOL_CALL_DIFF_LINE_CAP,
  diffCounts as toolCallDiffCounts,
  diffLinesFor as toolCallDiffLinesFor,
  filterToolCallEntries,
  formatToolDuration,
  genericInputSummary,
  genericResultSummary,
  isKnownToolCall,
  redactValue,
  statusTextFor as toolCallStatusTextFor,
  unrecognizedToolMeta,
} from "./tool-call-row-model";
