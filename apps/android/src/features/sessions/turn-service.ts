/**
 * A real `TurnService` (T63; the `TurnService` interface declared in
 * `composer-model.ts` — that file is
 * unowned this wave, read but not edited) over the narrowest possible
 * slice of `@picompanion/client`'s `DaemonClient`, following the exact
 * narrow-adapter convention `features/approvals/daemon-permissions-
 * client.ts`'s `DaemonPermissionsSource` already established for this
 * app: depend only on the methods actually called, so a real
 * `DaemonClient` (already reachable in production via
 * `core.connection.getActiveLifecycle()?.getDaemonClient()`, see
 * `app-shell/core.ts`) satisfies `DaemonTurnTransport` as-is, no
 * adapter class required.
 *
 * PROTOCOL GAP (this task's finding, not a defect of this module —
 * see this task's report for the exact seam): `packages/protocol/src/
 * messages.ts` has exactly one outbound "send text to an agent" wire
 * message, `send_agent_message_request` (`DaemonClient.sendMessage`/
 * `sendAgentMessage`). It is used identically for starting a brand-new
 * turn, steering a running one, and queuing a follow-up — the
 * difference is entirely server-side, based on whether the named agent
 * already has a turn in flight. No wire message this module can call
 * changes the queue-dispatch mode yet. T38B0a (P6-W1) added the wire
 * TYPES — `send_agent_message`'s optional `streamingBehavior`, plus
 * `set_steering_mode_request`/`set_follow_up_mode_request`/
 * `get_queue_modes_request` in `packages/protocol/src/messages.ts`.
 * P6-W3 UPDATE: the DAEMON half is now wired — T38B0b mirrors Pi's
 * `set_steering_mode`/`set_follow_up_mode` RPC commands and T38B0c added
 * the three `Session` handlers plus `streamingBehavior` forwarding
 * (`packages/server/src/server/session.ts`), so the daemon DOES read all
 * four today. The CLIENT half has since landed as well: `DaemonClient`
 * exposes `setSteeringMode`/`setFollowUpMode`/`getQueueModes` (T110)
 * and `sendMessage`/`sendAgentMessage` accept a per-message
 * `streamingBehavior` routing flag (T38B1b) — but neither covers THIS
 * call. The session-wide modes are delivery settings (`"all"` vs
 * `"one-at-a-time"`), a different setting from the per-message dispatch
 * default `setMode` changes (see `queue-mode-model.ts`'s own doc
 * comment), and the per-message flag routes one send without persisting
 * a default. `pi_queue_update`
 * remains a read-only server->client push of `{ steering, followUp }`,
 * never a settable mode. So:
 *   - `steer` and `followUp` below both delegate to the same
 *     `sendMessage` call, matching the protocol exactly as it exists
 *     today (not a shortcut this module invented).
 *   - `setMode` always rejects with `UnsupportedDispatchModeChangeError`
 *     rather than resolving as if it had done something — `Composer.tsx`
 *     already reverts its optimistic mode change on any rejection
 *     (`revertDispatchMode`), so this fails safely into the exact
 *     behavior that path was built for, never a silent no-op. The
 *     error's own text carries the retry affordance (safe to re-pick
 *     the mode at any time).
 *
 * Nothing here opens a socket or talks to port 6767/6768 — this module
 * only shapes calls onto whatever `DaemonTurnTransport` it is handed.
 * `turn-service.test.ts` proves it end-to-end against an in-memory fake
 * (`FakeIsolatedDaemon`), never a real connection.
 */
