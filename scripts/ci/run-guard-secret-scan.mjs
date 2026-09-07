#!/usr/bin/env node
// CLI entry point for the secret-scan guard (T44A3). Run from the
// repository root (CI runs it via `node scripts/ci/run-guard-secret-scan.mjs`).
// See scripts/ci/guard-secret-scan.mjs for the curated patterns and their
// disclosed scope.
//
// Scans `git ls-files` (tracked files only — never a raw filesystem walk,
// which could otherwise wander outside the repository) after filtering out
// extensions this repository actually uses for binary assets, plus any file
// too large to plausibly be a hand-edited text file.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { findSecretMatches } from "./guard-secret-scan.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Extensions this repository commits as binary or generated-binary-like
// content, where a byte sequence could coincidentally decode to something
// pattern-shaped, or that are simply never hand-authored text.
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".wav",
  ".zip",
  ".jar",
  ".apk",
  ".aab",
  ".keystore",
  ".jks",
  ".pdf",
]);

const MAX_SCANNED_BYTES = 5 * 1024 * 1024; // 5 MiB — generous for any hand-edited text file here.

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

function extensionOf(path) {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

function main() {
  const files = listTrackedFiles();
  const violations = [];
  let scanned = 0;

  for (const path of files) {
    if (BINARY_EXTENSIONS.has(extensionOf(path))) continue;
    const absolutePath = join(repoRoot, path);
    let size;
    try {
      size = statSync(absolutePath).size;
    } catch {
      continue; // Deleted-but-still-listed by a stale git state — nothing to scan.
    }
    if (size > MAX_SCANNED_BYTES) continue;

    let content;
    try {
      content = readFileSync(absolutePath, "utf8");
    } catch {
      continue; // Not decodable as UTF-8 — treat as binary, not a text secret carrier.
    }

    scanned += 1;
    violations.push(...findSecretMatches(path, content));
  }

  if (violations.length === 0) {
    console.log(
      `guard-secret-scan: OK — no committed file matched a curated secret pattern (${scanned} of ${files.length} tracked files scanned).`,
    );
    return;
  }

  console.error(
    `guard-secret-scan: FAILED — ${violations.length} match(es) against a curated secret pattern:`,
  );
  for (const v of violations) {
    console.error(`  ${v.path}:${v.line} — looks like ${v.description} (pattern: ${v.patternId})`);
  }
  console.error(
    "  The matched text itself is never printed here. If this is a REAL credential: rotate it immediately," +
      " remove it from the tracked tree, and treat the repository's history as compromised until it is scrubbed" +
      " (contact the repository owner — do not attempt a history rewrite unilaterally). If this is a deliberate," +
      " clearly-fake fixture, comment it as a fixture and make it not match — see guard-secret-scan.test.mjs for" +
      " the string-concatenation technique this repository uses so a fixture never appears as a contiguous," +
      " scannable literal.",
  );
  process.exitCode = 1;
}

main();
