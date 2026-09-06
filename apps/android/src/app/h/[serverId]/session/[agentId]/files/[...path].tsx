import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { buildDaemonHttpOrigin } from "../../../../../../features/connect/daemon-connection-store.js";
import { useConnectionStatus } from "../../../../../../features/connect";
import { FilesScreen } from "../../../../../../features/files";
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
 * **T32S4's fix**: until now this route passed no `client` and no
 * `workspaceRoot`, so `FilesScreen`'s "Not connected" `ErrorState`
 * rendered permanently regardless of any real connection — the exact
 * defect this task's brief names. `client` is now `AppCore.fileBrowserClient`
 * (`../../../../../app-shell/core.ts`), the same "always a real, stable
 * object; every method reads the live connection fresh" adapter
 * `AppCore.sessionService` already established — never a client
 * constructed in this route file. `workspaceRoot` is `""`, the daemon-side
 * workspace root's placeholder value, mirroring `apps/web/src/features/
 * files/file-browser-screen.tsx`'s own `workspaceRoot = ""` default and
 * its doc comment's reason: resolving a session's *real* workspace root
 * depends on `packages/frontend-core/src/sessions/index.ts`'s Phase 1
 * stub (see docs/issues-from-plan.md), which is outside both that file's
 * and this route's scope.
 *
 * **Note, corrected at the P5-W9 merge gate:** when this comment was
 * written it added "so this placeholder never reaches a real daemon with
 * the wrong root", because `AppCore.connection` was never fed by a real
 * `ConnectForm` submission. T32A4 closed that loop in the same wave, so
 * the placeholder *can* now reach a live daemon — exactly as web's
 * `workspaceRoot = ""` default already does, which is why this stays
 * `""` rather than becoming a guess. Whichever task replaces
 * `packages/frontend-core/src/sessions/index.ts`'s Phase 1 stub owns
 * resolving the session's real workspace root for both platforms.
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
 * follows. Both are real, honestly-degraded adapters, not stubs: no
 * `expo-document-picker`/`expo-image-picker`/`expo-sharing` install
 * exists in this workspace (see `AppCore["filePicker"]`/
 * `AppCore["sharing"]`'s own doc comments for the exact install
 * commands), so `filePicker.pickFiles()` always rejects
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
  return (
    <FilesScreen
      serverId={serverId}
      agentId={agentId}
      path={path ?? []}
      workspaceRoot=""
      client={core.fileBrowserClient}
      filePicker={core.filePicker}
      sharing={core.sharing}
      downloadOrigin={downloadOrigin}
      connectionPath={connectionPath}
      fetchImpl={fetchImpl}
    />
  );
}
