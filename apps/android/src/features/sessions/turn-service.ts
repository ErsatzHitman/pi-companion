/**
 * A real `TurnService` (T63; `composer-model.ts:115` — that file is
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
 * four today. What is still missing is the CLIENT half:
 * `@picompanion/client`'s `DaemonClient` has no method that sends any of
 * the three new request types and its `sendAgentMessage` accepts no
 * `streamingBehavior` option (verified: zero occurrences of
 * `set_steering_mode_request`/`get_queue_modes_request` anywhere under
 * `packages/client/src`), which is T38B1a's job. `pi_queue_update`
 * remains a read-only server->client push of `{ steering, followUp }`,
 * never a settable mode. So, until the client half lands:
 *   - `steer` and `followUp` below both delegate to the same
 *     `sendMessage` call, matching the protocol exactly as it exists
 *     today (not a shortcut this module invented).
 *   - `setMode` always rejects with `UnsupportedDispatchModeChangeError`
 *     rather than resolving as if it had done something — `Composer.tsx`
 *     already reverts its optimistic mode change on any rejection
 *     (`revertDispatchMode`), so this fails safely into the exact
 *     behavior that path was built for, never a silent no-op.
 *
 * Nothing here opens a socket or talks to port 6767/6768 — this module
 * only shapes calls onto whatever `DaemonTurnTransport` it is handed.
 * `turn-service.test.ts` proves it end-to-end against an in-memory fake
 * (`FakeIsolatedDaemon`), never a real connection.
 */
import type { QueueDispatchMode, TurnService } from "../composer/index.js";

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` a real
 * turn needs. `DaemonClient.sendMessage` (`packages/client/src/
 * daemon-client.ts:3099`) and `DaemonClient.cancelAgent` (`:3159`) are
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
 * call is even attempted.
 */
export class UnsupportedDispatchModeChangeError extends Error {
  readonly mode: QueueDispatchMode;

  constructor(mode: QueueDispatchMode) {
    super(
      `setMode("${mode}") is not supported: no client method sends a ` +
        "per-message steer/follow-up choice yet. T38B0a added the wire types " +
        "(packages/protocol/src/messages.ts: send_agent_message's optional " +
        "streamingBehavior, plus set_steering_mode/set_follow_up_mode), and " +
        "T38B0b/T38B0c wired the daemon side (packages/server's Session now " +
        "handles all three requests and forwards streamingBehavior), but " +
        "@picompanion/client's DaemonClient still exposes no method that " +
        "sends any of them — T38B1a. Until then this rejects rather than " +
        "silently succeeding (T63's original seam).",
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
