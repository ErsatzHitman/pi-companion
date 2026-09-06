/**
 * `/h/:serverId/session/:agentId/files/*` screen (T35A1, plan.md
 * §6/§7/§9/§12.4). Replaces the placeholder T32S1C's route stub
 * (`../../app/h/[serverId]/session/[agentId]/files/[...path].tsx`, off
 * limits to this task) rendered until now — that route file itself
 * never changes: it only ever imports `FilesScreen` from this feature's
 * barrel (`index.ts`), unchanged.
 *
 * A dedicated, full-surface browser: this file never assumes it is
 * rendered beside a transcript (no split layout, no "peek" affordance —
 * unlike `apps/web`, which has room for a persistent chat pane, this is
 * its own route with its own scroll surface, matching plan.md §9.2's
 * "files gets a dedicated route" call).
 *
 * All state comes from `files-model.ts`'s `createFilesBrowserController`
 * — this file only maps that controller's emitted `FilesListState` onto
 * `View`/`Text`/`Pressable`, exactly like `../sessions/sessions-screen.
 * tsx`'s "component only wires the model to `useState`" precedent. Kind
 * (folder/file) is always visible text, never colour/icon alone
 * (plan.md §10.5).
 *
 * `client` is optional for the same "no live `DaemonClient`-backed
 * transport wired to this route yet" reason `sessionService` is optional
 * on `SessionsScreen`: the route stub only ever passes
 * `serverId`/`agentId`/`path`. Without one this screen renders a
 * permanent "not connected" error state through the same
 * `explainFileBrowserError` path a real disconnect would, rather than
 * constructing a controller that immediately fails, or rendering
 * nothing.
 *
 * T35A2 adds reading: pressing a file row (previously inert — see
 * `files-model.ts`'s old "files aren't navigable this wave" doc, no
 * longer true) drives a second, independent `file-view-model.ts`
 * controller and swaps this screen's body to `FileContentView` in place
 * of the directory listing — there is still no split layout, so "back"
 * is an explicit affordance, not a route change (this feature owns no
 * route). `FileContentView` decodes and tokenizes through
 * `file-syntax-highlight.ts` and composes the shared `CodeBlock`
 * primitive (`ui/primitives/CodeBlock.tsx`) for any file whose extension
 * `@picompanion/highlight` has no Lezer grammar for.
 *
 * For an extension the tokenizer *does* recognize, this file renders
 * per-token colour itself (`HighlightedCodeBody` below) rather than
 * through `CodeBlock`: unlike web's `CodeBlock` (`apps/web/src/ui/
 * primitives/CodeBlock.tsx`), which takes a `children` override
 * specifically so a richer renderer can supply per-token markup without
 * duplicating its `<pre><code>` shell, Android's `CodeBlock` (as shipped
 * this wave) has no such slot — only a plain `code: string`. Editing it
 * to add one is `ui/`'s owner's call (T32S5), not this task's Owns
 * grant, so `HighlightedCodeBody` reproduces `CodeBlock`'s *visual*
 * treatment (background/border/radius/padding/font) from the same
 * public `theme.colors.code`/`theme.typography.variant.code` tokens
 * `CodeBlock` itself reads — not a copy of `CodeBlock.tsx`'s file, no
 * private state or behaviour duplicated — while `CodeBlock` is composed
 * as-is for every file this tokenizer cannot colour. Recommend adding a
 * `children?: ReactNode` prop to `CodeBlock` mirroring web's, so a
 * future task can delete `HighlightedCodeBody` and compose `CodeBlock`
 * for the coloured case too.
 *
 * T35A3 adds native editing beneath the read-only body
 * (`FileEditableBody`, composed from `FileContentView`): an explicit,
 * always-visible limits sentence (`file-edit-model.ts`'s
 * `describeFileEditLimits`) next to the "Edit" affordance, an
 * Android-specific pre-edit refusal when the loaded file is over those
 * limits, and a `TextArea`-backed buffer that a failed save — a client
 * refusal, a rejected write RPC, or a resolved `"conflict"`/`"error"`
 * result — never discards (`file-edit-model.ts`'s `createFileEditController`
 * owns every one of those transitions; this file only renders its
 * state). Saving goes through the same `FileBrowserClient` `readFile`
 * already uses — `writeFile` is now an optional member of the same
 * interface (`file-browser-client.ts`), not a second client prop, so no
 * new required prop lands on `FilesScreenProps`.
 */
