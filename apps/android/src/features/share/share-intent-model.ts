/**
 * Share-intent classification (T36C, plan.md §9.3's share-target entry).
 *
 * Android delivers an incoming "share to this app" request as an OS
 * `Intent` (`ACTION_SEND`/`ACTION_SEND_MULTIPLE`) carrying a MIME
 * `type`, an optional `EXTRA_TEXT` string, and/or an optional
 * `EXTRA_STREAM` file. Nothing in this repository can receive that
 * Intent directly yet — see `share-intent-port.ts`'s doc comment — so
 * this module starts one step downstream, at `RawShareIntent`: a
 * plain, already-parsed description of whatever the OS handed over.
 * Everything here is pure and RN-free; a future native listener's only
 * job is to fill in a `RawShareIntent` and hand it to
 * `classifyShareIntent`.
 *
 * **Allowlist, not a denylist** (this task's brief): `classifyShareIntent`
 * only ever accepts the three content kinds enumerated in
 * `ClassifiedShareContent` below. Anything else — an unrecognised
 * `action`, a `mimeType` outside `ACCEPTED_FILE_MIME_TYPES`, a file
 * over `MAX_SHARE_FILE_BYTES`, empty text — is refused with a named
 * `ShareRefusalReason`, never silently dropped or guessed at.
 *
 * Shared content is untrusted input from another app. This module never
 * logs it (no `console.*` anywhere in this feature), never derives a
 * URL or query string from it, and never writes it anywhere itself —
 * classification only ever returns data for a caller to place through
 * the sanctioned `DraftStore`/`OutboxController` seam in
 * `share-draft-controller.ts`.
 */

import { security } from "@picompanion/frontend-core";

/** The only two Android actions a share intent can arrive as. `SEND_MULTIPLE` is refused — see `"unsupported-action"`. */
export type ShareIntentAction = "SEND" | "SEND_MULTIPLE" | (string & {});

/** A file payload as the OS reported it. `uri` is an opaque `content://` handle — never read or logged here. */
export interface RawShareIntentFile {
  name: string;
  mimeType: string;
  sizeBytes: number;
  uri: string;
}

/** Already-parsed description of an incoming OS share intent — see this module's doc comment. */
export interface RawShareIntent {
  action: ShareIntentAction;
  /** MIME type the OS reports for the shared payload. */
  mimeType: string;
  /** `EXTRA_TEXT`, present for text/URL shares. */
  text?: string;
  /** `EXTRA_STREAM`, present for file shares. */
  file?: RawShareIntentFile;
}

/** File MIME types this app accepts from a share intent — the allowlist. */
export const ACCEPTED_FILE_MIME_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/markdown",
  "text/csv",
  "application/json",
];

/**
 * Per-file size bound for a shared file, matching
 * `composer/attachment-model.ts`'s `DEFAULT_ATTACHMENT_LIMITS
 * .maxBytesPerFile` exactly: a file this module would refuse is one
 * the composer's own attachment staging would refuse too, so a share
 * can never sneak a file past that ceiling through a different door.
 */
export const MAX_SHARE_FILE_BYTES = 25 * 1024 * 1024;

/** Bare-string URL match: the whole trimmed text is an http(s) URL, nothing else. */
const STRICT_URL_PATTERN = /^https?:\/\/\S+$/i;

export type ShareContentKind = "text" | "url" | "file";

/** Accepted, classified share content — the allowlist's output shape. */
export type ClassifiedShareContent =
  | { kind: "text"; text: string; looksSecretShaped: boolean }
  | { kind: "url"; url: string }
  | { kind: "file"; name: string; mimeType: string; sizeBytes: number; uri: string };

export type ShareRefusalReason =
  | "unsupported-action"
  | "unsupported-type"
  | "empty-content"
  | "file-too-large";

export interface ShareRefusal {
  accepted: false;
  reason: ShareRefusalReason;
  /** Short, user-facing explanation — plan.md's "explain the boundary" convention (see `attachment-model.ts`). */
  explanation: string;
}

export interface ShareAcceptance {
  accepted: true;
  content: ClassifiedShareContent;
}

export type ShareClassification = ShareAcceptance | ShareRefusal;

function refuse(reason: ShareRefusalReason, explanation: string): ShareRefusal {
  return { accepted: false, reason, explanation };
}

/**
 * Classifies a `RawShareIntent` against this module's allowlist.
 * Never throws; every input maps to either an accepted
 * `ClassifiedShareContent` or a named `ShareRefusalReason`.
 */
export function classifyShareIntent(intent: RawShareIntent): ShareClassification {
  if (intent.action !== "SEND") {
    return refuse(
      "unsupported-action",
      intent.action === "SEND_MULTIPLE"
        ? "Sharing multiple items at once isn't supported yet — share one at a time."
        : `"${intent.action}" isn't a share action this app accepts.`,
    );
  }

  if (intent.file) {
    if (!ACCEPTED_FILE_MIME_TYPES.includes(intent.file.mimeType)) {
      return refuse(
        "unsupported-type",
        `Files of type "${intent.file.mimeType}" aren't supported. Accepted types: images, PDF, Markdown, CSV, and JSON.`,
      );
    }
    if (intent.file.sizeBytes > MAX_SHARE_FILE_BYTES) {
      return refuse(
        "file-too-large",
        `That file is larger than the ${Math.floor(MAX_SHARE_FILE_BYTES / (1024 * 1024))} MB limit for a shared file.`,
      );
    }
    return {
      accepted: true,
      content: {
        kind: "file",
        name: intent.file.name,
        mimeType: intent.file.mimeType,
        sizeBytes: intent.file.sizeBytes,
        uri: intent.file.uri,
      },
    };
  }

  if (intent.mimeType !== "text/plain") {
    return refuse(
      "unsupported-type",
      `Content of type "${intent.mimeType}" isn't supported for sharing text.`,
    );
  }

  const text = (intent.text ?? "").trim();
  if (text.length === 0) {
    return refuse("empty-content", "There's no text to share.");
  }

  if (STRICT_URL_PATTERN.test(text)) {
    return { accepted: true, content: { kind: "url", url: text } };
  }

  return {
    accepted: true,
    content: { kind: "text", text, looksSecretShaped: security.isSecretShaped(text) },
  };
}
