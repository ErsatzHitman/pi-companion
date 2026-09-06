/**
 * Public barrel for the web Pi UI Bridge renderer registry (T29A1). App
 * wiring and per-kind renderer modules (T29A2 onward) import from here
 * rather than reaching into `registry.ts`/`registry-view.tsx`/
 * `registry-boundary.tsx` individually.
 *
 * Kept separate from `registry.ts` itself (rather than re-exported there)
 * so `registry.ts` never has to import back from `registry-view.tsx`,
 * which imports it — an unnecessary module cycle.
 */
export {
  PI_UI_MAX_PAYLOAD_BYTES,
  PiUiRendererRegistry,
  estimatePiUiPayloadBytes,
  isPiUiPayloadOversized,
  piUiActionTarget,
  piUiRendererRegistry,
  type PiUiDispatchAction,
  type PiUiDispatchActionOptions,
  type PiUiElementRendererProps,
  type PiUiKindRenderer,
  type PiUiPayloadForKind,
} from "./registry.js";
export {
  ExtensionElementBoundary,
  type ExtensionElementBoundaryProps,
} from "./registry-boundary.js";
export { PiUiElementView, type PiUiElementViewProps } from "./registry-view.js";
export {
  DangerousActionConfirmDialog,
  type DangerousActionConfirmDialogProps,
} from "./dangerous-action-confirm.js";
