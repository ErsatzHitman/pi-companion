import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentTimelineImageRef } from "@picompanion/protocol/agent-types";

/**
 * T283: serves attachment bytes to a remote client, capability-scoped.
 *
 * **Why this exists.** `AgentTimelineImageRef` (agent-types.ts) carries a
 * `path` into a temp directory the daemon materialized bytes into
 * (`../agent/providers/provider-image-output.ts`'s `materializeProviderImage`)
 * — never inline bytes. Neither existing file RPC can serve it:
 * `readFile`/`file_explorer_request` and
 * `requestDownloadToken`/`file_download_token_request` both resolve a path
 * *relative to a workspace `cwd`* through `file-explorer/service.ts`'s
 * `resolveScopedPath`, which throws for anything outside that workspace
 * root — and an attachment path is outside every workspace root by
 * construction. plan.md §12.4's "Attachment bytes" paragraph records this as
 * the capability this module closes.
 *
 * **The design, chosen and argued against the alternative by measurement.**
 * Two shapes were possible: (1) serve by an opaque id the daemon resolves
 * against its own record, never trusting a client-supplied path; or (2)
 * serve by path, gated only by a closed allowlist of roots resolved with
 * `resolveScopedPath`'s realpath-then-containment discipline.
 *
 * (2) alone cannot satisfy "the caller must already have access to the
 * session the attachment belongs to" for this daemon's actual layout,
 * measured directly rather than assumed: `provider-image-output.ts`'s
 * `getMaterializedImageAttachmentDir` returns *one* `mkdtemp` directory,
 * reused via a module-level variable for the lifetime of the daemon
 * process — every agent's materialized images live side by side in that
 * same directory, distinguished only by a content-hash filename. A root
 * containment check has no way to tell "this path is under the attachment
 * root" apart from "this path belongs to the session asking for it" — those
 * are different questions, and (2) can only answer the first. Answering the
 * second requires cross-referencing the requester's own agent timeline
 * regardless of which design is chosen, which is exactly what (1)'s
 * "resolve against the daemon's own record" already does — so (1) does not
 * cost more than (2) once the mandatory tenancy check is accounted for, and
 * it has the smaller blast radius: a bug in a root-containment check widens
 * exposure to every image the daemon has ever materialized (guessable
 * cross-session by filename alone), while a bug in the membership check
 * here is still caught by the containment check kept below as a second
 * layer — but, per the corrected note in "Chosen: (1)" below, that second
 * layer is defense-in-depth, not an equal partner capable of failing closed
 * on its own.
 *
 * **Chosen: (1).** `resolveAttachmentForDownload` never resolves an
 * attacker-shaped path — it looks up `request.agentId`'s own recorded
 * `AgentTimelineImageRef`s (supplied by the caller via
 * `AttachmentTimelineLookup`, backed in production by
 * `AgentManager.getTimeline`) and refuses unless `request.path` is an
 * *exact* match for one already recorded there. Only once that membership
 * check passes does it also apply root containment (below), kept as
 * defense-in-depth.
 *
 * **The two layers are not equal partners; membership is load-bearing.**
 * CORRECTED (T288, filed by the P9-P merge gate): this section used to claim
 * the two layers "fail closed independently" and that "a bug in either layer
 * alone still fails closed". That is false, proven by execution rather than
 * reasoned: `resolveWithinAttachmentTempRoot` admits *any* first-level
 * `os.tmpdir()` child whose name starts with `ATTACHMENT_TEMP_DIR_PREFIX`,
 * and the OS temp root is world-writable, so anything with local execution
 * can create `tmpdir()/paseo-attachments-EVIL/x.png` itself and have it pass
 * containment outright — containment is not, on its own, a closed door. It
 * is not exploitable today only because membership is what actually holds
 * this shut: `materializeProviderImage`
 * (`../agent/providers/provider-image-output.ts`) is the sole producer of
 * `AgentTimelineImageRef` in this tree (verified by search), so nothing
 * today ever records an attacker-influenced path onto a real agent's
 * timeline for membership to match against. If that ever stops being true,
 * containment would not save this module by itself. State it precisely:
 * membership is load-bearing; containment is defense-in-depth, not an equal
 * partner. (Tightening containment to a set of directories the daemon
 * itself created and remembers was considered and rejected: that means
 * retaining state across process restarts, which this design deliberately
 * avoids, for a check that is already backstopped by the load-bearing
 * membership layer above it.)
 *
 * **What is out of scope, and why.** `uploaded_file` attachments
 * (`UploadedFileAttachmentSchema`, `packages/protocol/src/messages.ts`) are
 * not covered: `renderPromptAttachmentAsText`
 * (`../agent/prompt-attachments.ts`) always renders them as descriptive text
 * to the agent, never as an `AgentTimelineImageRef`, and no `AgentTimelineItem`
 * variant retains attachment metadata at all — so there is no persisted,
 * client-visible record of one once the daemon has consumed it into a
 * prompt, on any surface, even the device that sent it. Serving their bytes
 * would need a protocol and history-mapper change this task's scope does
 * not grant (see the T283 report this module's introducing commit
 * describes) rather than a serving capability, so it is filed as a gap
 * rather than half-built here.
 */

