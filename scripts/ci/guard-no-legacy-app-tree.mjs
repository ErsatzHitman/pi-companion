// T17A: CI guard — nothing from Paseo's `packages/app` tree may ever enter
// this repository (plan.md invariant, §15.4), and no source file may
// reference the legacy `@getpaseo/*` package scope or a `packages/app` path
// once this repository has been renamed to `@picompanion/*` (T01-T04).
//
// Pure, dependency-free check functions only. `run-guard-no-legacy-app-tree.mjs`
// is the CLI entry point CI actually runs; this module stays import-safe so
// `guard-no-legacy-app-tree.test.mjs` can seed violations without touching
// the real working tree.
//
// ## T213: a stale ALLOWLISTED_PATHS entry, and why it is a SEPARATE violation class
//
// `findLegacyReferenceViolations` originally consulted `ALLOWLISTED_PATHS`
// only *inside* its loop over `files` — for whichever path it happened to be
// looking at. That means an allowlist entry is only ever read when a
// matching path is present in `files` AND that path's content still trips
// `LEGACY_IMPORT_PATTERN`. Two kinds of entry were therefore unreachable and
// silently ignored, forever — the same shape `guard-run-guard-wiring.mjs`
// closed for its own allowlist at T211, one wave earlier:
//
//   1. A key naming a path that has since been deleted or renamed — nothing
//      in `files` ever carries that path, so a stale key just sits there.
//   2. A key naming a path that no longer contains what the entry excuses
//      (the file was cleaned up and nobody removed its exemption) — the
//      `if (ALLOWLISTED_PATHS.has(path)) continue;` skips straight past it
//      before `LEGACY_IMPORT_PATTERN` is ever consulted for that path, so an
//      entry can outlive the reason it was written for and nothing will
//      ever say so.
//
// There was no live defect when T213 was filed (the P8-W13 merge gate
// verified both real entries name files that exist; T213's own
// verification additionally confirmed both still trip
// `LEGACY_IMPORT_PATTERN` today) — the point is that the check could not
// have told us if there were one.
//
// `findStaleAllowlistViolations` below walks `ALLOWLISTED_PATHS` directly,
// independently of whether `findLegacyReferenceViolations`'s loop over
// `files` would ever reach a given key. It reuses the exact `paths` and
// `files` this module is already handed, and the exact `LEGACY_IMPORT_PATTERN`
// `findLegacyReferenceViolations` already checks against — it does not
// re-derive "does this path exist" or "does this content still count" with a
// second, possibly-different notion of either.
//
// **A stale allowlist entry is a SEPARATE violation class from a legacy
// reference, not the same one wearing a different path.** `kind:
// "stale-missing-path"` means the entry names a path this repository no
// longer tracks at all — the fix is to delete or correct the entry, there is
// no file left to excuse. `kind: "stale-clean"` means the entry names a real,
// tracked file that no longer matches `LEGACY_IMPORT_PATTERN` — the entry has
// outlived its reason; the fix is to delete it, never to reintroduce a
// legacy reference just to make the old reason true again.
//
// Unlike `guard-run-guard-wiring.mjs`'s `ALLOWLISTED_UNWIRED_RUN_GUARDS`
// (a `Record<runner, reason>`, because each of its two entries is unwired
// for a materially different, load-bearing reason worth recording and
// individually re-checking), `ALLOWLISTED_PATHS` here stays a plain
// `Set<string>`: both of its entries share one reason, already stated once
// above the Set itself ("guard fixtures or this guard's own
// implementation"), so a per-entry reason string would just repeat that
// sentence twice without adding anything a reader could get wrong. T211's
// per-entry `isValidAllowlistReason` therefore has no counterpart here — the
// two failure modes below are the whole check, not an addition to a
// reason-length gate that doesn't exist in this guard.

import { extname } from "node:path";

/** Extensions scanned for legacy string references. Binary/lockfile/asset
 * formats are excluded; markdown/docs are excluded separately (allowlisted
 * below) because provenance docs legitimately name the reference tree. */
export const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
]);

/** Files allowed to mention the legacy scope/path as guard fixtures or in
 * this guard's own implementation. Provenance prose lives in `.md` files,
 * which are never scanned (see SCANNED_EXTENSIONS). */
export const ALLOWLISTED_PATHS = new Set([
  "scripts/ci/guard-no-legacy-app-tree.mjs",
  "scripts/ci/guard-no-legacy-app-tree.test.mjs",
]);

