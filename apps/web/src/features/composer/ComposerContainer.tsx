import { useCore } from "../../app/core-context.js";
import { Composer } from "./Composer.js";
import type { AgentTurnClient } from "./agent-turn-client.js";
import type { DaemonEditorTextSource } from "./daemon-editor-text-client.js";

export interface ComposerContainerProps {
  /** Conversation target this composer submits into (session or agent id). */
  sessionId: string;
  /**
   * Live turn-control client (T28B2/T28B3). `undefined` on a route with no
   * live `DaemonClient` connected yet — the same "no live client yet"
   * state `TerminalRoute` and `FileBrowserScreen` already document.
   * `routes/screens/host-session-screen.tsx` builds this from a real
   * `DaemonClient` via `createDaemonAgentTurnClient`
   * (`daemon-agent-turn-client.ts`) once one is connected.
   */
  client?: AgentTurnClient;
  /**
   * T293: real `DaemonClient` wiring for Pi's `getEditorText`/
   * `pasteToEditor` tier-2 read bridge — see `Composer`'s own doc comment
   * on this same prop name for what it does and its "no live client yet"
   * degradation. A real `DaemonClient` satisfies `DaemonEditorTextSource`
   * as-is (`daemon-editor-text-client.ts`'s own doc comment), so callers
   * can pass one directly.
   */
  editorTextClient?: DaemonEditorTextSource;
}

/**
 * Wires `Composer` to this app's real `platform.clock`/
 * `platform.structuredStorage` (`useCore()`, `apps/web/src/platform`) so
 * every mounted composer durably records its outbox through the same
 * real browser storage the rest of the app uses (plan.md §8.3) — not a
 * test double. Kept separate from the route screen file, mirroring
 * `features/connect/ConnectFormContainer.tsx`'s "only place that reaches
 * into `useCore()`" convention, so `Composer`/`useComposer` themselves
 * stay framework/platform-agnostic beyond the narrow `Clock`/
 * `StructuredStorage`/`FilePicker` interfaces they already accept.
 * `platform.filePicker` (T28B6, plan.md §7.3) is this app's real
 * `createBrowserFilePicker()` adapter (`apps/web/src/platform/file-picker.ts`).
 */
export function ComposerContainer({ sessionId, client, editorTextClient }: ComposerContainerProps) {
  const { platform } = useCore();
  return (
    <Composer
      sessionId={sessionId}
      clock={platform.clock}
      structuredStorage={platform.structuredStorage}
      filePicker={platform.filePicker}
      client={client}
      editorTextClient={editorTextClient}
    />
  );
}

export default ComposerContainer;
