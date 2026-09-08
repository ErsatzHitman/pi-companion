/**
 * Real wiring for Pi's `getEditorText`/`pasteToEditor` tier-2 bridge (T293,
 * plan.md §4.2 "Pi editor-text read bridge") over a `DaemonClient`-shaped
 * object.
 *
 * Mirrors `features/approvals/daemon-permissions-client.ts`'s narrow-
 * adapter convention exactly: this module only depends on the slice of
 * `@picompanion/client`'s `DaemonClient` it actually calls
 * (`respondToEditorText`, `on("agent_editor_text_request", ...)`), so it
 * never has to import `@picompanion/client` to stay structurally
 * compatible with it — a real `DaemonClient` satisfies
 * `DaemonEditorTextSource` as-is.
 *
 * Unlike a permission request, `agent_editor_text_request` carries no
 * visible dialog on any client — there is nothing for a user to answer.
 * `wireEditorTextResponder` below always answers with whatever
 * `getDraftText()` returns AT THE MOMENT the request arrives, for the
 * `agentId` this composer instance owns; a request naming a different
 * `agentId` (a different open session/tab) is left alone so some other
 * mounted composer can answer it instead.
 */

/** Raw `agent_editor_text_request` wire message shape this adapter reads. */
export interface DaemonEditorTextRequestMessage {
  type: "agent_editor_text_request";
  payload: {
    agentId: string;
    requestId: string;
  };
}

/**
 * The narrowest slice of `@picompanion/client`'s `DaemonClient` this
 * adapter needs. A real `DaemonClient` satisfies this as-is.
 */
export interface DaemonEditorTextSource {
  /** Matches `DaemonClient.respondToEditorText(agentId, requestId, text)`. */
  respondToEditorText(agentId: string, requestId: string, text: string): Promise<void>;
  /**
   * `type` is generic (rather than a plain string-literal parameter) for
   * the same reason `daemon-permissions-client.ts`'s `on` is: TypeScript
   * does not substitute a generic source overload's type parameter
   * against a non-generic target parameter type, so a plain literal
   * parameter here would make every real `DaemonClient` fail this
   * interface even though it satisfies it at runtime.
   */
  on<TType extends "agent_editor_text_request">(
    type: TType,
    handler: (message: DaemonEditorTextRequestMessage) => void,
  ): () => void;
}

/**
 * Subscribes to every live `agent_editor_text_request` push from `daemon`
 * and answers the ones naming `agentId` with `getDraftText()`'s CURRENT
 * value, read fresh on every request rather than captured once at wire
 * time — the composer's draft can change between when this is wired and
 * when Pi asks for it. Returns an unsubscribe function.
 *
 * A `respondToEditorText` rejection (the connection dropped mid-flight) is
 * swallowed, not surfaced: the extension already has its own bounded
 * timeout on the daemon side (`EDITOR_TEXT_REQUEST_TIMEOUT_MS`,
 * `packages/server/src/server/agent/providers/pi/agent.ts`) for exactly
 * this case, and there is no dialog on this client to show an error in
 * anyway.
 */
export function wireEditorTextResponder(
  daemon: DaemonEditorTextSource,
  options: { agentId: string; getDraftText: () => string },
): () => void {
  return daemon.on("agent_editor_text_request", (message) => {
    if (message.payload.agentId !== options.agentId) {
      return;
    }
    void daemon
      .respondToEditorText(options.agentId, message.payload.requestId, options.getDraftText())
      .catch(() => {
        // See module doc: the daemon's own timeout covers a dropped answer.
      });
  });
}
