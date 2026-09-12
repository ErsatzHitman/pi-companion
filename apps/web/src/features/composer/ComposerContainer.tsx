import { useCore } from "../../app/core-context.js";
import { Composer } from "./Composer.js";
import type { AgentTurnClient } from "./agent-turn-client.js";
import type { DaemonEditorTextSource } from "./daemon-editor-text-client.js";
import { composer as coreComposer } from "@picompanion/frontend-core";
import type { telemetry as coreTelemetry } from "@picompanion/frontend-core";

export interface ComposerContainerProps {
  /** Conversation target this composer submits into (session or agent id). */
  sessionId: string;
  /**
   * The daemon/server `sessionId` lives on (T389) — half of the per-session
   * draft key. Optional so a fixture-only mount can omit it; the route
   * always has one from its own URL params.
   */
  serverId?: string;
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
  /**
   * This session's derived context-window telemetry for the composer's
   * context ring (T386) — see `Composer`'s own doc comment on this prop.
   * The route computes it through `useSessionContextTelemetry`; omitting it
   * renders the ring's honest "not reported" state.
   */
  contextTelemetry?: coreTelemetry.ContextWindowTelemetry;
  /**
   * T389: `@file` candidate listing for this session, built by the route
   * from the connected daemon's own `listDirectory`. Omitted when there is
   * no connection; the `@` list then offers only skills.
   */
  fileReferenceSource?: coreComposer.ReferenceFileSource;
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
export function ComposerContainer({
  sessionId,
  serverId,
  client,
  editorTextClient,
  contextTelemetry,
  fileReferenceSource,
}: ComposerContainerProps) {
  const { platform } = useCore();
  return (
    <Composer
      sessionId={sessionId}
      serverId={serverId}
      clock={platform.clock}
      structuredStorage={platform.structuredStorage}
      filePicker={platform.filePicker}
      client={client}
      editorTextClient={editorTextClient}
      contextTelemetry={contextTelemetry}
      fileReferenceSource={fileReferenceSource}
    />
  );
}

export default ComposerContainer;
