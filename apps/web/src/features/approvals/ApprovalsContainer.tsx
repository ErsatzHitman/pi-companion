import { useEffect, useMemo } from "react";

import { actions, permissions } from "@picompanion/frontend-core";

import { useCore } from "../../app/core-context.js";
import { ApprovalsHost } from "./ApprovalsHost.js";
import {
  wirePermissionsController,
  wireRequestArbitrator,
  type DaemonPermissionsSource,
} from "./daemon-permissions-client.js";
import { useApprovalsQueue } from "./use-approvals-queue.js";

export interface ApprovalsContainerProps {
  /** Conversation this approvals surface answers for, matching `ComposerContainer`'s `sessionId` prop. */
  sessionId: string;
  /**
   * Live turn-control client. Defaults to `undefined`: this app has no
   * route that can obtain a live `DaemonClient` yet — the same "no live
   * client yet" state `ComposerContainer`'s own doc comment documents in
   * full for `AgentTurnClient`. Once a real one lands, its
   * `respondToPermission`/`on("agent_permission_request" | "agent_permission_resolved", ...)`
   * already satisfy `DaemonPermissionsSource` as-is —
   * `daemon-permissions-client.fixture.test.ts` proves the real wire
   * round trip today, independent of when this prop gets wired.
   */
  client?: DaemonPermissionsSource;
}

/**
 * Wires the approvals surface (T28B7) to this app's real `platform.clock`
 * (`useCore()`, `apps/web/src/platform`) and, once available, a live
 * `client`. Kept separate from the route screen file, mirroring
 * `features/composer/ComposerContainer.tsx`'s "only place that reaches
 * into `useCore()`" convention, so `ApprovalsHost`/`PermissionDialog`/
 * `useApprovalsQueue` stay platform-agnostic beyond the narrow `Clock`/
 * `DaemonPermissionsSource` interfaces they already accept.
 *
 * Owns the one `PermissionsController` instance for this session: built
 * once via `useMemo`, disposed on unmount (clears any scheduled
 * timeouts — none are scheduled today, since no `defaultTimeoutMs` is
 * passed; see `use-approvals-queue.ts`'s header for why inventing a
 * client-side deadline here would be guessing at a value Pi's own
 * protocol does not specify), and re-wired to `client` whenever either
 * changes.
 *
 * Also owns one `RequestArbitrator` (T47A1a, reached through
 * `@picompanion/frontend-core`'s `actions` namespace per T103) alongside
 * `controller`, fed the identical live message stream via
 * `wireRequestArbitrator` — see that function's own doc comment. This is
 * this arbitrator's first production consumer: T47A2 wires it into the
 * approvals dialog so a request contested or superseded by another
 * connected client closes with a readable explanation (`useApprovalsQueue`'s
 * `notice`) instead of silently vanishing (plan.md §12.3).
 */
export function ApprovalsContainer({ sessionId, client }: ApprovalsContainerProps) {
  const { platform } = useCore();

  const controller = useMemo(
    () => new permissions.PermissionsController({ clock: platform.clock }),
    [platform.clock],
  );
  const arbitrator = useMemo(
    () =>
      new actions.RequestArbitrator<permissions.AgentPermissionResponse>({ clock: platform.clock }),
    [platform.clock],
  );

  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => () => arbitrator.dispose(), [arbitrator]);

  useEffect(() => {
    if (!client) return;
    return wirePermissionsController(controller, client);
  }, [client, controller]);

  useEffect(() => {
    if (!client) return;
    return wireRequestArbitrator(arbitrator, client);
  }, [client, arbitrator]);

  const queue = useApprovalsQueue({ controller, sessionId, client, arbitrator });

  return (
    <ApprovalsHost
      current={queue.current}
      waitingCount={queue.waitingCount}
      error={queue.error}
      onAnswer={queue.respond}
      onDismissError={queue.dismissError}
      notice={queue.notice}
      onDismissNotice={queue.dismissNotice}
      testId="approvals-dialog"
    />
  );
}

export default ApprovalsContainer;