/** The one prefix every attachment temp directory is created under
 * (`provider-image-output.ts`'s `PROVIDER_IMAGE_ATTACHMENT_DIR_PREFIX`,
 * re-declared here rather than imported so this module's containment check
 * does not depend on that module's live, lazily-created directory handle —
 * it only needs to know the shape of the root, not which instance of it is
 * currently live). */
export const ATTACHMENT_TEMP_DIR_PREFIX = "paseo-attachments-";

/**
 * Plaintext ceiling for one `file_download_bytes` attachment chunk — the
 * same 64KB Cloudflare WS frame margin
 * `file-explorer/service.ts`'s `MAX_DOWNLOADABLE_CHUNK_BYTES` enforces for
 * the workspace path (which mirrors
 * `@picompanion/protocol`'s `MAX_FILE_DOWNLOAD_BYTES_LENGTH`).
 * Re-declared here so the attachment chunk read does not import the
 * workspace explorer service for a single constant.
 */
export const MAX_ATTACHMENT_CHUNK_BYTES = 65536;

export interface AttachmentTimelineLookup {
  /** Every image reference recorded anywhere in `agentId`'s own persisted
   * timeline, or `null` when the agent does not exist / could not be
   * loaded. This is the daemon's own record of what belongs to this
   * session — `resolveAttachmentForDownload` never trusts the requested
   * path itself, only whether it exactly matches something already
   * written here. */
  getAgentTimelineImages(agentId: string): readonly AgentTimelineImageRef[] | null;
}

