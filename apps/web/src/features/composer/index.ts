/**
 * Composer feature (plan.md §8.3; T28B1-T28B7, T38B1a, T38B1b). Owned
 * entirely by this directory's tasks; see docs/issues-from-plan.md.
 */
export { Composer } from "./Composer.js";
export type { ComposerProps } from "./Composer.js";
export { ComposerContainer } from "./ComposerContainer.js";
export type { ComposerContainerProps } from "./ComposerContainer.js";
export { useComposer } from "./use-composer.js";
export type { ComposerState, UseComposerOptions } from "./use-composer.js";
export type {
  AgentAvailableModels,
  AgentModelOption,
  AgentModelSnapshot,
  AgentProviderNotice,
  AgentQueueModes,
  AgentQueueUpdate,
  AgentSlashCommand,
  AgentThinkingOption,
  AgentTurnClient,
  AgentUploadedAttachment,
  PromptStreamingBehavior,
  QueueMode,
  SendAgentMessageOptions,
} from "./agent-turn-client.js";
export { createDaemonAgentTurnClient } from "./daemon-agent-turn-client.js";
export type {
  DaemonAgentModelFields,
  DaemonAgentStreamMessage,
  DaemonAgentUpdateMessage,
  DaemonFetchAgentModelResult,
  DaemonOtherStreamEvent,
  DaemonQueueUpdateEvent,
  DaemonTurnClient,
} from "./daemon-agent-turn-client.js";
export { QueueModePicker } from "./QueueModePicker.js";
export type { QueueModePickerProps } from "./QueueModePicker.js";
export { PromptRoutingPicker } from "./PromptRoutingPicker.js";
export type { PromptRoutingPickerProps } from "./PromptRoutingPicker.js";
export { useQueueModes } from "./use-queue-modes.js";
export type {
  QueueModesAvailability,
  QueueModesState,
  UseQueueModesOptions,
} from "./use-queue-modes.js";
export { useSlashCommands } from "./use-slash-commands.js";
export type { UseSlashCommandsOptions, UseSlashCommandsState } from "./use-slash-commands.js";
export { ModelThinkingPicker } from "./ModelThinkingPicker.js";
export type { ModelThinkingPickerProps } from "./ModelThinkingPicker.js";
export { useModelThinking } from "./use-model-thinking.js";
export type {
  ModelThinkingAvailability,
  ModelThinkingState,
  UseModelThinkingOptions,
} from "./use-model-thinking.js";
export { formatAttachmentSize, useAttachments } from "./use-attachments.js";
export type {
  ComposerAttachment,
  ComposerAttachmentStatus,
  UseAttachmentsOptions,
  UseAttachmentsState,
} from "./use-attachments.js";
export {
  filesFromClipboardItems,
  filesFromDataTransfer,
  synthesizePastedImageName,
  toPickedFile,
} from "./browser-file-inputs.js";
export { useDragAndDrop } from "./use-drag-and-drop.js";
export type {
  DropZoneHandlers,
  UseDragAndDropOptions,
  UseDragAndDropState,
} from "./use-drag-and-drop.js";
export { useComposerPaste } from "./use-clipboard-paste.js";
export type { UseClipboardPasteOptions } from "./use-clipboard-paste.js";
