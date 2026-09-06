import { useMemo } from "react";
import { useLocalSearchParams } from "expo-router";

import { TerminalScreen } from "../../../../../../features/terminal";
import { useAppCore } from "../../../../../core-context";

/**
 * `/h/:serverId/session/:agentId/terminal/:terminalId` — the "terminal"
 * Phase 5 feature family's route stub — T32S1C.
 *
 * Matches `navigationIntentToPath({ type: "sessionTerminal", serverId,
 * agentId, terminalId })` exactly. Imports its screen from
 * `apps/android/src/features/terminal/` rather than containing any
 * feature logic itself, so T35B1 replaces `TerminalScreen`'s body
 * without ever touching this file.
 *
 * **T32S12 mount (P5-W18)**: `transport` used to be omitted, so
 * `TerminalScreen` always fell back to its own
 * `createNotConnectedTerminalBinaryTransport()` — a real, honest, but
 * permanently-closed stand-in — no matter how healthy the daemon
 * connection was. This route now builds a real one from `AppCore`
 * (`useAppCore().createTerminalTransport`, `../../../../../
 * app-shell/terminal-transport-adapter.ts`), memoized on
 * `[core, terminalId]` so remounting with the same terminal id does not
 * reopen a fresh daemon session on every render. `slot` is fixed at `0`
 * — this screen owns exactly one terminal, matching
 * `TerminalScreenProps.slot`'s own documented default.
 *
 * **T80 mount (P5-W23)**: `webview` used to be omitted too, so
 * `TerminalScreen` always fell back to its own
 * `createUnavailableTerminalWebViewPort()` regardless of what `AppCore`
 * held — the terminal route reported "unavailable" for two independent
 * reasons at once (no `react-native-webview` install, *and* no prop
 * wiring even if one existed). This route now passes
 * `core.terminalWebview` (`../../../../../app-shell/core.ts`), the same
 * "read the field straight off `AppCore`" shape `transport` above uses.
 * `react-native-webview` is still not installed in this workspace, so
 * `core.terminalWebview` is still `createUnavailableTerminalWebViewPort()`
 * today and `TerminalScreen` still renders its named "Terminal
 * unavailable" empty state — see `AppCore["terminalWebview"]`'s doc
 * comment for exactly what installing the package and swapping that one
 * construction would change, with no further edit needed here.
 */
export default function SessionTerminalRoute() {
  const { serverId, agentId, terminalId } = useLocalSearchParams<{
    serverId: string;
    agentId: string;
    terminalId: string;
  }>();
  const core = useAppCore();
  const transport = useMemo(
    () => core.createTerminalTransport(terminalId ?? "", 0),
    [core, terminalId],
  );
  return (
    <TerminalScreen
      serverId={serverId}
      agentId={agentId}
      terminalId={terminalId}
      transport={transport}
      webview={core.terminalWebview}
    />
  );
}
