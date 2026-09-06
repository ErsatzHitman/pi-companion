/**
 * The single path-authorization door for `apps/web/src/features/files`
 * (T41A1a, plan.md §12.4 and §16).
 *
 * The daemon is the only thing that ever touches a real filesystem
 * (plan.md §12.4: "the frontend must not directly access laptop
 * paths"), and its `file-explorer` service already closes the TOCTOU
 * window correctly: it resolves with `O_NOFOLLOW`, `realpath`s both the
 * workspace root and the requested path, and rejects when the *resolved*
 * path escapes the root (`packages/server/src/server/file-explorer/service.ts`'s
 * `resolveScopedPath`, mirrored — not copied — here). That check is the
 * one that actually defeats a symlink pointing outside the workspace: a
 * browser has no `realpath` of its own to call, so it can never verify
 * that a name someone claims is safe truly resolves inside the root.
 *
 * What THIS module exists to stop is a *second* door on the web side
 * that skips even the check a browser CAN do — the same lexical
 * containment test the daemon applies before it ever calls `realpath`
 * (`resolveScopedPath`'s `path.relative(...).startsWith("..")` guard).
 * The concrete bypass named in review: a feature that scans transcript
 * text for something that merely *looks* path-shaped (say, a string an
 * assistant message or tool output happened to print) and treats a
 * match as an already-authorized workspace-relative path, wiring it
 * straight into a client call or a route link without ever asking this
 * question first. No such scanner exists in this repository today (see
 * this file's test for how that was checked), but every real
 * file-access entry point `features/files/` DOES have today —
 * `useFileBrowser`'s and `useFileExplorer`'s `listDirectory`/`readFile`
 * calls, `useFileEditor`'s `writeFile` call, `useFileDownload`'s
 * `requestDownloadToken` call, and `useFileSearch`'s breadth-first
 * `listDirectory` walk — now calls `authorizeWorkspacePath` on the exact
 * string it is about to hand to a client, with nothing between this
 * call and the network request. A future transcript-path feature has
 * exactly one correct way to become authorized: reuse this function,
 * the same way every existing entry point does.
 *
 * `authorizeWorkspacePath` is deliberately STRICTER than the daemon's
 * own guard: the daemon allows an internal `".."` segment that still
 * nets to a path inside the root after resolution (e.g. `"a/../b"`
 * resolves to `"b"`, which is fine); this door refuses ANY `".."`
 * segment outright, forward-slash or backslash. Nothing in this app
 * legitimately builds a path containing `".."` — every real path this
 * app ever has came from a `listDirectory` entry, a breadcrumb built
 * from an already-open path, or the route's own splat — so there is no
 * user-facing case this stricter rule breaks, and it removes an entire
 * class of "does this net out inside or outside" reasoning from the web
 * side entirely, matching this door's job: refuse anything that even
 * shape like an escape, and let the daemon do the one check only it can
 * actually do.
 */

export const PATH_OUTSIDE_WORKSPACE_MESSAGE = "Access outside of workspace is not allowed";

export class PathAuthorizationError extends Error {
  constructor(message: string = PATH_OUTSIDE_WORKSPACE_MESSAGE) {
    super(message);
    this.name = "PathAuthorizationError";
  }
}

export interface AuthorizedWorkspacePath {
  /** The canonical, `"/"`-joined, workspace-relative path. `""` names the workspace root. */
  readonly path: string;
}

const HOME_PREFIX_PATTERN = /^~(\/|$)/;
const DRIVE_LETTER_SEGMENT_PATTERN = /^[a-zA-Z]:$/;

/**
 * The one door every file-access entry point in `features/files/` must
 * call on a caller-supplied workspace-relative path immediately before
 * it is used for a request or a navigation decision. Throws
 * `PathAuthorizationError` (message `PATH_OUTSIDE_WORKSPACE_MESSAGE`,
 * matching the daemon's own guard text so this app's existing
 * `explain*Error` helpers — which already recognize that exact string —
 * need no changes to explain a rejection here) for anything that is not
 * a plain, root-relative path:
 *
 * - not a string at all, or contains a NUL byte;
 * - home-relative (`"~"`, `"~/..."`, mirroring the daemon's own
 *   `resolvePathFromBase` treating that prefix as escaping the
 *   supplied base — `packages/server/src/server/path-utils.ts`);
 * - POSIX-absolute (leading `"/"`) or UNC/backslash-absolute (leading
 *   `"\\"`);
 * - Windows drive-absolute (a segment matching `X:`, so `"C:/x"` and
 *   `"C:\\x"` are both caught after splitting on either separator);
 * - contains a `".."` segment, under either separator.
 *
 * Anything else is canonicalized: `"."` and empty segments (repeated
 * separators, a leading/trailing separator) are dropped, and the
 * remaining segments are rejoined with `"/"` — the same wire format
 * every existing `FileBrowser*`/`FileRead*`/`FileWrite*`/`FileDownload*`
 * client already uses.
 */
export function authorizeWorkspacePath(candidate: string): AuthorizedWorkspacePath {
  if (typeof candidate !== "string" || candidate.includes("\0")) {
    throw new PathAuthorizationError();
  }

  const trimmed = candidate.trim();

  if (HOME_PREFIX_PATTERN.test(trimmed)) {
    throw new PathAuthorizationError();
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    throw new PathAuthorizationError();
  }

  const rawSegments = trimmed.split(/[\\/]+/);
  const segments: string[] = [];
  for (const rawSegment of rawSegments) {
    const segment = rawSegment.trim();
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      throw new PathAuthorizationError();
    }
    if (DRIVE_LETTER_SEGMENT_PATTERN.test(segment)) {
      throw new PathAuthorizationError();
    }
    segments.push(segment);
  }

  return { path: segments.join("/") };
}
