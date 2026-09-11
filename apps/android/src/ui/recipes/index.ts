/**
 * §10.4 product recipe barrel (plan.md §10.4, T26B). Feature code imports
 * recipes from here, mirroring `ui/primitives/index.ts`.
 */
export { ApprovalForm } from "./ApprovalForm";
export type { ApprovalFormProps } from "./ApprovalForm";
export { BashBlock } from "./BashBlock";
export type { BashBlockProps } from "./BashBlock";
export { CodeListing } from "./CodeListing";
export type { CodeListingProps } from "./CodeListing";
export { CommandSearch } from "./CommandSearch";
export type { CommandSearchItem, CommandSearchProps } from "./CommandSearch";
export { DiffLines, MatchedLine } from "./DiffLines";
export type { DiffLinesProps, MatchedLineProps } from "./DiffLines";
export {
  DIFF_LINE_PADDING_HORIZONTAL,
  DIFF_LINE_RADIUS,
  changedSpans,
  diffLineAnnouncement,
  diffLineInk,
  diffLineSurface,
  highlightHits,
  pairChangedLines,
  toneForDiffKind,
} from "./diff-lines-model";
export type {
  DiffLineInput,
  DiffLineItem,
  DiffLineSpan,
  DiffLineTone,
  HitSpan,
} from "./diff-lines-model";
export { DiffSummary } from "./DiffSummary";
export type { DiffSummaryProps } from "./DiffSummary";
export { PixelLoader } from "./PixelLoader";
export type { PixelLoaderProps } from "./PixelLoader";
export { ScreenBar } from "./ScreenBar";
export type { ScreenBarAction, ScreenBarProps } from "./ScreenBar";
export { ProgressRing } from "./ProgressRing";
export type { ProgressRingProps } from "./ProgressRing";
export { PromptBar } from "./PromptBar";
export type { PromptBarProps } from "./PromptBar";
export { SelectionActions } from "./SelectionActions";
export type { SelectionAction, SelectionActionsProps } from "./SelectionActions";
export { ShimmerText } from "./ShimmerText";
export type { ShimmerTextProps } from "./ShimmerText";
export { StreamingMessage } from "./StreamingMessage";
export type { StreamingMessageProps } from "./StreamingMessage";
export { TaskRows } from "./TaskRows";
export type { TaskRowItem, TaskRowStatus, TaskRowsProps } from "./TaskRows";
export { ThinkingSection } from "./ThinkingSection";
export type { ThinkingSectionProps } from "./ThinkingSection";
export { ToolChips } from "./ToolChips";
export type { ToolChipItem, ToolChipsProps } from "./ToolChips";
export { WorkflowSteps } from "./WorkflowSteps";
export type { WorkflowStepItem, WorkflowStepStatus, WorkflowStepsProps } from "./WorkflowSteps";
