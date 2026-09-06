import type { PiRuntimeSession } from "../runtime.js";
import type { PiUiStateStore } from "./state.js";

const PI_UI_EVENT_COMMAND = "pi_ui_event";

export class PiUiActionRouter {
  constructor(
    private readonly runtimeSession: PiRuntimeSession,
    private readonly stateStore: PiUiStateStore,
  ) {}

  /**
   * Maps an incoming `pi.ui.action.request` to `prompt("/pi_ui_event <b64>")`,
   * the same pattern as `/paseo_tree`.
   *
   * Routing resolves the composite element identity (`ns:id[#rowId]`) against
   * daemon state first (plan.md §4.2): an unknown, ambiguous, or bare-and-
   * ambiguous element id is refused instead of being dispatched, so a tap can
   * never land in another extension's namespace.
   */
  async handleActionRequest(input: {
    agentId: string;
    elementId: string;
    actionId: string;
    payload?: unknown;
    value?: unknown;
    requestId: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const resolution = this.stateStore.resolveActionTarget(input.agentId, {
      elementId: input.elementId,
      actionId: input.actionId,
    });
    if (!resolution.ok) {
      return { ok: false, error: resolution.error };
    }

    const envelope = this.stateStore.buildActionEnvelope({
      target: resolution.target,
      value: input.payload ?? input.value,
      requestId: input.requestId,
    });
    const b64 = Buffer.from(JSON.stringify(envelope)).toString("base64url");
    try {
      await this.runtimeSession.prompt(`/${PI_UI_EVENT_COMMAND} ${b64}`);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  /**
   * Handle pi.ui.subscribe.request by sending full PiUiState for each agentId
   */
  handleSubscribeRequest(input: { agentIds: string[]; requestId: string }): void {
    // Emit full state via the state store's agent_stream path; clients subscribed to agent_stream will receive it.
    // The caller (Session) is responsible for sending the RPC response envelope if needed.
    this.stateStore.handleSubscribe(input.agentIds);
  }
}