export interface ResolvedAttachmentFile {
  absolutePath: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export type AttachmentAccessResult =
  | { status: "ok"; file: ResolvedAttachmentFile }
  | { status: "not_found" }
  | { status: "error"; error: string };

export async function resolveAttachmentForDownload(
  request: { agentId: string; path: string },
  lookup: AttachmentTimelineLookup,
): Promise<AttachmentAccessResult> {
  const images = lookup.getAgentTimelineImages(request.agentId);
  if (!images) {
    return { status: "not_found" };
  }

  const ref = images.find((image) => image.path === request.path);
  if (!ref) {
    return { status: "not_found" };
  }

  try {
    const containment = await resolveWithinAttachmentTempRoot(request.path);
    if (!containment.ok) {
      return { status: "not_found" };
    }

    const stats = await fs.stat(containment.realPath);
    if (!stats.isFile()) {
      return { status: "not_found" };
    }

    return {
      status: "ok",
      file: {
        absolutePath: containment.realPath,
        fileName: path.basename(containment.realPath),
        mimeType: ref.mimeType,
        size: stats.size,
      },
    };
  } catch (error) {
    if (isMissingEntryError(error)) {
      return { status: "not_found" };
    }
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

export interface AttachmentFileChunk {
  /** The requested attachment path, echoed for envelope attribution. */
  path: string;
  fileName: string;
  mimeType: string;
  size: number;
  offset: number;
  bytes: Buffer;
  eof: boolean;
}

export interface ReadAttachmentChunkParams {
  agentId: string;
  path: string;
  offset: number;
  length: number;
}

/**
 * Reads one `length`-byte slice of an agentId-scoped attachment starting
 * at `offset`, for the relay `file_download_bytes` chunk loop. Reuses
 * `resolveAttachmentForDownload` — the SAME membership + containment
 * access check the `attachment_download_token_request` path uses — so no
 * second authorization rule is invented here; a path that would not get a
 * token can never get bytes either. Throws `Attachment not found` when
 * the lookup refuses (the token path's own not-found string, so the
 * chunk handler's error envelope matches it), and `Invalid
 * offset`/`Invalid length` for out-of-range slicing, mirroring
 * `file-explorer/service.ts`'s `readDownloadableFileChunk` bounds.
 * Callers convert every throw into a `file_download_bytes_response`
 * error envelope and never let it escape.
 */
export async function readAttachmentFileChunk(
  params: ReadAttachmentChunkParams,
  lookup: AttachmentTimelineLookup,
): Promise<AttachmentFileChunk> {
  const { agentId, path: requestedPath, offset, length } = params;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("Invalid offset");
  }
  if (!Number.isInteger(length) || length < 1 || length > MAX_ATTACHMENT_CHUNK_BYTES) {
    throw new Error("Invalid length");
  }
  const result = await resolveAttachmentForDownload({ agentId, path: requestedPath }, lookup);
  if (result.status === "not_found") {
    throw new Error("Attachment not found");
  }
  if (result.status === "error") {
    throw new Error(result.error);
  }
  const handle = await fs.open(result.file.absolutePath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new Error("Requested path is not a file");
    }
    const size = stats.size;
    if (offset >= size) {
      return {
        path: requestedPath,
        fileName: result.file.fileName,
        mimeType: result.file.mimeType,
        size,
        offset,
        bytes: Buffer.alloc(0),
        eof: true,
      };
    }
    const toRead = Math.min(length, size - offset);
    const buffer = Buffer.alloc(toRead);
    const { bytesRead } = await handle.read(buffer, 0, toRead, offset);
    const bytes = bytesRead < toRead ? buffer.subarray(0, bytesRead) : buffer;
    return {
      path: requestedPath,
      fileName: result.file.fileName,
      mimeType: result.file.mimeType,
      size,
      offset,
      bytes,
      eof: offset + bytesRead >= size,
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

interface AttachmentRootContainment {
  ok: boolean;
  realPath: string;
}

/**
 * Realpath-then-containment, the same discipline
 * `file-explorer/service.ts`'s `resolveScopedPath` applies for a workspace
 * root: resolving through any symlink in the chain (including a symlink
 * substituted in at the exact recorded path after the fact) and rejecting
 * the result unless it lands inside a `paseo-attachments-*` directory
 * directly under the OS temp root. This is the second, independent layer.
 * It refuses a `..`-shaped path that resolves ANYWHERE ELSE, and a
 * symlink-out just as directly: the realpath of the swapped-in symlink's
 * target fails containment even though the request path string is unchanged.
 *
 * CORRECTED at the P9-P merge gate: this said a `..`-shaped path "cannot
 * resolve into the temp root". It can — a request whose literal string goes
 * up out of an attachment directory and straight back down into the same one
 * realpaths to a legitimate in-root file and is served (measured, not
 * reasoned). That is harmless, because membership already required the exact
 * string to be on the agent's own timeline, but the clause as written was
 * false. The underlying reason is worth stating: `resolveScopedPath` checks
 * containment BOTH before and after `realpath`; this function only checks
 * after, so "the same discipline `resolveScopedPath` applies" describes a
 * superset of what is implemented here.
 */
async function resolveWithinAttachmentTempRoot(
  candidatePath: string,
): Promise<AttachmentRootContainment> {
  const tmpRoot = await fs.realpath(os.tmpdir());
  const realPath = await fs.realpath(candidatePath);
  const relativeToTmpRoot = path.relative(tmpRoot, realPath);
  const segments = relativeToTmpRoot.split(path.sep);
  const [firstSegment] = segments;

  const ok =
    relativeToTmpRoot !== "" &&
    !relativeToTmpRoot.startsWith("..") &&
    !path.isAbsolute(relativeToTmpRoot) &&
    segments.length === 2 &&
    firstSegment !== undefined &&
    firstSegment.startsWith(ATTACHMENT_TEMP_DIR_PREFIX);

  return { ok, realPath };
}

function isMissingEntryError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}
