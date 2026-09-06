/**
 * Native editing and save state for a single open text file (T35A3,
 * plan.md §6/§7/§9/§12.4, depends on T35A2).
 *
 * Sibling of `file-view-model.ts`'s read controller: same shape
 * (`getState`/`subscribe`, a `Clock`-raced timeout, one named state per
 * distinct failure) but for the edit buffer and its save request. This
 * module imports neither React, React Native, Expo, DOM types, nor
 * browser globals — plain, RN-free orchestration over the injected
 * `FileBrowserClient.writeFile` (`file-browser-client.ts`), testable
 * directly in this workspace's plain `vitest`, exactly like every other
 * `*-model.ts` in this feature.
 *
 * Writes go through the same daemon RPC as reads: T35A2's `readFile`
 * half of `file_explorer_request`/`file_explorer_response` has a write
 * counterpart already in `packages/protocol/src/messages.ts` —
 * `FileWriteRequestSchema`/`FileWriteResultSchema` (`fs.file.write.
 * request`/`fs.file.write.response`) — and `packages/client/src/
 * daemon-client.ts`'s `DaemonClient.writeFile(input)` already
 * implements it (whole-file replace, with `expectedModifiedAt`/
 * `expectedRevision` optimistic-concurrency guards, resolving with
 * `"written"`/`"conflict"`/`"error"` rather than throwing for a
 * business-level failure). No wire shape is invented here; see
 * `file-browser-client.ts`'s "File write (T35A3)" section for the
 * ported types.
 *
 * ---------------------------------------------------------------------
 * Native editing limits (this task's real content)
 * ---------------------------------------------------------------------
 * `apps/web`'s CodeMirror editor has no analogous ceiling of its own
 * (see `apps/web/src/features/files/use-file-editor.ts`) because a
 * desktop browser tab has enough memory and layout headroom that the
 * shared read-side `MAX_PREVIEWABLE_FILE_BYTES` cap is the only limit
 * that matters. Android's editing surface is a plain, controlled
 * `TextInput` (`ui/primitives/TextArea.tsx`) — every keystroke re-runs
 * `onChangeText` over the *entire* buffer, and RN's bridge/Fabric
 * layout pass re-measures the whole multiline text on each change. That
 * is a materially different cost profile from the read view's one-time
 * decode-and-tokenize pass, so this task sets its own, smaller,
 * explicit ceilings rather than reusing `MAX_PREVIEWABLE_FILE_BYTES`:
 *
 *   - `MAX_EDITABLE_FILE_BYTES` — total buffer size. Well under the
 *     daemon's own `MAX_EDITABLE_FILE_BYTES` (`packages/server/src/
 *     server/file-explorer/service.ts`, also 1 MiB) and under the read
 *     view's `MAX_PREVIEWABLE_FILE_BYTES`, so this is always the
 *     binding constraint on Android — a file too big to edit here was
 *     always previewable first, never a surprise jump from "you can see
 *     this" to "you can't touch this".
 *   - `MAX_EDITABLE_LINE_LENGTH` — longest single line. A large file
 *     can still comprise many short lines and stay well under the byte
 *     cap; a *single* very long line (minified JS/JSON/CSS on one line)
 *     is the case that actually hangs RN's text layout, independent of
 *     total size, so it gets its own named ceiling and its own
 *     explanation rather than folding into the byte check.
 *
 * Both are surfaced by `describeFileEditLimits()` — rendered by
 * `files-screen.tsx` next to the edit affordance on every text file,
 * before an edit is ever started — and enforced by
 * `explainFileEditLimitRefusal`, called twice: once against the loaded
 * file (gates whether "Edit" is offered at all — refuses *before* the
 * user starts typing, this task's "stated explicitly rather than
 * failing silently" criterion) and again inside `save()` against the
 * live buffer (a paste or enough typing can grow a buffer that started
 * under the ceiling past it; `save()` refuses locally, without a
 * daemon round trip, and leaves the buffer untouched — the same
 * "explicit, not silent" contract, not a second code path).
 *
 * ---------------------------------------------------------------------
 * T153: a pinned write basis, and a rebuild that resumes instead of discards
 * ---------------------------------------------------------------------
 * `apps/web/src/features/files/use-file-editor.ts` (T41A1b) pins the
 * optimistic-concurrency basis (`modifiedAt`/`revision`) at
 * `startEditing`, not read live off `file` at save time — a live read
 * would let a mid-edit re-read of the same path (a reconnect-driven
 * reload, T35A2's post-save `retry()`) silently adopt the daemon's
 * newest version as the write's "expected" basis, walking straight past
 * the conflict check instead of tripping it.
 *
 * Android's starting point had NEITHER half of that fix, and its own
 * failure shape was worse: `files-screen.tsx`'s `FileEditableBody`
 * builds a fresh `FileEditController` in a `useMemo` keyed on
 * `file`/`content` (see that component's doc). Since this module's
 * controller is a plain external object (no React state of its own to
 * survive a `useMemo` recompute), a mid-edit re-read that produces a new
 * `file` object — same path, different `modifiedAt`/`revision` — used to
 * mean the OLD controller (buffer, mode, error, all of it) was simply
 * discarded and a brand new one built in `baseState`, dropping the user
 * silently back to read mode with whatever they had typed gone. That is
 * a materially worse outcome than web's original bug: web at least kept
 * typing visible and would have overwritten silently; Android lost the
 * typing outright, with the file's own bytes intact but nothing to show
 * for the edit.
 *
 * Two changes close both gaps, without needing this controller to
 * survive as the same object across a rebuild:
 *   - `save()` writes against `basis` — captured once, in `startEditing`,
 *     from the `file` in scope AT THAT MOMENT — never the live `file`
 *     closed over by this particular controller instance.
 *   - `resumeSession` (`FileEditControllerOptions`): when the CALLER
 *     knows a controller it is about to replace was mid-edit for the
 *     SAME path (`files-screen.tsx` tracks this with a ref, since this
 *     module has no notion of "the previous controller" on its own), it
 *     hands this constructor that controller's `getSession()` snapshot
 *     — `{ buffer, error, basis }` — and the new controller starts
 *     already in `"edit"` mode with that buffer, that error, and that
 *     SAME pinned basis, rather than `baseState(content)`. `remoteChanged`
 *     is computed fresh against the new `file`, so the user sees the
 *     "this changed underneath you" notice even though the object that
 *     detected it isn't the object that started the edit.
 */
