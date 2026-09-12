/**
 * Public barrel for the Android Pi UI Bridge renderer registry (T34A1),
 * and — since T34A5 — the one place that constructs the live element
 * store and action controller a screen needs to make Pi UI elements
 * render at all. App wiring and per-kind renderer modules (T34A2 onward)
 * import from here rather than reaching into `registry.ts`/
 * `registry-plan.ts`/`registry-view.tsx`/`registry-boundary.tsx`/
 * `registry-diagnostic.tsx`/`registry-confirm.tsx` individually.
 *
 * Importing this barrel also turns the per-kind renderers on: the
 * side-effect import below pulls in `./renderers/index.ts`, whose module
 * body is what calls `piUiRendererRegistry.register(...)` for every kind
 * implemented so far (T34A2 onward). Registration lives at an import site
 * rather than inside `registry.ts` because that module is deliberately
 * free of any `./renderers/` import — that is what keeps its pure half
 * (the size cap, the action target, `resolvePiUiElementRenderDecision`)
 * unit testable in a workspace whose vitest cannot parse `react-native`.
 * This mirrors the web side, where `renderers/index.ts` is likewise
 * imported for its side effect by the module that mounts element cards
 * (`apps/web/src/features/rail/rail-element-card.tsx`). Without an import
 * on some live path, every kind would fall through to `registry-view.tsx`'s
 * "no renderer" diagnostic at runtime.
 *
 * T34A4 closed half of that gap: `PinnedLiveExtensionArea` (re-exported
 * below) is a real, tested mount point for the `pinned` slot. But nothing
 * in the app repo-wide constructed the two things it needs as props —
 * `elements: readonly PiUiElement[]` and an
 * `extensions.ExtensionActionController` — so mounting it still meant a
 * route inventing both as fakes. `createPiUiSession` below closes that:
 * it is *this file*, so calling it always pulls in the side-effecting
 * `import "./renderers"` above, in the same module evaluation — a screen
 * cannot hold a `PiUiSession` without renderer registration having
 * already run. See that function's doc comment for exactly what a router
 * task (T32S4, `apps/android/src/app-shell/`, off limits to this task)
 * must supply and read back.
 *
 * The pure unit tests in this directory import `./registry`,
 * `./registry-plan`, and `./registry-boundary-reset` directly, never this
 * barrel, so the React Native modules reached from here never enter a test
 * graph. `pi-ui-session.test.ts` is the one exception: it imports this
 * barrel deliberately (to prove the registration side effect actually
 * fires from `createPiUiSession`), so it mocks `react-native`/
 * `react-native-reanimated` the same way `registry-index.test.ts` does.
 */
import "./renderers";

import { extensions } from "@picompanion/frontend-core";
import type { Clock, TimerHandle } from "@picompanion/frontend-core";
import type { AgentStreamEvent } from "@picompanion/protocol/agent-types";
import type { AgentStreamEventPayload } from "@picompanion/protocol/messages";

/**
 * Minimal `Clock` (plan.md §7.3) backed by the ambient timer globals.
 * Mirrors `apps/android/src/features/sessions/session-resume-controller.ts`'s
 * `createSessionResumeClock` exactly, for the same reason that module gives
 * for not promoting it to a shared `apps/android/src/platform/` adapter: this
 * task's `Owns: apps/android/src/features/extensions/` grant does not cover
 * `platform/`, and a single ambient `Clock` used from two features is not
 * yet a strong enough reason to extract one. A later task can promote both
 * call sites to one shared adapter without changing either's public surface.
 */
export function createExtensionsClock(): Clock {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as TimerHandle,
    clearTimeout: (handle) => {
      clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    },
    setInterval: (callback, intervalMs) =>
      setInterval(callback, intervalMs) as unknown as TimerHandle,
    clearInterval: (handle) => {
      clearInterval(handle as unknown as ReturnType<typeof setInterval>);
    },
  };
}

