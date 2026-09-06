import { DAEMON_APP_VERSION, WEB_DAEMON_CLIENT_ID } from "../../app/daemon-client-context.js";
import { DiagnosticsScreen } from "../../features/diagnostics/index.js";

/**
 * `/h/:serverId/diagnostics` screen body (T41B1). Thin route wrapper
 * around `features/diagnostics/DiagnosticsScreen`, matching every other
 * `host-*-screen.tsx` in this directory (`host-sessions-screen.tsx`,
 * `host-settings-screen.tsx`): the feature owns its own client wiring
 * (`useDiagnosticsSnapshot` reads `useDaemonClientContext()` directly),
 * so this file only supplies the real, named `appVersion`/`clientId`
 * this app declares to the daemon on every `hello`
 * (`daemon-client-context.tsx`'s exported constants) and a stable test id.
 *
 * Does not read `serverId` from the route: every value this screen shows
 * describes "the one connection this app has open" — there is exactly
 * one live `HostController`/`DaemonClient` per app instance today (see
 * `daemon-client-context.tsx`) — not anything actually scoped by
 * `serverId`, so reading an unused param here would be decorative.
 */
export function HostDiagnosticsScreen() {
  return (
    <DiagnosticsScreen
      appVersion={DAEMON_APP_VERSION}
      clientId={WEB_DAEMON_CLIENT_ID}
      testId="host-diagnostics"
    />
  );
}

export default HostDiagnosticsScreen;