import type { Clock } from "@picompanion/frontend-core";

import {
  FILE_WRITE_NOT_CONNECTED,
  FILE_WRITE_TIMEOUT,
  explainFileWriteError,
  explainFileWriteResult,
  type FileBrowserClient,
  type FileBrowserErrorExplanation,
  type FileReadResult,
  type FileWriteInput,
  type FileWriteResult,
} from "./file-browser-client.js";
import { createFilesClock } from "./files-model.js";

/**
 * UTF-8 byte length of a string, without relying on a `TextEncoder`
 * global — Hermes does not guarantee one across every supported
 * Expo/RN version (same reasoning as `file-syntax-highlight.ts`'s
 * `decodeUtf8Bytes` and `../extensions/registry.ts`'s private
 * `utf8ByteLength`; this is a small, self-contained copy of the same
 * well-known algorithm, not a shared import — `extensions/` is a
 * sibling feature's unowned directory this task must not reach into).
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    let codePoint = value.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < value.length) {
      const low = value.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = (codePoint - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        i += 1;
      }
    }
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/** The longest line's character length in `content` (splitting on `\n`; a lone `\r` is not treated as a break, matching `file-syntax-highlight.ts`'s line handling). `0` for empty content. */
export function longestLineLength(content: string): number {
  let longest = 0;
  for (const line of content.split("\n")) {
    if (line.length > longest) longest = line.length;
  }
  return longest;
}

/** See this module's doc for why this is Android-specific and deliberately smaller than `MAX_PREVIEWABLE_FILE_BYTES`. */
export const MAX_EDITABLE_FILE_BYTES = 256 * 1024;

/** See this module's doc. */
export const MAX_EDITABLE_LINE_LENGTH = 5_000;

export interface FileEditLimits {
  readonly maxFileBytes: number;
  readonly maxLineLength: number;
}

export const FILE_EDIT_LIMITS: FileEditLimits = {
  maxFileBytes: MAX_EDITABLE_FILE_BYTES,
  maxLineLength: MAX_EDITABLE_LINE_LENGTH,
};

/**
 * The always-visible limits sentence `files-screen.tsx` renders next to
 * the edit affordance for every text file, before an edit ever starts —
 * this task's "limits stated explicitly rather than failing silently"
 * criterion in its purest form: the ceiling is on screen whether or not
 * this particular file happens to be near it.
 */
