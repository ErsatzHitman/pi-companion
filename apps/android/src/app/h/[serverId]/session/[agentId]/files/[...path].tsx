import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { resolveAgentSnapshotClient } from "../../../../../../app-shell/session-route-daemon-clients";
import { buildDaemonHttpOrigin } from "../../../../../../features/connect/daemon-connection-store.js";
import { useConnectionStatus } from "../../../../../../features/connect";
import { FilesScreen } from "../../../../../../features/files";
import { useAgentCwd } from "../../../../../../features/transcript";
import { createFetchDownload } from "../../../../../../platform/file-download-fetch.js";
import { useAppCore } from "../../../../../core-context";

/**
 * `/h/:serverId/session/:agentId/files/*` — the "files" Phase 5 feature
 * family's route stub — T32S1C, wired to a real `FileBrowserClient` and
 * `workspaceRoot` by T32S4.
 *
 * Matches `navigationIntentToPath({ type: "sessionFiles", serverId,
 * agentId, path })` exactly: `frontend-core`'s renderer joins `path`
 * with `/` under this same `files/` segment, and Expo Router's
 * `[...path]` catch-all is the file-based-routing equivalent — `path`
 * arrives as a `string[]` (empty at the bare `files/` root) either way.
 * Imports its screen from `apps/android/src/features/files/` rather than
 * containing any feature logic itself, so T35A2 replaces `FilesScreen`'s
 * body without ever touching this file.
 *
 * **T32S4's fix**: until now this route passed no `client`, so
 * `FilesScreen`'s "Not connected" `ErrorState` rendered permanently
 * regardless of any real connection — the exact defect this task's brief
 * names. `client` is now `AppCore.fileBrowserClient`
 * (`../../../../../app-shell/core.ts`), the same "always a real, stable
 * object; every method reads the live connection fresh" adapter
 * `AppCore.sessionService` already established — never a client
 * constructed in this route file.
 *
 * **Workspace root (2026-09-12).** `workspaceRoot` used to be the literal
 * `""`, which sent every listing to the daemon with an empty `cwd` and
 * made the daemon's own `"cwd is required"` guard reject it before it
 * touched a single path — no directory listing could ever succeed through
 * this route, no matter how real or healthy the connection was. It is now
 * the session's real daemon-side workspace root, resolved through the
 * existing `AgentSnapshotSource` seam: `useAgentCwd` (`../../../../../
 * features/transcript/use-agent-cwd.ts`) reads it from the same
 * `fetchAgent` result the session app bar's cwd subtitle already uses,
 * narrowed to `AgentSnapshotSource` by `resolveAgentSnapshotClient`
 * (`../../../../../app-shell/session-route-daemon-clients.ts`). That is
 * the Android half of `apps/web/src/routes/screens/
 * use-session-workspace-root.ts`'s own `fetchAgent` -> `cwd` resolution.
 * `useAgentCwd` returns `undefined` while the snapshot is still loading,
 * when the agent is unknown, or when the read fails; this route passes
 * `""` in exactly that case — the same "pending, never fabricated"
 * placeholder both apps already accept — so no request is ever issued
 * against a guessed root.
 *
 * **T32S13 mount (P5-W19)**: `downloadOrigin` used to be omitted
 * entirely, so `FilesScreen`'s own `DownloadPanel` was never reachable
 * (`files-screen.tsx`'s doc comment on that prop). This route now
 * derives it from the same live `AppCore.connection` snapshot
 * `useConnectionStatus` already reads elsewhere in this app for
 * connection status — `daemonAddress` (T32A7) is non-`null` only on the
 * "direct" connect path, converted to an `http(s)://host:port` origin
 * by `buildDaemonHttpOrigin`, the exact function `app-shell/core.ts`'s
 * `getProbeUrl` now also calls. On the relay path `daemonAddress` is
 * always `null` — a relay tunnel proxies only the encrypted WebSocket,
 * so there is no direct HTTP origin to derive one from, and this
 * deliberately does not invent one.
 *
 * **T66**: also passes `connectionPath` (the same snapshot's own
 * `path`, `"direct" | "relay" | null`) straight through to
 * `FilesScreen`, unaltered. `createFileDownloadController`
 * (`file-download-model.ts`) reads it only when `downloadOrigin` is
 * falsy, to choose between two distinct named refusals: a relay-paired
 * session's missing origin is `FILE_DOWNLOAD_NO_RELAY_ORIGIN` (a
 * permanent, by-design limitation — bridging HTTP over the relay tunnel
 * is real work in `packages/relay`, off-limits this wave; see T66's
 * report for the filed seam naming the task that should own it), never
 * conflated with a merely-not-yet-connected session's generic
 * `FILE_DOWNLOAD_NO_ORIGIN`.
 *
 * **T32S14 mount**: `fetchImpl` was the one remaining piece this doc
 * comment used to say stayed omitted — `../../../../../../platform/
 * file-download-fetch.ts`'s `createFetchDownload()` now fills it, so
 * `DownloadPanel`'s `!fetchImpl` guard (`files-screen.tsx`'s `useMemo`)
 * no longer short-circuits and T66's named relay/no-origin refusals are
 * now actually reachable and visible, not silently absent. Built once
 * via `useMemo` (empty deps: `createFetchDownload()` takes no per-render
 * input) rather than a fresh closure every render, matching this file's
 * existing "derive once, thread down" shape for `downloadOrigin`.
 *
 * **T78 mount**: `filePicker`/`sharing` — the last two props this doc
 * comment used to say stayed unwired — are now `AppCore.filePicker`/
 * `AppCore.sharing` (`../../../../../app-shell/core.ts`), the same
 * "read the process-lifetime singleton `AppCore` already built, never
 * construct one locally" shape every other prop on this route already
 * follows. Both are real, honestly-degraded adapters, not stubs.
 * **CORRECTED (T290)**: this used to say no `expo-document-picker`/
 * `expo-image-picker`/`expo-sharing` install existed in this workspace
 * — the owner installed the first two at `488c4dc` and T290 used them
 * for `../../../../../features/composer`'s own `AttachmentSourcePort`/
 * `CameraCapturePort`; `expo-sharing` remains uninstalled.
 * `AppCore.filePicker` stays unavailable for a narrower reason now:
 * `createAndroidFilePicker` needs a router-root wiring T32S11 owns, not
 * done by T290 (see `AppCore["filePicker"]`'s own doc comment). So
 * `filePicker.pickFiles()` still always rejects
 * `FILE_PICKER_UNAVAILABLE` and `sharing.shareFiles()` always rejects
 * `SHARING_FILES_UNAVAILABLE` today — `sharing.shareText()` is
 * genuinely real, reaching React Native's own `Share.share`, since that
 * half needs no uninstalled package. `FilesScreen`'s `UploadPanel`
 * therefore now actually renders (it was omitted entirely before, since
 * `filePicker` was never a prop at all), and a denied/unavailable pick
 * lands in a named, visible `"refused"` state via
 * `../../../../../../features/files/file-upload-model.ts`'s
 * `explainFilePickerRefusal` rather than the silent no-op it used to be
 * — see that function's own doc comment.
 */
export default function SessionFilesRoute() {
  const { serverId, agentId, path } = useLocalSearchParams<{
    serverId: string;
    agentId: string;
    path?: string[];
  }>();
  const core = useAppCore();
  const { daemonAddress, path: connectionPath } = useConnectionStatus(core.connection);
  const downloadOrigin = daemonAddress ? buildDaemonHttpOrigin(daemonAddress) : null;
  // T32S14: see this route's own doc comment's "T32S14 mount" section.
  const fetchImpl = useMemo(() => createFetchDownload(), []);
  // See this route's own doc comment's "Workspace root" section.
  const cwd = useAgentCwd(resolveAgentSnapshotClient(core.connection), agentId ?? "");
  return (
    <FilesScreen
      serverId={serverId}
      agentId={agentId}
      path={path ?? []}
      workspaceRoot={cwd ?? ""}
      client={core.fileBrowserClient}
      filePicker={core.filePicker}
      sharing={core.sharing}
      downloadOrigin={downloadOrigin}
      connectionPath={connectionPath}
      fetchImpl={fetchImpl}
    />
  );
}