import type { NativeTheme } from "@picompanion/design-tokens";
import type { FilePicker, Sharing } from "@picompanion/frontend-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  Banner,
  Button,
  CodeBlock,
  EmptyState,
  ErrorState,
  LoadingState,
  Section,
  TextArea,
} from "../../ui/primitives";
import { asFontWeight } from "../../ui/theme/native-style-helpers";
import { useTheme } from "../../ui/theme/theme-context";
import {
  createFileEditController,
  describeFileEditLimits,
  type FileEditController,
  type FileEditState,
} from "./file-edit-model";
import {
  createFileDownloadController,
  type DownloadFetch,
  type FileDownloadController,
  type FileDownloadState,
} from "./file-download-model";
import {
  decodeUtf8Bytes,
  isLezerOnlyLanguageSupported,
  syntaxColorKey,
  tokenizeFileContent,
} from "./file-syntax-highlight";
import {
  createFileUploadController,
  type FileUploadController,
  type FileUploadState,
} from "./file-upload-model";
import {
  createFileViewController,
  type FileReadResult,
  type FileViewState,
} from "./file-view-model";
import {
  buildFilesBreadcrumbs,
  createFilesBrowserController,
  type FileBrowserClient,
  type FileBrowserEntry,
  type FilesListState,
} from "./files-model";

