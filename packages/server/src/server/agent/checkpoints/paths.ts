/**
 * Path and identity helpers shared by the checkpoint store.
 *
 * Adapted from Supernova's `.../lib/checkpoints/git-paths.ts` (symbols
 * `slashPath`, `isWithin`, `validateGitPath`, `topmostPaths`) and
 * `.../lib/checkpoints/checkpoint-keys.ts` (symbol `digest`), MIT © 2026 Mattia
 * Cerutti, read at commit `5e6b861d152e41d4fd715abe1dba92421d45c753`; see
 * `docs/T383-provenance.md` and `plan.md` §4.2.
 */

import { createHash } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";

/** Hashes an identifier into the fixed-width, filesystem-safe form used for storage paths and ref names. */
export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * A shortened digest for storage directory and ref names.
 *
 * Windows Git refuses a `--git-dir` value near the platform path limit, and a
 * checkpoint's shadow repository sits under several digest-named directories, so
 * every name in that path is shortened. 96 bits still makes a collision
 * irrelevant for this use.
 */
export function shortDigest(value: string): string {
  return digest(value).slice(0, 24);
}

/** Returns the ref prefix that holds every checkpoint of one session. */
export function checkpointSessionRefPrefix(sessionId: string): string {
  return `refs/picompanion/checkpoints/${shortDigest(sessionId)}/`;
}

/** Returns the private ref that pins one checkpoint's tree. */
export function checkpointRefName(sessionId: string, checkpointId: string): string {
  return `${checkpointSessionRefPrefix(sessionId)}${shortDigest(checkpointId)}`;
}

/** Converts a platform path into the forward-slash form Git uses. */
export function slashPath(value: string): string {
  return value.split(sep).join("/");
}

/** Returns whether a resolved path is the root itself or lives inside it. */
export function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))
  );
}

/** Rejects repository-relative paths that could escape their repository or confuse path handling. */
export function validateGitPath(path: string): void {
  if (path.length === 0 || isAbsolute(path) || path.includes("\0")) {
    throw new Error("A checkpoint contains an unsafe repository path.");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error("A checkpoint contains an unsafe repository path.");
  }
}

/**
 * Reduces paths to their shallowest entries, so removing a directory is never
 * followed by removing its children.
 */
export function topmostPaths(paths: readonly string[]): readonly string[] {
  const ordered = [...new Set(paths)].sort(
    (left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right),
  );
  return ordered.filter(
    (path, index) => !ordered.slice(0, index).some((parent) => path.startsWith(`${parent}/`)),
  );
}