export function describeFileEditLimits(limits: FileEditLimits = FILE_EDIT_LIMITS): string {
  return `Editing here works for plain-text files up to ${Math.round(limits.maxFileBytes / 1024)} KB, with no single line over ${limits.maxLineLength.toLocaleString()} characters.`;
}

export interface FileEditLimitRefusal extends FileBrowserErrorExplanation {
  readonly reason: "too-large" | "line-too-long";
}

/**
 * Checks `content` (already-decoded file text) against `limits`.
 * Returns `null` when editing is allowed. Called both pre-edit (against
 * the freshly-read file, gating the "Edit" affordance itself) and
 * inside `save()` (against the live buffer, in case typing grew it past
 * the ceiling) — see this module's doc for why both call sites matter.
 */
export function explainFileEditLimitRefusal(
  content: string,
  limits: FileEditLimits = FILE_EDIT_LIMITS,
): FileEditLimitRefusal | null {
  const byteLength = utf8ByteLength(content);
  if (byteLength > limits.maxFileBytes) {
    return {
      reason: "too-large",
      title: "Too large to edit here",
      description: `This file is ${Math.round(byteLength / 1024)} KB, over the ${Math.round(limits.maxFileBytes / 1024)} KB editing limit. You can still view it, just not edit it on this device.`,
    };
  }
  const longest = longestLineLength(content);
  if (longest > limits.maxLineLength) {
    return {
      reason: "line-too-long",
      title: "A line in this file is too long to edit here",
      description: `Its longest line is ${longest.toLocaleString()} characters, over the ${limits.maxLineLength.toLocaleString()}-character editing limit. You can still view it, just not edit it on this device.`,
    };
  }
  return null;
}

export type FileEditMode = "read" | "edit" | "saving";

export interface FileEditErrorState extends FileBrowserErrorExplanation {
  /** `true` for a lost optimistic-concurrency race or a deleted file (`FileWriteResult` `"conflict"`); `false` for every other save failure. */
  isConflict: boolean;
  /** Set only when `save()` refused locally against a live buffer that grew past `explainFileEditLimitRefusal`'s ceiling (no RPC attempted); absent for every daemon-originated failure. */
  reason?: FileEditLimitRefusal["reason"];
}

export interface FileEditState {
  readonly mode: FileEditMode;
  /** The in-progress edit buffer. Empty and meaningless while `mode === "read"`; populated from the file's decoded text on `startEditing` and preserved across every failed save. */
  readonly buffer: string;
  readonly error: FileEditErrorState | null;
  /**
   * Whether — and why not — this file can be edited at all, decided
   * once from the loaded file and never cleared by typing or a failed
   * save (only a fresh `file` — a new read — recomputes it). `null`
   * means editing is allowed.
   */
  readonly limitRefusal: FileEditLimitRefusal | null;
  /**
   * T153: true once the `file` this controller was built against carries
   * a different `modifiedAt`/`revision` than the pinned `basis` a
   * mid-edit session began from — either detected directly (this
   * controller's own `file` disagrees with its own `basis`) or carried
   * forward from a `resumeSession` snapshot recomputed against a fresh
   * `file`. Purely informational, matching web's `remoteChanged` (see
   * `use-file-editor.ts`): `save()` never reads this, it always writes
   * against `basis`, so a missed notice still cannot silently overwrite
   * — the daemon's own conflict check is the backstop. Sticky until the
   * edit session ends (`save` succeeds or `cancelEditing` runs).
   */
  readonly remoteChanged: boolean;
}

function baseState(content: string): FileEditState {
  return {
    mode: "read",
    buffer: "",
    error: null,
    limitRefusal: explainFileEditLimitRefusal(content),
    remoteChanged: false,
  };
}

/** The optimistic-concurrency basis `save()` writes against — pinned once, at `startEditing` (T153, matching web's `use-file-editor.ts`). */
export interface EditBasis {
  readonly modifiedAt: string;
  readonly revision: string | undefined;
}

/**
 * A mid-edit session snapshot (T153): what `files-screen.tsx` reads off
 * a controller it is about to replace (via `getSession()`) and hands to
 * the replacement's `resumeSession` option, so a rebuild forced by a
 * fresh `file`/`content` read carries the buffer, any standing error,
 * and — critically — the ORIGINAL pinned basis forward instead of
 * starting over from `baseState`. `null` whenever the controller being
 * replaced was in `"read"` mode: there is nothing to resume.
 */
export interface FileEditSession {
  readonly buffer: string;
  readonly error: FileEditErrorState | null;
  readonly basis: EditBasis;
}