export interface FilesScreenProps {
  serverId: string;
  agentId: string;
  /** Workspace-relative path segments, matching `SessionFilesIntent["path"]` (`frontend-core`'s navigation module). */
  path: string[];
  /**
   * The daemon-side workspace root this browser is scoped to (protocol
   * `cwd`). Optional alongside `client` for the same "route stub passes
   * no transport yet" reason.
   */
  workspaceRoot?: string;
  /** Injected daemon RPC transport (T35A1). Optional — see module doc. */
  client?: FileBrowserClient;
  /**
   * Injected platform file picker (T35A4). Optional alongside `client`
   * for the same "no live transport/platform adapter wired to this
   * route yet" reason — `apps/android/src/platform/` has no concrete
   * `FilePicker` implementation this wave (see this task's report for
   * the filed seam). Without one, the upload affordance is omitted
   * entirely rather than rendered disabled or broken.
   */
  filePicker?: FilePicker;
  /**
   * Injected platform share/save sink for a completed download (T35A4).
   * Optional for the same reason `filePicker` is. Without one — or with
   * one whose own `isAvailable()` reports `false`, which is exactly what
   * T78's mounted `createFileSharingUnavailableSharing` does today — a
   * completed download still proves the round trip
   * (`downloadState.status === "success"`) but its bytes are never
   * handed anywhere further, and `DownloadPanel` below says so
   * explicitly rather than pretending the file was saved. That
   * distinction is drawn from `isAvailable()`, never from this prop
   * merely being non-`undefined`.
   */
  sharing?: Sharing;
  /**
   * The daemon's reachable HTTP origin for the download byte-fetch
   * (T35A4's `file_download_token_request`/HTTP-GET split — see
   * `file-browser-client.ts`'s `requestDownloadToken` doc). `null`/
   * omitted until a route can resolve the connected daemon's HTTP
   * origin (`FILE_DOWNLOAD_NO_ORIGIN`'s doc has the same gap web's
   * `use-file-download.ts` already documents).
   */
  downloadOrigin?: string | null;
  /**
   * Which connection path produced `downloadOrigin` (T66) — forwarded
   * verbatim to `createFileDownloadController`'s own `connectionPath` so
   * a relay-paired session with no origin gets the distinct, permanent
   * `FILE_DOWNLOAD_NO_RELAY_ORIGIN` refusal instead of the generic
   * "not available yet" one. `null`/omitted keeps the generic message,
   * matching every caller built before T66.
   */
  connectionPath?: "direct" | "relay" | null;
  /**
   * Fetches a download token's URL (T35A4). Optional alongside
   * `filePicker` — without one, the download affordance is omitted
   * entirely, matching the same "omit rather than show broken" rule.
   */
  fetchImpl?: DownloadFetch;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

export function FilesScreen({
  serverId,
  agentId,
  path,
  workspaceRoot,
  client,
  filePicker,
  sharing,
  downloadOrigin,
  connectionPath,
  fetchImpl,
}: FilesScreenProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const testId = `files-screen-${serverId}-${agentId}`;
  const initialPath = useMemo(() => path.join("/"), [path]);

  const controller = useMemo(() => {
    if (!client || workspaceRoot === undefined) return null;
    return createFilesBrowserController({ client, workspaceRoot, initialPath });
    // Deliberately built once per (client, workspaceRoot) pair, not per
    // `initialPath` change — the route's own path segments only seed the
    // controller's *first* listing; after that, navigation is owned by
    // the controller itself (`open`/`up`), not by this prop re-rendering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, workspaceRoot]);

  const [state, setState] = useState<FilesListState | null>(() => controller?.getState() ?? null);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  useEffect(() => {
    if (!controller) {
      setState(null);
      return;
    }
    setState(controller.getState());
    return controller.subscribe(setState);
  }, [controller]);

  // The file currently open for reading, or null while browsing the
  // directory listing. Cleared whenever the browsable (client,
  // workspaceRoot) pair changes out from under it (e.g. a reconnect),
  // same as `controller` itself being rebuilt.
  const [selectedEntry, setSelectedEntry] = useState<FileBrowserEntry | null>(null);
  useEffect(() => {
    setSelectedEntry(null);
  }, [client, workspaceRoot]);

  const fileController = useMemo(() => {
    if (!client || workspaceRoot === undefined || !selectedEntry) return null;
    return createFileViewController({
      client,
      workspaceRoot,
      path: selectedEntry.path,
      sizeHint: selectedEntry.size,
    });
    // Deliberately keyed on the selected entry's identity, not any list
    // state — this is a fresh, independent read per file opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, workspaceRoot, selectedEntry]);

  const [fileState, setFileState] = useState<FileViewState | null>(
    () => fileController?.getState() ?? null,
  );
  useEffect(() => {
    if (!fileController) {
      setFileState(null);
      return;
    }
    setFileState(fileController.getState());
    return fileController.subscribe(setFileState);
  }, [fileController]);

  // Upload (T35A4): a generic staged-attachment upload, independent of
  // the browsed path — see `file-browser-client.ts`'s `uploadFile` doc
  // for why this never writes into `workspaceRoot`. Omitted entirely
  // (not disabled) when either `client` or `filePicker` is missing.
  const uploadController = useMemo(() => {
    if (!client || !filePicker) return null;
    return createFileUploadController({ client, filePicker });
  }, [client, filePicker]);

  const [uploadState, setUploadState] = useState<FileUploadState | null>(
    () => uploadController?.getState() ?? null,
  );
  useEffect(() => {
    if (!uploadController) {
      setUploadState(null);
      return;
    }
    setUploadState(uploadController.getState());
    return uploadController.subscribe(setUploadState);
  }, [uploadController]);

  // Download (T35A4): one controller per opened file, built fresh
  // whenever `selectedEntry` changes — never auto-started; the user
  // presses `DownloadPanel`'s button. Omitted entirely when `client`,
  // `workspaceRoot`, `fetchImpl`, or the selected entry is missing.
  const downloadController = useMemo(() => {
    if (!client || workspaceRoot === undefined || !selectedEntry || !fetchImpl) return null;
    return createFileDownloadController({
      client,
      downloadOrigin: downloadOrigin ?? null,
      connectionPath: connectionPath ?? null,
      fetchImpl,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, workspaceRoot, selectedEntry, fetchImpl, downloadOrigin, connectionPath]);

  const [downloadState, setDownloadState] = useState<FileDownloadState | null>(
    () => downloadController?.getState() ?? null,
  );
  useEffect(() => {
    if (!downloadController) {
      setDownloadState(null);
      return;
    }
    setDownloadState(downloadController.getState());
    return downloadController.subscribe(setDownloadState);
  }, [downloadController]);

  // P5-W22 merge gate: whether this build's `Sharing` can ACTUALLY take
  // a file, asked of the adapter itself rather than inferred from the
  // prop merely being present. `canSave` used to be `Boolean(sharing)`,
  // which was true only while no `Sharing` was mounted at all; T78 then
  // mounted `createFileSharingUnavailableSharing` — a real object whose
  // `shareFiles()` always rejects `SHARING_FILES_UNAVAILABLE` — so the
  // presence test started reporting "saved" for a file that reaches
  // nothing. `isAvailable()` is the adapter's own honest answer (`false`
  // for that stopgap, the real `expo-sharing` `isAvailableAsync()` once
  // it is installed), so this flips to `true` on its own the moment file
  // sharing genuinely works, with no further edit here.
  const [canShareFiles, setCanShareFiles] = useState(false);
  useEffect(() => {
    if (!sharing) {
      setCanShareFiles(false);
      return;
    }
    let cancelled = false;
    sharing
      .isAvailable()
      .then((available) => {
        if (!cancelled) setCanShareFiles(available);
      })
      .catch(() => {
        if (!cancelled) setCanShareFiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sharing]);

  // Hands a completed download's bytes to the injected `Sharing` sink
  // exactly once — `downloadState` is a fresh object identity every
  // emitted state, but no further emission happens once `"success"` is
  // reached (the controller is done), so this fires only on the
  // transition into `"success"`, never repeatedly.
  useEffect(() => {
    if (!sharing || !downloadState || downloadState.status !== "success" || !downloadState.file) {
      return;
    }
    const file = downloadState.file;
    sharing
      .shareFiles([{ name: file.fileName, mimeType: file.mimeType, data: file.bytes }])
      .catch(() => undefined); // a platform share failure is outside this download's own recoverable-failure contract — the bytes already arrived intact
  }, [sharing, downloadState]);

  const path_ = state?.path ?? initialPath;
  const breadcrumbs = useMemo(() => buildFilesBreadcrumbs(path_), [path_]);

  return (
    <ScrollView style={styles.container} testID={testId}>
      <FilesBreadcrumbRow
        breadcrumbs={breadcrumbs}
        onNavigate={
          controller
            ? (crumbPath) => {
                setSelectedEntry(null);
                controller.load(crumbPath);
              }
            : undefined
        }
        theme={theme}
        testId={`${testId}-breadcrumbs`}
      />
      {uploadController ? (
        <UploadPanel
          controller={uploadController}
          state={uploadState}
          theme={theme}
          testId={`${testId}-upload`}
        />
      ) : null}
      {!client || workspaceRoot === undefined ? (
        <ErrorState
          title="Not connected"
          description="Connect to a daemon to browse files for this session."
          testId={`${testId}-not-connected`}
        />
      ) : selectedEntry ? (
        <FileContentView
          entry={selectedEntry}
          state={fileState}
          client={client}
          workspaceRoot={workspaceRoot}
          onSaved={() => fileController?.retry()}
          onBack={() => setSelectedEntry(null)}
          downloadController={downloadController}
          downloadState={downloadState}
          canSave={canShareFiles}
          theme={theme}
          testId={`${testId}-file`}
        />
      ) : state === null || state.status === "loading" ? (
        <LoadingState
          title="Listing folder…"
          description={path_.length > 0 ? path_ : "Workspace root"}
          testId={`${testId}-loading`}
        />
      ) : state.status === "error" ? (
        <ErrorState
          title={state.error?.title ?? "Couldn't list this folder"}
          description={state.error?.description ?? ""}
          testId={`${testId}-error`}
        />
      ) : state.entries !== null && state.entries.length === 0 ? (
        <EmptyState
          title="This folder is empty"
          description="Nothing here yet."
          testId={`${testId}-empty`}
        />
      ) : (
        <Section title="Contents" testId={`${testId}-contents`}>
          <View style={styles.rows}>
            {(state.entries ?? []).map((entry) => (
              <FileEntryRow
                key={entry.path}
                entry={entry}
                theme={theme}
                onOpen={
                  controller
                    ? entry.kind === "directory"
                      ? () => controller.open(entry)
                      : () => setSelectedEntry(entry)
                    : undefined
                }
                testId={`${testId}-entry-${entry.path || entry.name}`}
              />
            ))}
          </View>
        </Section>
      )}
    </ScrollView>
  );
}

function FilesBreadcrumbRow({
  breadcrumbs,
  onNavigate,
  theme,
  testId,
}: {
  breadcrumbs: ReturnType<typeof buildFilesBreadcrumbs>;
  onNavigate: ((path: string) => void) | undefined;
  theme: NativeTheme;
  testId: string;
}) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const label = breadcrumbs.map((crumb) => crumb.label).join(" / ");
  return (
    <View
      style={styles.breadcrumbRow}
      accessible
      accessibilityRole="none"
      accessibilityLabel={`Current folder: ${label}`}
      testID={testId}
    >
      {breadcrumbs.map((crumb, index) => (
        <View key={crumb.path} style={styles.breadcrumbItem}>
          {index > 0 ? <Text style={styles.breadcrumbSeparator}>/</Text> : null}
          {crumb.isCurrent ? (
            <Text style={styles.breadcrumbCurrent}>{crumb.label}</Text>
          ) : (
            <Pressable
              onPress={onNavigate ? () => onNavigate(crumb.path) : undefined}
              disabled={!onNavigate}
              accessibilityRole="button"
              accessibilityLabel={`Go to ${crumb.label}`}
              testID={`${testId}-crumb-${crumb.path || "root"}`}
              hitSlop={8}
            >
              <Text style={styles.breadcrumbLink}>{crumb.label}</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

/**
 * The `/files` screen's upload affordance (T35A4): pick a local file,
 * upload it, and surface every named `FileUploadState.status` — this
 * component only ever renders `uploadController`'s state, it owns none
 * of its own (matching this file's module doc's "component only wires
 * the model to `useState`" precedent). Rendered above the browsed
 * listing/file view, not inside either, since an upload is independent
 * of the currently browsed path (see `file-browser-client.ts`'s
 * `uploadFile` doc for why).
 */
function UploadPanel({
  controller,
  state,
  theme,
  testId,
}: {
  controller: FileUploadController;
  state: FileUploadState | null;
  theme: NativeTheme;
  testId: string;
}) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const status = state?.status ?? "idle";
  return (
    <View style={styles.transferPanel} testID={testId}>
      <Text style={styles.transferTitle}>Upload a file</Text>
      <Text style={styles.transferMeta}>
        {state?.selection ? state.selection.name : "No file selected"}
      </Text>
      {status === "refused" && state?.refusal ? (
        <Banner
          tone="danger"
          message={`${state.refusal.title} — ${state.refusal.description}`}
          testId={`${testId}-refused`}
        />
      ) : null}
      {status === "error" && state?.error ? (
        <Banner
          tone="danger"
          message={`${state.error.title} — ${state.error.description}`}
          testId={`${testId}-error`}
        />
      ) : null}
      {status === "cancelled" ? (
        <Banner tone="info" message="Upload cancelled." testId={`${testId}-cancelled`} />
      ) : null}
      {status === "success" ? (
        <Banner tone="success" message="Uploaded." testId={`${testId}-success`} />
      ) : null}
      {status === "reading" || status === "uploading" ? (
        <Text style={styles.transferMeta} testID={`${testId}-progress`}>
          {status === "reading" ? "Reading…" : "Uploading…"}
        </Text>
      ) : null}
      <View style={styles.editActions}>
        <Button
          kind="secondary"
          label="Choose file"
          onPress={controller.selectFile}
          testId={`${testId}-select`}
        />
        {status === "reading" || status === "uploading" ? (
          <Button
            kind="secondary"
            label="Cancel"
            onPress={controller.cancel}
            testId={`${testId}-cancel`}
          />
        ) : status === "error" || status === "cancelled" || status === "refused" ? (
          <Button
            kind="primary"
            label="Retry"
            onPress={controller.retry}
            disabled={!state?.selection}
            testId={`${testId}-retry`}
          />
        ) : (
          <Button
            kind="primary"
            label="Upload"
            onPress={controller.upload}
            disabled={!state?.selection}
            testId={`${testId}-upload`}
          />
        )}
      </View>
    </View>
  );
}

/**
 * The `/files` screen's per-file download affordance (T35A4): requests
 * a token and streams the file's bytes, surfacing real byte progress
 * once the total is known (`file-download-model.ts`'s module doc) and
 * every named `FileDownloadState.status`. `canSave === false` renders
 * an explicit "won't be saved anywhere" notice rather than silently
 * discarding a successfully downloaded file's bytes.
 */
function DownloadPanel({
  entry,
  workspaceRoot,
  controller,
  state,
  canSave,
  theme,
  testId,
}: {
  entry: FileBrowserEntry;
  workspaceRoot: string;
  controller: FileDownloadController;
  state: FileDownloadState | null;
  canSave: boolean;
  theme: NativeTheme;
  testId: string;
}) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const status = state?.status ?? "idle";
  const progressLabel =
    state?.progress === null || state?.progress === undefined
      ? null
      : `${Math.round(state.progress * 100)}%`;
  return (
    <View style={styles.transferPanel} testID={testId}>
      <Text style={styles.transferTitle}>Download this file</Text>
      {status === "refused" && state?.refusal ? (
        <Banner
          tone="danger"
          message={`${state.refusal.title} — ${state.refusal.description}`}
          testId={`${testId}-refused`}
        />
      ) : null}
      {status === "error" && state?.error ? (
        <Banner
          tone="danger"
          message={`${state.error.title} — ${state.error.description}`}
          testId={`${testId}-error`}
        />
      ) : null}
      {status === "cancelled" ? (
        <Banner tone="info" message="Download cancelled." testId={`${testId}-cancelled`} />
      ) : null}
      {status === "success" ? (
        <Banner
          tone={canSave ? "success" : "warning"}
          message={canSave ? "Downloaded." : "Downloaded, but nothing is set up to save it yet."}
          testId={`${testId}-success`}
        />
      ) : null}
      {status === "requesting-token" || status === "downloading" ? (
        <Text style={styles.transferMeta} testID={`${testId}-progress`}>
          {status === "requesting-token" ? "Requesting…" : (progressLabel ?? "Downloading…")}
        </Text>
      ) : null}
      <View style={styles.editActions}>
        {status === "requesting-token" || status === "downloading" ? (
          <Button
            kind="secondary"
            label="Cancel"
            onPress={controller.cancel}
            testId={`${testId}-cancel`}
          />
        ) : status === "error" || status === "cancelled" || status === "refused" ? (
          <Button
            kind="primary"
            label="Retry"
            onPress={controller.retry}
            testId={`${testId}-retry`}
          />
        ) : status !== "success" ? (
          <Button
            kind="primary"
            label="Download"
            onPress={() => controller.download(workspaceRoot, entry.path, entry.name)}
            testId={`${testId}-start`}
          />
        ) : null}
      </View>
    </View>
  );
}

function FileEntryRow({
  entry,
  theme,
  onOpen,
  testId,
}: {
  entry: FileBrowserEntry;
  theme: NativeTheme;
  onOpen: (() => void) | undefined;
  testId: string;
}) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const kindLabel = entry.kind === "directory" ? "Folder" : "File";
  const meta =
    entry.kind === "directory" ? kindLabel : `${kindLabel} · ${formatFileSize(entry.size)}`;
  return (
    <Pressable
      style={styles.row}
      accessible
      accessibilityRole={onOpen ? "button" : "none"}
      accessibilityLabel={`${entry.name}, ${meta}`}
      onPress={onOpen}
      disabled={!onOpen}
      testID={testId}
    >
      <Text style={styles.rowName} numberOfLines={1}>
        {entry.name}
      </Text>
      <Text style={styles.rowMeta}>{meta}</Text>
    </Pressable>
  );
}

/**
 * The `/files` screen's body once a file row has been pressed (T35A2):
 * a back affordance, the file's name, and — depending on
 * `state.status` — a loading/error/refusal placeholder or the decoded,
 * tokenized content itself. Kind (loading/error/refused/ready) is
 * always a distinct, named `ErrorState`/`EmptyState`/`LoadingState`
 * title, never a single generic "couldn't open this file" (see
 * `file-view-model.ts`'s module doc).
 */
function FileContentView({
  entry,
  state,
  client,
  workspaceRoot,
  onSaved,
  onBack,
  downloadController,
  downloadState,
  canSave,
  theme,
  testId,
}: {
  entry: FileBrowserEntry;
  state: FileViewState | null;
  /** Injected daemon RPC transport, definitely present here — `FilesScreen` only reaches this branch once `client`/`workspaceRoot` are both defined. Needed alongside `state.file` for editing (`FileEditableBody` below); the read-only path (`FileTextBody`) never touches it. */
  client: FileBrowserClient;
  workspaceRoot: string;
  /** Re-reads the file from the daemon; called once a save is confirmed written (`file-view-model.ts`'s `FileViewController.retry`, the daemon-is-authoritative contract `file-edit-model.ts`'s module doc describes). */
  onSaved: () => void;
  onBack: () => void;
  /** T35A4's per-file download controller, or `null` when `fetchImpl`/`downloadOrigin` wiring isn't available — `DownloadPanel` is omitted entirely in that case. Independent of `state`/read status: a binary or oversized-refused file (unreadable by `FileViewController`) can still be downloaded. */
  downloadController: FileDownloadController | null;
  downloadState: FileDownloadState | null;
  /** Whether a completed download's bytes will actually be handed anywhere — the injected `Sharing`'s own `isAvailable()`, NOT merely "a `Sharing` was passed": this build mounts a real `Sharing` whose `shareFiles()` always rejects, so presence alone would make `DownloadPanel` claim a file was saved when it reached nothing. */
  canSave: boolean;
  theme: NativeTheme;
  testId: string;
}) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.fileView} testID={testId}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to folder"
        testID={`${testId}-back`}
        hitSlop={8}
      >
        <Text style={styles.breadcrumbLink}>‹ Back to folder</Text>
      </Pressable>
      <Text style={styles.fileName} numberOfLines={1}>
        {entry.name}
      </Text>
      {downloadController ? (
        <DownloadPanel
          entry={entry}
          workspaceRoot={workspaceRoot}
          controller={downloadController}
          state={downloadState}
          canSave={canSave}
          theme={theme}
          testId={`${testId}-download`}
        />
      ) : null}
      {state === null || state.status === "loading" ? (
        <LoadingState
          title="Reading file…"
          description={entry.path || entry.name}
          testId={`${testId}-loading`}
        />
      ) : state.status === "error" ? (
        <ErrorState
          title={state.error?.title ?? "Couldn't read this file"}
          description={state.error?.description ?? ""}
          testId={`${testId}-error`}
        />
      ) : state.status === "refused" ? (
        <EmptyState
          title={state.refusal?.title ?? "This file can't be previewed"}
          description={state.refusal?.description ?? ""}
          testId={`${testId}-refused`}
        />
      ) : state.file ? (
        <FileEditableBody
          file={state.file}
          path={entry.path || entry.name}
          client={client}
          workspaceRoot={workspaceRoot}
          onSaved={onSaved}
          theme={theme}
          testId={`${testId}-content`}
        />
      ) : null}
    </View>
  );
}

/**
 * The `/files` screen's per-file body once a read has succeeded (T35A3):
 * renders the same read-only `FileTextBody` this file always has, plus
 * — for a text file, gated by `file-edit-model.ts`'s
 * `explainFileEditLimitRefusal` — an edit affordance beneath it. The
 * limits sentence (`describeFileEditLimits()`) is always rendered next
 * to that affordance, whether or not this particular file is refused,
 * so the ceiling is visible before any file is ever near it (this
 * task's "stated explicitly rather than failing silently" criterion).
 *
 * Owns its own `FileEditController` (`createFileEditController`),
 * independent of the read-side `FileViewController` above it — editing
 * a file never re-issues or interferes with the read that produced
 * `file`; only a confirmed `"written"` save calls `onSaved` to trigger
 * a fresh read.
 *
 * T153: the `useMemo` below still rebuilds a new `FileEditController`
 * object every time `file`/`content` change identity — a reconnect
 * producing a fresh read of the same path, or the read-side controller
 * re-running for any other reason, both do this, and neither is
 * specific to this component (see `file-edit-model.ts`'s module doc,
 * "T153" section, for why that used to mean the buffer was discarded).
 * `sessionRef` is what makes that rebuild non-destructive: it remembers
 * the PATH the most recently built controller was for and that
 * controller's own `getSession()` snapshot, so when the next `useMemo`
 * recompute is for the SAME path, the replacement is built with
 * `resumeSession` set and resumes exactly where the old one left off
 * (buffer, error, and — the part that actually matters for a write —
 * the ORIGINAL pinned basis). A recompute for a genuinely different
 * path (the user opened another file) finds no matching entry and gets
 * a fresh `baseState`, same as before this task.
 */
function FileEditableBody({
  file,
  path,
  client,
  workspaceRoot,
  onSaved,
  theme,
  testId,
}: {
  file: FileReadResult;
  path: string;
  client: FileBrowserClient;
  workspaceRoot: string;
  onSaved: () => void;
  theme: NativeTheme;
  testId: string;
}) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const content = useMemo(() => decodeUtf8Bytes(file.bytes), [file.bytes]);
  const limitsText = useMemo(() => describeFileEditLimits(), []);

  // T153: tracks the path/session of whichever controller this
  // component most recently built, so the `useMemo` below can tell "the
  // same file was re-read" apart from "a different file was opened" and
  // resume the former instead of discarding it. A plain `useRef`, not
  // `useState` — reading and writing it happens during render (inside
  // the memo callback itself), never triggers a re-render on its own,
  // and its value is only ever consumed by the NEXT recompute.
  const sessionRef = useRef<{ path: string; controller: FileEditController } | null>(null);

  const controller = useMemo(() => {
    const previous = sessionRef.current;
    const resumeSession =
      previous && previous.path === file.path ? previous.controller.getSession() : null;
    const next = createFileEditController({
      client,
      workspaceRoot,
      file,
      content,
      onSaved,
      resumeSession,
    });
    sessionRef.current = { path: file.path, controller: next };
    return next;
    // Deliberately rebuilt only when the file identity/content this
    // controller was opened against actually changes — not on every
    // render, and not merely because `onSaved` is a fresh closure each
    // render (it always calls the same `retry()`). A rebuild forced by
    // a fresh read of the SAME path resumes via `resumeSession` above
    // rather than discarding the in-progress edit (T153).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, workspaceRoot, file, content]);

  const [editState, setEditState] = useState<FileEditState>(() => controller.getState());
  useEffect(() => {
    setEditState(controller.getState());
    return controller.subscribe(setEditState);
  }, [controller]);

  return (
    <View style={styles.editWrapper} testID={testId}>
      <FileTextBody file={file} path={path} testId={`${testId}-body`} />
      {editState.mode === "read" ? (
        <View style={styles.editAffordanceRow} testID={`${testId}-edit-affordance`}>
          <Text style={styles.editLimitsText}>{limitsText}</Text>
          {editState.limitRefusal ? (
            <Banner
              tone="info"
              message={`${editState.limitRefusal.title} — ${editState.limitRefusal.description}`}
              testId={`${testId}-edit-refused`}
            />
          ) : (
            <Button
              kind="secondary"
              label="Edit"
              onPress={controller.startEditing}
              testId={`${testId}-edit-start`}
            />
          )}
        </View>
      ) : (
        <View style={styles.editForm} testID={`${testId}-editor`}>
          {editState.error ? (
            <Banner
              tone={editState.error.isConflict ? "warning" : "danger"}
              message={`${editState.error.title} — ${editState.error.description}`}
              testId={`${testId}-edit-error`}
            />
          ) : editState.remoteChanged ? (
            // T153: detection only, matching web's `use-file-editor.ts`
            // banner — this never reloads or discards anything on its
            // own. `save()` still writes against the basis this edit
            // began from, so worst case if the user ignores this the
            // daemon's own conflict check fires.
            <Banner
              tone="warning"
              message="This file changed on the daemon while you were editing. Saving now is still safe — it won't overwrite the newer version — but you may want to review it first."
              testId={`${testId}-edit-remote-changed`}
            />
          ) : null}
          <TextArea
            label={`Editing ${path}`}
            value={editState.buffer}
            onChangeText={controller.updateBuffer}
            editable={editState.mode === "edit"}
            testId={`${testId}-edit-buffer`}
          />
          <View style={styles.editActions}>
            <Button
              kind="secondary"
              label="Cancel"
              onPress={controller.cancelEditing}
              disabled={editState.mode === "saving"}
              testId={`${testId}-edit-cancel`}
            />
            <Button
              kind="primary"
              label={editState.mode === "saving" ? "Saving…" : "Save"}
              onPress={controller.save}
              disabled={editState.mode === "saving"}
              testId={`${testId}-edit-save`}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function extensionLabel(path: string): string | undefined {
  const name = path.split("/").pop() ?? path;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return undefined;
  return name.slice(dotIndex + 1).toLowerCase();
}

/**
 * Decodes and renders `file.bytes` (already known to be `kind: "text"`
 * and at or under `MAX_PREVIEWABLE_FILE_BYTES` — `state.status ===
 * "ready"` guarantees both, see `file-browser-client.ts#explainRefusedFileKind`).
 * Composes `CodeBlock` for any extension `@picompanion/highlight`'s
 * Lezer build has no grammar for; otherwise renders coloured tokens
 * itself (see this file's module doc for why `CodeBlock` alone can't
 * take those tokens as-is this wave).
 */
function FileTextBody({
  file,
  path,
  testId,
}: {
  file: FileReadResult;
  path: string;
  testId: string;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const content = useMemo(() => decodeUtf8Bytes(file.bytes), [file.bytes]);
  const highlightable = content.length > 0 && isLezerOnlyLanguageSupported(path);
  const lines = useMemo(
    () => (highlightable ? tokenizeFileContent(content, path) : null),
    [highlightable, content, path],
  );
  const language = extensionLabel(path);

  if (content.length === 0) {
    return (
      <EmptyState
        title="This file is empty"
        description="There is nothing to show here yet."
        testId={`${testId}-empty`}
      />
    );
  }

  if (!lines) {
    return <CodeBlock code={content} language={language} testId={testId} />;
  }

  return (
    <HighlightedCodeBody
      lines={lines}
      language={language}
      content={content}
      styles={styles}
      theme={theme}
      testId={testId}
    />
  );
}

/**
 * Renders `lines` (one `HighlightToken[]` per source line) as coloured,
 * nested `<Text>` runs inside a monospace, horizontally scrollable
 * frame. See this file's module doc for why this duplicates `CodeBlock`'s
 * visual chrome (via the same public theme tokens) instead of composing
 * it directly.
 */
function HighlightedCodeBody({
  lines,
  language,
  content,
  styles,
  theme,
  testId,
}: {
  lines: ReturnType<typeof tokenizeFileContent>;
  language: string | undefined;
  content: string;
  styles: ReturnType<typeof createStyles>;
  theme: NativeTheme;
  testId: string;
}) {
  return (
    <View
      style={styles.highlightedWrapper}
      testID={testId}
      accessible
      accessibilityLabel={`Code${language ? ` (${language})` : ""}: ${content}`}
    >
      {language ? <Text style={styles.highlightedLanguage}>{language}</Text> : null}
      <ScrollView horizontal accessibilityRole="none">
        <Text style={styles.highlightedCode} importantForAccessibility="no">
          {lines.map((tokens, lineIndex) => (
            // eslint-disable-next-line react/no-array-index-key -- lines are positional and never reordered
            <Text key={lineIndex}>
              {tokens.map((token, tokenIndex) => {
                const colorKey = syntaxColorKey(token.style);
                return (
                  <Text
                    // eslint-disable-next-line react/no-array-index-key -- tokens are positional and never reordered
                    key={tokenIndex}
                    style={colorKey ? { color: theme.colors.code.syntax[colorKey] } : undefined}
                  >
                    {token.text}
                  </Text>
                );
              })}
              {lineIndex < lines.length - 1 ? "\n" : null}
            </Text>
          ))}
        </Text>
      </ScrollView>
    </View>
  );
}

function createStyles(theme: NativeTheme) {
  return StyleSheet.create({
    container: { flex: 1 },
    breadcrumbRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[2],
      gap: theme.spacing[1],
    },
    breadcrumbItem: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
    breadcrumbSeparator: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    breadcrumbCurrent: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.caption.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    breadcrumbLink: {
      color: theme.colors.accent,
      fontSize: theme.typography.variant.caption.fontSize,
    },
    rows: { gap: theme.spacing[1] },
    row: {
      minHeight: 48,
      justifyContent: "center",
      gap: theme.spacing[1],
      paddingVertical: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderStyle: "dashed",
      borderBottomColor: theme.colors.line,
    },
    rowName: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    rowMeta: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    fileView: {
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[2],
      gap: theme.spacing[2],
    },
    fileName: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    editWrapper: { gap: theme.spacing[2] },
    editAffordanceRow: { gap: theme.spacing[2] },
    editLimitsText: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    editForm: { gap: theme.spacing[2] },
    editActions: { flexDirection: "row", gap: theme.spacing[2] },
    transferPanel: {
      gap: theme.spacing[2],
      paddingHorizontal: theme.spacing[2],
      paddingVertical: theme.spacing[2],
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.line,
      borderRadius: theme.radii.control,
    },
    transferTitle: {
      color: theme.colors.ink,
      fontSize: theme.typography.variant.body.fontSize,
      fontWeight: asFontWeight(theme.typography.variant.label.fontWeight),
    },
    transferMeta: {
      color: theme.colors["ink-3"],
      fontSize: theme.typography.variant.caption.fontSize,
    },
    // Deliberately mirrors `CodeBlock`'s own wrapper/language/code styles
    // (`ui/primitives/CodeBlock.tsx`) token-for-token — see this file's
    // module doc for why this feature cannot compose `CodeBlock` itself
    // for the coloured-token case.
    highlightedWrapper: {
      backgroundColor: theme.colors.code.codeBackground,
      borderWidth: 1,
      borderColor: theme.colors.code.codeBorder,
      borderRadius: theme.radii.control,
      padding: theme.spacing[3],
    },
    highlightedLanguage: {
      color: theme.colors["ink-3"],
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.caption.fontSize,
      marginBottom: theme.spacing[1],
    },
    highlightedCode: {
      fontFamily: theme.typography.variant.code.fontFamily,
      fontSize: theme.typography.variant.code.fontSize,
      lineHeight: theme.typography.variant.code.lineHeight,
      color: theme.colors.code.codeForeground,
    },
  });
}
