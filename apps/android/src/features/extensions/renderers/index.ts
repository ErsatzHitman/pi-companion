/**
 * Registers the Android `status`, `widget`, `progress`, `log`, `markdown`,
 * `composer`, `roster`, `form`, `diff`, and `panel` kind renderers into the
 * shared registry (`../registry.ts`; T34A1) — T34A2, T34A3, T34B1, T34B2,
 * T34B3, and T34B4. `panel` is the last link in the T34 chain, which is
 * why the T34 chain is serialized: every link edits this one module.
 *
 * Registration lives here rather than in `../registry.ts` itself because
 * that module is deliberately import-free of `./renderers/` (its own doc
 * comment): keeping it free of any React Native import is what lets its
 * pure half — the size cap, the action target, and
 * `resolvePiUiElementRenderDecision` — be unit tested in this workspace at
 * all. This is the same arrangement as the web side's
 * `apps/web/src/features/extensions/renderers/index.ts`.
 *
 * Importing this module (for its side effect) is how app wiring turns
 * these registrations on; individual renderer modules never register
 * themselves at their own definition site, so importing one directly never
 * double-registers it. A kind with nothing registered yet renders through
 * `registry-view.tsx`'s "no renderer" diagnostic instead.
 */
import { piUiRendererRegistry } from "../registry";
import { ComposerRenderer } from "./composer";
import { DiffRenderer } from "./diff";
import { FormRenderer } from "./form";
import { LogRenderer } from "./log";
import { MarkdownRenderer } from "./markdown";
import { PanelRenderer } from "./panel";
import { ProgressRenderer } from "./progress";
import { RosterRenderer } from "./roster";
import { StatusRenderer } from "./status";
import { WidgetRenderer } from "./widget";

piUiRendererRegistry.register("status", StatusRenderer);
piUiRendererRegistry.register("widget", WidgetRenderer);
piUiRendererRegistry.register("progress", ProgressRenderer);
piUiRendererRegistry.register("log", LogRenderer);
piUiRendererRegistry.register("markdown", MarkdownRenderer);
piUiRendererRegistry.register("composer", ComposerRenderer);
piUiRendererRegistry.register("roster", RosterRenderer);
piUiRendererRegistry.register("form", FormRenderer);
piUiRendererRegistry.register("diff", DiffRenderer);
piUiRendererRegistry.register("panel", PanelRenderer);

export {
  ComposerRenderer,
  DiffRenderer,
  FormRenderer,
  LogRenderer,
  MarkdownRenderer,
  PanelRenderer,
  ProgressRenderer,
  RosterRenderer,
  StatusRenderer,
  WidgetRenderer,
};
export { ElementActionsRow, type ElementActionsRowProps } from "./element-actions";
export {
  actionFeedbackText,
  buildElementActionModels,
  type PiUiActionButtonKind,
  type PiUiActionButtonModel,
} from "./element-actions-model";
export { buildComposerRenderModel, type PiUiComposerRenderModel } from "./composer-model";
export {
  DEFAULT_DIFF_CHANGE_LINE_CAP,
  buildDiffRenderModel,
  countDiffLines,
  parseUnifiedDiffLines,
  type PiUiDiffCounts,
  type PiUiDiffLine,
  type PiUiDiffLineKind,
  type PiUiDiffLineModel,
  type PiUiDiffRenderModel,
} from "./diff-model";
export {
  buildFormActionsModel,
  buildFormFieldsModel,
  buildFormRenderModel,
  buildFormValidation,
  buildInitialFormValues,
  defaultFormFieldValue,
  filterFormSelectOptions,
  formActionFeedbackText,
  formFieldError,
  resolveFormCloseAction,
  resolveFormSubmitGate,
  toggleMultiSelectValue,
  type PiUiFormActionModel,
  type PiUiFormFieldModel,
  type PiUiFormFieldValue,
  type PiUiFormRenderModel,
  type PiUiFormSubmitGate,
  type PiUiFormValidation,
  type PiUiFormValues,
} from "./form-model";
export { DEFAULT_LOG_TAIL, buildLogRenderModel, type PiUiLogRenderModel } from "./log-model";
export {
  buildMarkdownRenderModel,
  flattenInlineText,
  isSafeMarkdownHref,
  parseInline,
  parseMarkdown,
  type MdBlockNode,
  type MdInlineNode,
  type PiUiMarkdownRenderModel,
} from "./markdown-model";
export {
  buildPanelRenderModel,
  resolvePanelChildDecision,
  type PiUiPanelChildDecision,
  type PiUiPanelChildDiagnosticDecision,
  type PiUiPanelChildStatus,
  type PiUiPanelRenderModel,
} from "./panel-model";
export {
  buildProgressRenderModel,
  clampProgressFraction,
  type PiUiProgressRenderModel,
} from "./progress-model";
export {
  buildRosterRenderModel,
  buildRosterRowActionsModel,
  formatElapsedSeconds,
  resolveRosterActive,
  type PiUiRosterRenderModel,
  type PiUiRosterRowActionsModel,
  type PiUiRosterRowModel,
} from "./roster-model";
export {
  buildStatusRenderModel,
  type PiUiAnnouncedText,
  type PiUiStatusRenderModel,
} from "./status-model";
export {
  WIDGET_EMPTY_TEXT,
  buildWidgetRenderModel,
  type PiUiWidgetBodyModel,
  type PiUiWidgetRenderModel,
  type PiUiWidgetRowModel,
} from "./widget-model";
export {
  humanizeNamespace,
  piUiToneToPrimitiveTone,
  toneChipLabel,
  type PiPrimitiveTone,
} from "./tone";