// Matches only import/require/dynamic-import specifiers, e.g.
// `from "@getpaseo/client"`, `require("packages/app/src/...")`,
// `import("@getpaseo/app")`. Deliberately narrower than a bare substring
// search: fixture/test data that happens to contain the literal string
// "packages/app" (e.g. a sample PR diff path or workspace directory in a
// protocol test) is not a legacy import and must not trip this guard.
const LEGACY_IMPORT_PATTERN =
  /(?:\bfrom\s+|\brequire\(\s*|\bimport\(\s*|^\s*import\s+)["'`][^"'`]*(?:@getpaseo\/|packages\/app\/)[^"'`]*["'`]/m;

/**
 * @param {string[]} paths repo-relative, forward-slash tracked file paths
 * @returns {string[]} paths that live under `packages/app`
 */
export function findPackagesAppPathViolations(paths) {
  return paths.filter((path) => path === "packages/app" || path.startsWith("packages/app/"));
}

/**
 * @param {{ path: string, content: string }[]} files
 * @returns {{ path: string, pattern: string }[]}
 */
export function findLegacyReferenceViolations(files) {
  const violations = [];
  for (const { path, content } of files) {
    if (ALLOWLISTED_PATHS.has(path)) continue;
    if (!SCANNED_EXTENSIONS.has(extname(path))) continue;
    const match = LEGACY_IMPORT_PATTERN.exec(content);
    if (match) {
      const pattern = match[0].includes("@getpaseo/") ? "@getpaseo/" : "packages/app";
      violations.push({ path, pattern });
    }
  }
  return violations;
}

/**
 * @typedef {{ kind: "stale-missing-path" | "stale-clean", path: string }} AllowlistStaleViolation
 *   `kind: "stale-missing-path"` — an `ALLOWLISTED_PATHS` entry naming a path
 *   that is not among today's tracked `paths` (renamed or deleted). There is
 *   no file left to excuse; delete or correct the entry.
 *   `kind: "stale-clean"` — an `ALLOWLISTED_PATHS` entry naming a real,
 *   tracked path whose content (found in `files`) no longer matches
 *   `LEGACY_IMPORT_PATTERN`. The entry has outlived its reason; delete it,
 *   never reintroduce a legacy reference just to make the old reason true
 *   again. (See this module's header, "T213", for why these are a separate
 *   violation class from a genuine legacy reference, not the same one under
 *   a different path.)
 */

/**
 * Checks `ALLOWLISTED_PATHS` for staleness, walking its own keys directly
 * rather than relying on `findLegacyReferenceViolations`'s loop over `files`
 * to happen to visit them (see this module's header, "T213", for why that
 * loop can never reach either failure mode on its own).
 *
 * @param {string[]} paths tracked repo-relative paths (same value passed to
 *   `findViolations`/`findPackagesAppPathViolations` — this function does
 *   not re-derive "does this path exist" any other way)
 * @param {{ path: string, content: string }[]} files content for at least
 *   every `paths` entry that is also an `ALLOWLISTED_PATHS` key — entries
 *   this array has no content for are skipped rather than guessed at (a
 *   caller contract, not a silent pass: `run-guard-no-legacy-app-tree.mjs`
 *   reads every existing allowlisted path's content precisely so this never
 *   happens against the real tree)
 * @param {Set<string>} [allowlist]
 * @returns {AllowlistStaleViolation[]}
 */
export function findStaleAllowlistViolations(paths, files, allowlist = ALLOWLISTED_PATHS) {
  const pathSet = new Set(paths);
  const contentByPath = new Map(files.map((file) => [file.path, file.content]));
  const violations = [];
  for (const path of allowlist) {
    if (!pathSet.has(path)) {
      violations.push({ kind: "stale-missing-path", path });
      continue;
    }
    const content = contentByPath.get(path);
    if (content === undefined) continue;
    if (!LEGACY_IMPORT_PATTERN.test(content)) {
      violations.push({ kind: "stale-clean", path });
    }
  }
  return violations;
}

/**
 * @param {string[]} paths tracked repo-relative paths
 * @param {{ path: string, content: string }[]} files subset of `paths` with content loaded —
 *   for `findStaleAllowlistViolations` to see every existing `ALLOWLISTED_PATHS` entry, this
 *   must include content for those paths even though `findLegacyReferenceViolations` itself
 *   skips them
 * @returns {{
 *   pathViolations: string[],
 *   referenceViolations: { path: string, pattern: string }[],
 *   staleAllowlistViolations: AllowlistStaleViolation[],
 * }}
 */
export function findViolations(paths, files) {
  return {
    pathViolations: findPackagesAppPathViolations(paths),
    referenceViolations: findLegacyReferenceViolations(files),
    staleAllowlistViolations: findStaleAllowlistViolations(paths, files),
  };
}
