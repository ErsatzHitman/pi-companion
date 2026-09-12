/**
 * Which work-tree files a checkpoint captures.
 *
 * The rule list starts from Supernova's (see `docs/T383-provenance.md`): Git
 * metadata and nested repository roots are never captured, and an untracked file
 * above the 2 MiB cap is skipped rather than poured into the snapshot store. Two
 * rules are added here and are pinned by `checkpoint-store.test.ts`:
 *
 * - a `node_modules` segment anywhere in a path is skipped, and
 * - a large binary untracked file (a NUL byte in its leading bytes, above the
 *   binary cap) is skipped.
 *
 * Adapted from Supernova's `.../internal/shadow-repository.ts` (symbol
 * `isExcludedPath` and `MAX_UNTRACKED_FILE_BYTES`), MIT © 2026 Mattia Cerutti,
 * read at commit `5e6b861d152e41d4fd715abe1dba92421d45c753`; see
 * `docs/T383-provenance.md` and `plan.md` §4.2.
 *
 * A tracked file is always captured regardless of size, because excluding a
 * tracked path would make a later restore treat it as deleted. Excluded files
 * are absent from every snapshot, so restores never delete them and conflict
 * detection never sees a change to one.
 */

export const MAX_UNTRACKED_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_UNTRACKED_BINARY_BYTES = 1024 * 1024;

const EXCLUDED_PATH_SEGMENTS = new Set([".git", "node_modules"]);

export interface FileCandidate {
  readonly binary: boolean;
  readonly path: string;
  readonly size: number;
  readonly untracked: boolean;
}

/** Returns whether a repository-relative path is excluded outright. */
export function isExcludedPath(path: string, excludedRoots: readonly string[] = []): boolean {
  if (path.split("/").some((segment) => EXCLUDED_PATH_SEGMENTS.has(segment))) {
    return true;
  }
  return isExcludedRoot(path, excludedRoots);
}

/** Returns whether a repository-relative path belongs to one of the excluded child repository roots. */
export function isExcludedRoot(path: string, excludedRoots: readonly string[]): boolean {
  return excludedRoots.some((root) => path === root || path.startsWith(`${root}/`));
}

/** Returns whether a work-tree file belongs in a snapshot. */
export function shouldCaptureFile(
  candidate: FileCandidate,
  excludedRoots: readonly string[] = [],
): boolean {
  if (isExcludedPath(candidate.path, excludedRoots)) {
    return false;
  }
  if (!candidate.untracked) {
    return true;
  }
  if (candidate.size > MAX_UNTRACKED_FILE_BYTES) {
    return false;
  }
  if (candidate.binary && candidate.size > MAX_UNTRACKED_BINARY_BYTES) {
    return false;
  }
  return true;
}