/** Constructor options for `createPiUiSession`. */
export interface CreatePiUiSessionOptions {
  /**
   * Sends one `pi.ui.action.request` over the live daemon connection.
   * `frontend-core`'s `ExtensionActionController` takes the identical
   * callback (it owns no `DaemonClient` of its own, plan.md §7.3/§12.3) —
   * this only forwards it, so this module never grows a second wire
   * contract for the same request. The router task wires this to the
   * real connection; every test in this directory wires it to a fake.
   */
  sendRequest: (message: extensions.PiUiActionRequestMessage) => void;
  /** Defaults to `createExtensionsClock()`. Tests inject a fake `Clock`. */
  clock?: Clock;
  /** Forwarded to `ExtensionActionController`; defaults to its own 60s default. */
  timeoutMs?: number;
}

/**
 * One agent-independent Pi UI session: a `PiUiElementStore` (T21B) and an
 * `ExtensionActionController` (T21C), both from `@picompanion/frontend-core`
 * and neither redeclared here — this module only wires the two together for
 * Android and guarantees renderer registration alongside them. Both types
 * already handle every agent this client currently has state for (plan.md
 * §11.5's multi-agent posture), so one `PiUiSession` is enough for the
 * whole app; it does not need to be rebuilt per screen or per session.
 */
export interface PiUiSession {
  store: extensions.PiUiElementStore;
  actionController: extensions.ExtensionActionController;
}

/**
 * Builds the live element store and action controller a screen needs to
 * render Pi UI elements (plan.md §11.4/§12.3), and — by living in this
 * file — guarantees the `import "./renderers"` side effect above has run
 * by the time this returns, so a caller can never end up holding a store
 * with no renderers registered against it.
 *
 * The action controller's `getElementRevision` is bound to this same
 * store's `getRevision`, so a `SettledExtensionAction.staleRevision` this
 * controller reports is always relative to the exact store a renderer
 * reads its elements from — not a second, independently-constructed
 * store a caller might otherwise have wired in by mistake.
 *
 * **What a router (T32S4) must do with the result, per screen:**
 *
 * 1. construct exactly one `PiUiSession` for the app (e.g. alongside
 *    `AppCore`) and keep it for the process lifetime — not one per
 *    screen, per the multi-agent note on `PiUiSession` above;
 * 2. feed every `agent_stream` event the live connection delivers through
 *    `ingestPiUiAgentStreamEvent(session, agentId, event)` (below) —
 *    `agentId` is the outer envelope's, exactly as
 *    `ExtensionActionController.ingestAgentStreamEvent`'s own doc comment
 *    requires;
 * 3. on reconnect replay, apply the buffered/full-state batch the same
 *    way (`extensions.ingestPiUiReplayBatch(session.store, events)`
 *    covers the store half; `pi_ui_action_result` entries in that batch
 *    still need step 2's per-event call for the controller half);
 * 4. for one open agent's screen, read `session.store.getElements(agentId)`
 *    and `session.store.getRevision(agentId)` live (`store.subscribe`
 *    fires on every change) and pass them straight through to
 *    `PinnedLiveExtensionArea`'s `elements`/`revision` props, together
 *    with `agentId` and `session.actionController` unchanged.
 *
 * No other Pi UI wiring belongs to the router: everything from "which
 * elements are `pinned`" down to per-kind rendering, the unknown-kind/
 * oversized/no-renderer/invalid-payload/ok decision, and the dangerous-
 * action confirmation gate is already `PinnedLiveExtensionArea`'s and
 * `PiUiElementView`'s job.
 */
export function createPiUiSession(options: CreatePiUiSessionOptions): PiUiSession {
  const clock = options.clock ?? createExtensionsClock();
  const store = new extensions.PiUiElementStore();
  const actionController = new extensions.ExtensionActionController({
    clock,
    sendRequest: options.sendRequest,
    timeoutMs: options.timeoutMs,
    getElementRevision: (agentId) => store.getRevision(agentId),
  });
  return { store, actionController };
}

