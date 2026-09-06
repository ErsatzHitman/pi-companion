import { useCore } from "../../app/core-context.js";
import { Composer } from "./Composer.js";
import type { AgentTurnClient } from "./agent-turn-client.js";

export interface ComposerContainerProps {
  /** Conversation target this composer submits into (session or agent id). */
  sessionId: string;
  /**
   * Live turn-control client (T28B2/T28B3). Defaults to `undefined`:
   * this app has no route that can obtain a live `DaemonClient` yet
   * (`useCore()`'s `connection` is `fake-core-adapter.ts`'s stand-in
   * until a real one lands — the same "no live client yet" state
   * `TerminalRoute` and `FileBrowserScreen` already document). Once a
   * real one exists, its `createDaemonAgentTurnClient` adapter
   * (`daemon-agent-turn-client.ts`) is what this prop should be built
   * from — that adapter and its fixture test already prove the real
   * wire round trip today, independent of when this prop gets wired.
   */
  client?: AgentTurnClient;
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
export function ComposerContainer({ sessionId, client }: ComposerContainerProps) {
  const { platform } = useCore();
  return (
    <Composer
      sessionId={sessionId}
      clock={platform.clock}
      structuredStorage={platform.structuredStorage}
      filePicker={platform.filePicker}
      client={client}
    />
  );
}

export default ComposerContainer;