export const DEFAULT_FILE_EDIT_TIMEOUT_MS = 15_000;

/**
 * Races `client.writeFile(input)` against `clock`'s timer, exactly like
 * `file-view-model.ts`'s `readFileWithTimeout` and `files-model.ts`'s
 * `listDirectoryWithTimeout`. A missing `writeFile` (an older,
 * read-only `FileBrowserClient` test double, or a real client not yet
 * wired to a daemon) rejects immediately with `FILE_WRITE_NOT_CONNECTED`
 * — no timer, no RPC attempted. A connection dropped mid-save surfaces
 * the same way any other transport failure does: the underlying
 * `writeFile` promise rejects, this passes that rejection through
 * unchanged (never converts it to `FILE_WRITE_TIMEOUT`, which is
 * reserved for the clock firing first).
 */
export function writeFileWithTimeout(
  client: FileBrowserClient,
  input: FileWriteInput,
  clock: Clock,
  timeoutMs: number = DEFAULT_FILE_EDIT_TIMEOUT_MS,
): Promise<FileWriteResult> {
  return new Promise((resolve, reject) => {
    const writeFile = client.writeFile;
    if (!writeFile) {
      reject(new Error(FILE_WRITE_NOT_CONNECTED));
      return;
    }

    let settled = false;
    const timer = clock.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(FILE_WRITE_TIMEOUT));
    }, timeoutMs);

    writeFile(input).then(
      (result) => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export interface FileEditControllerOptions {
  client: FileBrowserClient;
  /** The daemon-side workspace root this write is scoped to (protocol `cwd`). */
  workspaceRoot: string;
  /** The currently loaded, read-only file (`file-view-model.ts`'s `FileViewState.file` once `status === "ready"`). */
  file: FileReadResult;
  /** The file's already-decoded text (`decodeUtf8Bytes(file.bytes)`) — the caller already computed this to render the read-only view, so this controller does not redecode it. */
  content: string;
  /** Reloads `file` from the daemon; called once a save is confirmed written. The daemon is authoritative (plan.md §12.5): a successful save does not locally echo the new bytes into view — the caller re-reads instead (`file-view-model.ts`'s `FileViewController.retry`). */
  onSaved: () => void;
  clock?: Clock;
  timeoutMs?: number;
  /**
   * T153: a mid-edit session snapshot carried forward from the
   * controller this one replaces, when `files-screen.tsx` has determined
   * that controller was built for the SAME path. When present and
   * non-null, this controller starts already in `"edit"` mode with
   * `resumeSession.buffer`/`.error` and pins `basis` to
   * `resumeSession.basis` — never the live `file`/`content` this
   * instance was otherwise constructed with — so a rebuild triggered by
   * a fresh daemon read (reconnect, `retry()`) neither discards the
   * user's typing nor silently re-bases the eventual write on the new
   * read. `remoteChanged` is recomputed against this controller's own
   * `file` regardless of what the snapshot said, since the snapshot may
   * predate the very read that produced this `file`.
   */
  resumeSession?: FileEditSession | null;
}

export interface FileEditController {
  getState: () => FileEditState;
  subscribe: (listener: (state: FileEditState) => void) => () => void;
  /** Enters edit mode, seeding the buffer from the loaded file's decoded content. No-op when `limitRefusal` is set. */
  startEditing: () => void;
  /** Discards the buffer and returns to read mode. No-op once a save is in flight. */
  cancelEditing: () => void;
  /** Updates the buffer while editing. No-op outside edit mode. */
  updateBuffer: (next: string) => void;
  /**
   * Saves the current buffer. No-op unless `mode === "edit"`. Every
   * failure path — a client-side limit refusal, a rejected RPC
   * (not connected, timed out, a dropped connection), or a resolved
   * `"conflict"`/`"error"` result — returns the controller to
   * `mode: "edit"` with the same `buffer` untouched and `error` set to
   * explain what happened. The buffer is never cleared except by a
   * confirmed `"written"` result or an explicit `cancelEditing()`.
   */
  save: () => void;
  /**
   * T153: a snapshot of this controller's in-progress edit — `null`
   * unless `mode` is `"edit"` or `"saving"`. `files-screen.tsx` reads
   * this off the controller it is about to replace (a `useMemo`
   * recompute forced by a fresh `file`/`content`) and passes it as the
   * replacement's `resumeSession`, so the buffer and the pinned write
   * basis survive a rebuild instead of being discarded with it.
   */
  getSession: () => FileEditSession | null;
}

/**
 * Builds a `FileEditController` — the injected-fake-daemon-RPC seam
 * `file-edit-model.test.ts` drives directly to prove the pre-edit limit
 * gate, a successful save round trip, and every named failure
 * (limit-exceeded buffer, not connected, timed out, conflict, oversized
 * daemon-side, binary, permission denied) as real state transitions
 * that always preserve the buffer, with no emulator and no
 * `react-native` import.
 */
export function createFileEditController(options: FileEditControllerOptions): FileEditController {
  const { client, workspaceRoot, file, content, onSaved } = options;
  const clock = options.clock ?? createFilesClock();
  const timeoutMs = options.timeoutMs ?? DEFAULT_FILE_EDIT_TIMEOUT_MS;
  const resumeSession = options.resumeSession ?? null;

  // T153: the write basis, pinned once — either freshly, in
  // `startEditing` below, or carried forward from a `resumeSession` this
  // controller was built to replace mid-edit. Never read live off `file`
  // inside `save()`.
  let basis: EditBasis | null = resumeSession ? resumeSession.basis : null;

  let state: FileEditState = resumeSession
    ? {
        mode: "edit",
        buffer: resumeSession.buffer,
        error: resumeSession.error,
        limitRefusal: explainFileEditLimitRefusal(content),
        // Recomputed against THIS controller's own `file`, not copied
        // from the snapshot — the snapshot may predate the read that
        // produced `file`, and a `resumeSession` only exists at all
        // because `files-screen.tsx` is handing this controller a
        // fresh read for the same path, so this is exactly the moment
        // that comparison matters.
        remoteChanged:
          resumeSession.basis.modifiedAt !== file.modifiedAt ||
          resumeSession.basis.revision !== file.revision,
      }
    : baseState(content);
  const listeners = new Set<(state: FileEditState) => void>();

  const emit = () => {
    for (const listener of listeners) listener(state);
  };

  const startEditing = () => {
    if (state.limitRefusal) return;
    basis = { modifiedAt: file.modifiedAt, revision: file.revision };
    state = { ...state, mode: "edit", buffer: content, error: null, remoteChanged: false };
    emit();
  };

  const cancelEditing = () => {
    if (state.mode === "saving") return;
    basis = null;
    state = { ...baseState(content), limitRefusal: state.limitRefusal };
    emit();
  };

  const updateBuffer = (next: string) => {
    if (state.mode !== "edit") return;
    state = { ...state, buffer: next, error: null };
    emit();
  };

  const save = () => {
    if (state.mode !== "edit") return;
    const buffer = state.buffer;

    const overLimit = explainFileEditLimitRefusal(buffer);
    if (overLimit) {
      state = {
        ...state,
        mode: "edit",
        buffer,
        error: { ...overLimit, isConflict: false },
      };
      emit();
      return;
    }

    state = { ...state, mode: "saving", buffer, error: null };
    emit();

    // T153: `expectedModifiedAt`/`expectedRevision` come from `basis` —
    // pinned at `startEditing` (or carried from `resumeSession`) — never
    // from the live `file` closed over by this controller instance. The
    // `file.modifiedAt`/`file.revision` fallback only covers a `save()`
    // somehow reached with `basis` still null, which the `mode !==
    // "edit"` guard above should already make unreachable.
    writeFileWithTimeout(
      client,
      {
        cwd: workspaceRoot,
        path: file.path,
        content: buffer,
        expectedModifiedAt: basis ? basis.modifiedAt : file.modifiedAt,
        expectedRevision: basis ? basis.revision : file.revision,
      },
      clock,
      timeoutMs,
    ).then(
      (result) => {
        const explanation = explainFileWriteResult(result);
        if (explanation) {
          state = {
            ...state,
            mode: "edit",
            buffer,
            error: { ...explanation, isConflict: result.status === "conflict" },
          };
          emit();
          return;
        }
        basis = null;
        state = baseState(content);
        emit();
        onSaved();
      },
      (error: unknown) => {
        const raw = error instanceof Error ? error.message : String(error);
        state = {
          ...state,
          mode: "edit",
          buffer,
          error: { ...explainFileWriteError(raw), isConflict: false },
        };
        emit();
      },
    );
  };

  const getSession = (): FileEditSession | null => {
    if (state.mode === "read" || !basis) return null;
    return { buffer: state.buffer, error: state.error, basis };
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    startEditing,
    cancelEditing,
    updateBuffer,
    save,
    getSession,
  };
}