/**
 * Routes one `agent_stream` event into both halves of a `PiUiSession`.
 * `agentId` is the outer envelope's — required for the action-controller
 * half (a `pi_ui_action_result` payload carries no `agentId` of its own,
 * see `ExtensionActionController`'s doc comment); the store half reads
 * whatever agent identity the event itself carries (`pi_ui_delta.agentId`,
 * or `pi_ui_state.state.agentId`), exactly like `PiUiElementStore.ingestEvent`
 * already does on its own.
 *
 * Safe to call for every `agent_stream` event unconditionally: both
 * `ingestEvent` and `ingestAgentStreamEvent` no-op (return `null`) for any
 * event type they do not own, so this never needs an event-type filter at
 * the call site.
 */
export function ingestPiUiAgentStreamEvent(
  session: PiUiSession,
  agentId: string,
  event: AgentStreamEvent,
): void {
  session.store.ingestEvent(event);
  session.actionController.ingestAgentStreamEvent(agentId, event);
}

/**
 * One `agent_stream` message exactly as `@picompanion/client`'s
 * `DaemonClient.on("agent_stream", handler)` delivers it — `handler`
 * receives `{ payload: { agentId, event, ... } }`, and this type is that
 * inner `payload` (plus whatever `AgentStreamEventPayloadSchema` fields
 * ride along; only `agentId`/`event` are read here). Deliberately typed
 * against `AgentStreamEventPayload` (`@picompanion/protocol/messages` —
 * the wire-validated shape `DaemonClient` actually parses), not
 * `AgentStreamEvent` (`@picompanion/protocol/agent-types` —
 * `frontend-core`'s own shape): `apps/web/src/routes/root-route.tsx`'s
 * `PiExtensionRail` wiring documents these as independently declared,
 * structurally identical types for exactly this reason, and this type
 * keeps that cast (below) in one place instead of duplicating it at
 * every future call site.
 */
export interface PiUiAgentStreamMessage {
  agentId: string;
  event: AgentStreamEventPayload;
}

/**
 * `ingestPiUiAgentStreamEvent` (above), addressed at the exact payload
 * shape a live `DaemonClient.on("agent_stream", ...)` subscription
 * delivers (T34A6), so a router needs exactly one line to feed a real
 * connection into this session:
 *
 * ```ts
 * const unsubscribe = client.on("agent_stream", (message) =>
 *   ingestPiUiAgentStreamMessage(session, message.payload),
 * );
 * ```
 *
 * **This module still cannot make that call itself**, and it no longer
 * has to. Making it requires a live `DaemonClient` instance, which only
 * exists behind `connection.getActiveLifecycle()?.getDaemonClient()`, and
 * the one place holding both a `connection` and a `PiUiSession` together
 * is `AppCore` (`apps/android/src/app-shell/core.ts`).
 *
 * **T32S8 (P5-W12) made that call.** `core.ts`'s
 * `ensureAgentStreamSubscription` now runs exactly the subscription above
 * on whatever client `getActiveLifecycle()?.getDaemonClient()` returns,
 * re-attaching on every `connection` snapshot so a reconnect swaps the
 * subscription rather than leaving it stale, and routes every message
 * through `ingestPiUiAgentStreamMessage` unconditionally. So this store is
 * live-feedable in production today; what remains unproven is only that a
 * real daemon sends such a message on a device (T37E/T59).
 *
 * The transcript side of the same gap closed from the same subscription,
 * as this comment always said it would: `core.ts` fans the one wire
 * subscription out through `AppCore.subscribeAgentStream`, and
 * `SessionTranscript` (`apps/android/src/app/h/[serverId]/session/
 * [agentId]/index.tsx`) forwards each message to
 * `createTranscriptMessageBatcher`'s `push()`. One `on()` call serves both
 * consumers; neither was closed from inside `features/extensions/`.
 *
 * Proven in `agent-stream-feed.test.ts` against a scripted array of
 * fake wire messages (never a live `DaemonClient` or a socket): feeding
 * this function moves `session.store`'s elements and revision, and the
 * resulting element passes `resolvePiUiElementRenderDecision` as `"ok"`
 * and `selectPinnedElements`/`resolvePinnedAreaVisibility` as visible —
 * i.e. it would actually render through `PinnedLiveExtensionArea`'s
 * pipeline, not merely sit in the store unread. Real on-screen rendering
 * remains for T37 (Maestro) and T59 (real device), per this directory's
 * standing disclosure.
 *
 * **The outbound half of the round trip is wired too:**
 * `ExtensionActionController.dispatch` (invoked by a renderer's action
 * button, through `PiUiSession.actionController`) builds a schema-valid
 * `pi.ui.action.request` (`SessionInboundMessageSchema` in
 * `@picompanion/protocol/messages`) and hands it to this session's
 * `sendRequest`, which `core.ts` now forwards to `@picompanion/client`'s
 * `DaemonClient.sendPiUiAction`. The daemon's synchronous
 * `pi.ui.action.response` ack is routed back into
 * `ingestPiUiActionResponse` (below) from that same
 * `ensureAgentStreamSubscription`, so a dispatched action settles from
 * its real acknowledgment — or its async `pi_ui_action_result`, already
 * routed by `ingestPiUiAgentStreamMessage` above — rather than only from
 * the controller's timeout. A dispatch with no active connection still
 * honestly settles `"timeout"`, never a faked success.
 */
