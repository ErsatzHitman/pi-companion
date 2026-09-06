import { useLocalSearchParams } from "expo-router";

import { ANDROID_DAEMON_APP_VERSION, ANDROID_DAEMON_CLIENT_ID } from "../../../app-shell/core";
import { DiagnosticsScreen } from "../../../features/diagnostics";
import type { DiagnosticsDaemonClient } from "../../../features/diagnostics";
import { useAppCore, useColdStartProfile } from "../../core-context";

/**
 * `/h/:serverId/diagnostics` — mounts the real `DiagnosticsScreen` T42A3
 * built. Same path web serves it at (`apps/web/src/routes/host-diagnostics.tsx`),
 * and the same shape as this app's other feature routes
 * (`(tabs)/settings.tsx`): the route supplies real adapters off
 * `useAppCore()` and owns nothing else.
 *
 * T42A3's `Owns` grant was `features/diagnostics/` only, so it could not
 * add this file, and it disclosed the gap in `DiagnosticsScreen.tsx`'s own
 * docstring. The P7-W7 merge gate added this route: without it the four
 * modules under `features/diagnostics/` had no importer at all, which took
 * the repository's committed import-graph orphan ceiling from 27 to 30 and
 * turned `main` red on run `34029733785`. An unreachable screen is not a
 * shipped screen.
 *
 * Not placed under `(tabs)/`: diagnostics is not a tab. There is no
 * `{ type: "diagnostics" }` navigation intent in `app-shell/host-tabs.ts`'s
 * model, exactly as on web, so this is a plain path route reached directly
 * rather than through `destinationHref()`.
 *
 * Dependency notes, each one a real adapter and never a fake:
 *
 * - `connectionSource` is `core.connection` itself. `DaemonConnectionStore`
 *   already exposes the `getSnapshot()`/`subscribe()` pair
 *   `DiagnosticsConnectionSource` asks for, and `DaemonConnectionSnapshot`
 *   carries every field `DiagnosticsConnectionSnapshot` names (plus its own
 *   `error`), so this is a structural fit, not an adapter object.
 * - `getDaemonClient` re-reads `getActiveLifecycle()` on every call rather
 *   than closing over one client, because a reconnect swaps in a new
 *   instance — the same fresh-read rule
 *   `session/[agentId]/index.tsx` already follows. The `as unknown as`
 *   narrows for the one member (`on`) that
 *   `connection.DaemonClientLike` does not declare while the real
 *   production `DaemonClient` does — `use-diagnostics-snapshot.ts`'s
 *   own docstring predicted this exact cast, and it is the same pattern
 *   `app-shell/core.ts`'s `AgentStreamCapableClient` already uses for an
 *   identical reason. `getLastServerInfoMessage` is real on
 *   `packages/client/src/daemon-client.ts`; the cast documents the
 *   interface gap, it does not invent a capability.
 * - `profile` is the resolved cold-start `HostProfileRecord`, which carries
 *   the `label`/`endpoint` pair `DiagnosticsHostProfile` names. `null`
 *   before any profile is stored, which the screen renders as "not
 *   connected" rather than as an error.
 * - `sharing` is the real `Sharing` platform implementation, so the export
 *   control renders. Omitting it would render the screen with no export
 *   affordance at all, which is the wrong branch when a real one exists.
 *
 * `serverId` is read but otherwise unused, matching `(tabs)/settings.tsx`:
 * every value this screen shows describes the one connection this app has
 * open, not anything scoped by host. Reading it proves the route resolved.
 */
export default function DiagnosticsRoute() {
  useLocalSearchParams<{ serverId: string }>();
  const core = useAppCore();
  const profile = useColdStartProfile();
  return (
    <DiagnosticsScreen
      appVersion={ANDROID_DAEMON_APP_VERSION}
      clientId={ANDROID_DAEMON_CLIENT_ID}
      connectionSource={core.connection}
      profile={profile}
      getDaemonClient={() =>
        (core.connection.getActiveLifecycle()?.getDaemonClient() as unknown as
          | DiagnosticsDaemonClient
          | undefined) ?? null
      }
      sharing={core.sharing}
      testId="host-diagnostics"
    />
  );
}
