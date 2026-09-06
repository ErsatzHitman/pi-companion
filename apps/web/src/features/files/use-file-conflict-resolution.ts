/**
 * Fetches the OTHER side of a detected write conflict (T41A2, plan.md
 * §12.4) so both versions can be shown before the user decides how to
 * resolve it.
 *
 * `FileWriteConflictVersion` (`file-write-client.ts`) — the payload a
 * `"conflict"` `FileWriteResult` carries, mirroring the daemon's
 * `FileVersionSchema` — is deliberately thin: `cwd`, `path`, `size`,
 * `modifiedAt`, and (when available) `revision`. It does **not** carry
 * the remote file's bytes. The only way to get the daemon's actual
 * current content is a fresh `readClient.readFile` call — exactly the
 * request `useFileExplorer` issues for an ordinary file open — which is
 * what this hook does, scoped to firing only once a conflict is really
 * on screen.
 *
 * `version.status === "missing"` (the file was deleted) or `"error"`
 * (the daemon's own version-check failed) both carry no content to
 * fetch or compare — this hook reports those as `"missing"`/
 * `"unavailable"` without calling `readClient` at all, since there is
 * nothing on the other side to read.
 */
import { useEffect, useRef, useState } from "react";

import type {
  FileReadClient,
  FileReadErrorExplanation,
  FileReadResult,
} from "./file-read-client.js";
import { explainFileReadError } from "./file-read-client.js";
import { decodeFileText } from "./use-file-editor.js";
import type { FileWriteConflictVersion } from "./file-write-client.js";

export type FileConflictResolutionStatus = "loading" | "ready" | "missing" | "unavailable";

export interface FileConflictResolutionState {
  status: FileConflictResolutionStatus;
  /** The daemon's current file, freshly re-read. Set only when `status === "ready"`. */
  remoteFile: FileReadResult | null;
  /** `remoteFile`'s decoded text, for the diff view. Set only when `status === "ready"`. */
  remoteText: string | null;
  /** Set only when `status === "unavailable"` — a transport failure, or content that isn't viewable as text. */
  error: FileReadErrorExplanation | null;
}

export interface UseFileConflictResolutionOptions {
  readClient: FileReadClient;
  /** The daemon-side workspace root (protocol `cwd`) this file belongs to. */
  workspaceRoot: string;
  /** The file's path, relative to `workspaceRoot`. */
  path: string;
  /** The conflict payload from the failed save (`FileEditorErrorState.conflictVersion`). */
  version: FileWriteConflictVersion;
}

function loadingState(): FileConflictResolutionState {
  return { status: "loading", remoteFile: null, remoteText: null, error: null };
}

function missingState(): FileConflictResolutionState {
  return { status: "missing", remoteFile: null, remoteText: null, error: null };
}

function unavailableState(error: FileReadErrorExplanation | null): FileConflictResolutionState {
  return { status: "unavailable", remoteFile: null, remoteText: null, error };
}

function initialState(version: FileWriteConflictVersion): FileConflictResolutionState {
  if (version.status === "missing") return missingState();
  if (version.status !== "ready") return unavailableState(null);
  return loadingState();
}

export function useFileConflictResolution(
  options: UseFileConflictResolutionOptions,
): FileConflictResolutionState {
  const { readClient, workspaceRoot, path, version } = options;
  const [state, setState] = useState<FileConflictResolutionState>(() => initialState(version));
  const requestRef = useRef(0);

  useEffect(() => {
    if (version.status === "missing") {
      setState(missingState());
      return;
    }
    if (version.status !== "ready") {
      setState(unavailableState(null));
      return;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState(loadingState());

    readClient.readFile(workspaceRoot, path).then(
      (file) => {
        if (requestRef.current !== requestId) return;
        if (file.kind !== "text") {
          setState(
            unavailableState({
              title: "Can't compare this file",
              description: "The other version isn't text, so it can't be shown here.",
            }),
          );
          return;
        }
        setState({
          status: "ready",
          remoteFile: file,
          remoteText: decodeFileText(file.bytes),
          error: null,
        });
      },
      (readError: unknown) => {
        if (requestRef.current !== requestId) return;
        const raw = readError instanceof Error ? readError.message : String(readError);
        setState(unavailableState(explainFileReadError(raw)));
      },
    );
    // `version` is a dependency (not just `path`) so a SECOND conflict on
    // the same path — a resolution attempt that itself lands another
    // conflict — re-fetches rather than reusing the first version's read.
  }, [readClient, workspaceRoot, path, version]);

  return state;
}
