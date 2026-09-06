/**
 * Extensions domain — plan.md §6/§7.1.
 *
 * Owns Pi UI element state keyed by `ns:id`, client-side revision handling
 * mirroring the daemon rules, and reconnect replay (T21B); and the
 * `ExtensionActionController` (T21C), which dispatches `pi.ui.action.request`
 * and resolves it via `pi.ui.action.response`/`pi_ui_action_result` under
 * composite action identity `(agentId, namespace, elementId, actionId,
 * requestId)` (plan.md §12.3).
 *
 * Repository invariant: this module must never import React, React
 * Native, Expo, DOM types, or browser globals.
 */

export { PIUI_NS_SEPARATOR, piUiElementKey, piUiElementKeyOf } from "./identity.js";

export {
  PIUI_INITIAL_REVISION,
  PiUiRevisionTracker,
  decidePiUiDeltaRevision,
  decidePiUiFullStateRevision,
  isPiUiRevision,
  type PiUiDeltaRevisionDecision,
  type PiUiFullStateRevisionDecision,
} from "./revision.js";

export {
  normalizePiUiElement,
  normalizePiUiElementTyped,
  normalizePiUiElements,
} from "./normalize.js";

export {
  PiUiElementStore,
  ingestPiUiReplayBatch,
  piUiSnapshotState,
  type PiUiAgentSnapshot,
  type PiUiChangeListener,
  type PiUiIngestOutcome,
  type PiUiResyncListener,
  type PiUiResyncReason,
} from "./state.js";

export {
  ExtensionActionConfirmationRequiredError,
  ExtensionActionController,
  extensionActionTargetKey,
  getActionConfirmation,
  requiresConfirmation,
  type ActionConfirmation,
  type DispatchActionInput,
  type ExtensionActionControllerOptions,
  type ExtensionActionListener,
  type ExtensionActionState,
  type ExtensionActionTarget,
  type PiUiActionRequestMessage,
  type PiUiActionResponseMessage,
  type PiUiActionResponsePayload,
  type SettledExtensionAction,
} from "./action-controller.js";
