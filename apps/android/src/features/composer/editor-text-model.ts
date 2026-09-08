/**
 * Real wiring for Pi's `getEditorText`/`pasteToEditor` tier-2 bridge (T293,
 * plan.md §4.2 "Pi editor-text read bridge") over a `DaemonClient`-shaped
 * object, for the Android composer.
 *
 * RN-free by construction (no React Native, Expo, or DOM import — matches
 * this directory's `-model.ts` convention, e.g. `slash-command-model.ts`),
 * so it is tested directly rather than through a rendered component.
 *
 * Deliberately duplicated from `apps/web/src/features/composer/
 * daemon-editor-text-client.ts` rather than promoted into
 * `packages/frontend-core` — the two files are small (under 40 lines) and
 * behaviourally identical, but `packages/frontend-core` imports no React
 * Native, Expo, DOM types, or browser globals (a repository invariant),
 * and this pure logic has exactly TWO consumers today. Promoting a
 * two-consumer, sub-40-line module is an unscoped refactor this task does
 * not need; the day a THIRD platform needs the identical wiring is the
 * time to argue moving it, the same call `slash-command-model.ts`'s own
 * module doc makes for reproducing web's hook behaviour here rather than
 * sharing it.
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
   * the same reason `slash-command-model.ts`'s `DaemonSlashCommandSource`
   * shape follows this convention: TypeScript does not substitute a
   * generic source overload's type parameter against a non-generic target
   * parameter type, so a plain literal parameter here would make every
   * real `DaemonClient` fail this interface even though it satisfies it
   * at runtime.
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