import type { QueueDispatchMode, TurnService } from "../composer/index.js";

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` a real
 * turn needs. `DaemonClient.sendMessage` and `DaemonClient.cancelAgent`
 * (both in `packages/client/src/daemon-client.ts`) are
 * both already public instance methods there, so a real `DaemonClient`
 * satisfies this interface structurally with no wrapper.
 */
export interface DaemonTurnTransport {
  sendMessage(agentId: string, text: string, options?: { messageId?: string }): Promise<void>;
  cancelAgent(agentId: string): Promise<void>;
}

/**
 * Thrown (as a rejected promise, never a thrown-past-caller exception —
 * `TurnService.setMode` is declared `Promise<void>`) when `setMode` is
 * called. Named so a caller/log can tell this apart from a genuine
 * transport failure — see this module's doc comment for why no wire
 * call is even attempted, and the message's own closing sentences for
 * the retry affordance (safe to re-pick the mode at any time).
 */
export class UnsupportedDispatchModeChangeError extends Error {
  readonly mode: QueueDispatchMode;

  constructor(mode: QueueDispatchMode) {
    super(
      `setMode("${mode}") is not supported: the dispatch default has ` +
        "no wire representation yet. The session-wide delivery modes " +
        '(`DaemonClient.setSteeringMode`/`setFollowUpMode`, `"all"` vs ' +
        '`"one-at-a-time"`) are a different setting from this per-message ' +
        "default (see `queue-mode-model.ts`), and the per-message " +
        "`streamingBehavior` flag on `sendMessage` routes one send without " +
        "persisting a default — so neither gives this call anything to " +
        "send. This rejects rather than silently succeeding (T63's original " +
        "seam). Safe to retry at any time: the composer already reverted " +
        "to the previous mode, neither queue was disturbed, and explicit " +
        "steer / follow-up sends still work — re-pick the mode to try again.",
    );
    this.name = "UnsupportedDispatchModeChangeError";
    this.mode = mode;
  }
}

/**
 * Builds a real `TurnService` for one agent, over `daemon`. Every
 * method settles only once `daemon`'s own call settles — nothing here
 * resolves optimistically ahead of the transport, matching
 * `composer-model.ts`'s documented contract for this interface.
 */
export function createDaemonTurnService(agentId: string, daemon: DaemonTurnTransport): TurnService {
  return {
    steer: (text: string) => daemon.sendMessage(agentId, text),
    followUp: (text: string) => daemon.sendMessage(agentId, text),
    abort: () => daemon.cancelAgent(agentId),
    setMode: (mode: QueueDispatchMode) =>
      Promise.reject(new UnsupportedDispatchModeChangeError(mode)),
  };
}

/**
 * Named outcome of attempting to start a brand-new turn — the very
 * first message to an idle agent. This is deliberately *not* part of
 * `TurnService`: `composer-model.ts`'s `submitDraft` doc comment is
 * explicit that starting a new turn goes through the composer's
 * `onSubmit` prop, not `TurnService` (`Composer.tsx`'s `handleSend`
 * calls `onSubmit`, never `turnService.*`). On the wire it is the exact
 * same `sendMessage` call as `steer`/`followUp` above (see this
 * module's doc comment on the protocol gap) — this function exists so
 * that call site (wherever `onSubmit` is wired — currently nowhere in
 * production, see this task's report) has one named, non-throwing
 * result shape to react to, the same "a failure is a value, not an
 * exception that skips app state" discipline `SessionOpenResult`
 * (`sessions-model.ts`) already uses for opening a session.
 */
export type TurnStartResult =
  | { status: "started" }
  | { status: "failed"; reason: "transport-error"; message: string };

/**
 * Attempts to start a turn by sending `text` to `agentId` over
 * `daemon`. Never throws: a transport rejection (including an
 * unauthorized/credential-rejected connection — see this task's report
 * for why authentication itself is out of this module's scope) comes
 * back as `{ status: "failed", ... }`, never a silent no-op and never
 * an unhandled rejection a caller could forget to catch.
 */
export async function startDaemonTurn(
  agentId: string,
  text: string,
  daemon: DaemonTurnTransport,
): Promise<TurnStartResult> {
  try {
    await daemon.sendMessage(agentId, text);
    return { status: "started" };
  } catch (error) {
    return {
      status: "failed",
      reason: "transport-error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