export function ingestPiUiAgentStreamMessage(
  session: PiUiSession,
  message: PiUiAgentStreamMessage,
): void {
  ingestPiUiAgentStreamEvent(
    session,
    message.agentId,
    message.event as unknown as AgentStreamEvent,
  );
}

/**
 * Routes one `pi.ui.action.response` (the daemon's synchronous ack for a
 * dispatched `pi.ui.action.request`) into a `PiUiSession`'s action
 * controller. `core.ts`'s `ensureAgentStreamSubscription` subscribes to
 * this wire type alongside `agent_stream` and calls this per message; the
 * controller's own `ingestActionResponse` decides whether the ack matches
 * a pending dispatch (`ok: false` settles it rejected, `ok: true` only
 * marks it routed).
 */
export function ingestPiUiActionResponse(
  session: PiUiSession,
  payload: extensions.PiUiActionResponsePayload,
): void {
  session.actionController.ingestActionResponse(payload);
}

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
} from "./registry";
export {
  resolvePiUiElementRenderDecision,
  type PiUiElementRenderDecision,
  type RegistryDiagnostic,
} from "./registry-plan";
export {
  shouldResetExtensionBoundary,
  type ExtensionElementBoundaryIdentity,
} from "./registry-boundary-reset";
export { ExtensionElementBoundary, type ExtensionElementBoundaryProps } from "./registry-boundary";
export {
  ExtensionDiagnostic,
  safeRawPreview,
  type ExtensionDiagnosticProps,
} from "./registry-diagnostic";
export {
  DangerousActionConfirmDialog,
  type DangerousActionConfirmDialogProps,
} from "./registry-confirm";
export { PiUiElementView, type PiUiElementViewProps } from "./registry-view";
export {
  PINNED_AREA_LAYOUT_CONTRACT,
  PINNED_AREA_MAX_HEIGHT_DP,
  resolvePinnedAreaVisibility,
  selectPinnedElements,
  type PinnedAreaLayoutContract,
  type PinnedAreaVisibility,
} from "./pinned-model";
export { selectInlineElements } from "./inline-model";
export {
  PinnedLiveExtensionArea,
  type PinnedLiveExtensionAreaProps,
} from "./pinned-live-extension-area";
export { usePiUiElements, type PiUiAgentElements } from "./use-pi-ui-elements";
