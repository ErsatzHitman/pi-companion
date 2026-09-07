#!/usr/bin/env node
// CLI entry point for the signing-material guard (T44B1). Run from the
// repository root (CI runs it via `node scripts/ci/run-guard-signing-material.mjs`).
// See scripts/ci/guard-signing-material.mjs for the curated extension/filename
// list, the reused PEM-header content check, and this guard's disclosed scope.
//
// Scans `git ls-files` (tracked files only — never a raw filesystem walk,
// which could otherwise wander outside the repository) exactly like
// `run-guard-secret-scan.mjs`, but with a much narrower content-read skip
// list: unlike that guard, this one's job is to catch a signing file BY
// NAME even when it is binary, so it must not skip `.jks`/`.keystore`/
// `.apk`/`.aab`/etc. before running the name check.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { findSigningMaterialViolations } from "./guard-signing-material.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Generic binary-asset extensions this repository legitimately tracks in
// quantity, skipped before any content READ so this guard does not waste time
// trying to UTF-8-decode images/fonts/audio.
//
// This list DOES narrow the content check, and the narrowing is real: a PEM
// private key pasted into a tracked `key.zip`, `key.jar` or `key.pdf` is not
// caught here, while the same bytes under `key.txt` are. Measured at the P9-W5
// merge gate by tracking the identical header under both extensions: `.txt`
// reported a violation, `.zip` reported none. The name-based checks are
// unaffected — every path still goes through
// `findSigningMaterialViolations`'s extension and basename checks, and none of
// the extensions listed here can satisfy `SIGNING_MATERIAL_EXTENSIONS` or
// `SIGNING_MATERIAL_FILENAMES` (deliberately disjoint sets).
//
// This is parity with `run-guard-secret-scan.mjs`, whose `BINARY_EXTENSIONS`
// skips the same three, so it is not a regression — but it is a gap, and T237
// owns deciding whether to read content on these (size-capped) or narrow the
// list. (CORRECTED at the P9-W5 merge gate: this said "This is NOT a
// security-relevant exclusion", which is true of the name checks and false of
// the content check — the half that exists to catch a renamed keystore.)
const SKIP_CONTENT_READ_EXTENSIONS = new Set([
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

function readContentIfWorthwhile(path) {
  if (SKIP_CONTENT_READ_EXTENSIONS.has(extensionOf(path))) return undefined;

  const absolutePath = join(repoRoot, path);
  let size;
  try {
    size = statSync(absolutePath).size;
  } catch {
    return undefined; // Deleted-but-still-listed by a stale git state.
  }
  if (size > MAX_SCANNED_BYTES) return undefined;

  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    // Not decodable as UTF-8 — a real binary keystore always lands here.
    // The name-based checks already ran on `path` regardless of this.
    return undefined;
  }
}

function main() {
  const files = listTrackedFiles();
  const violations = [];

  for (const path of files) {
    const content = readContentIfWorthwhile(path);
    violations.push(...findSigningMaterialViolations(path, content));
  }

  if (violations.length === 0) {
    console.log(
      `guard-signing-material: OK — no committed file looks like signing material or a credentials export (${files.length} tracked files checked).`,
    );
    return;
  }

  console.error(
    `guard-signing-material: FAILED — ${violations.length} tracked file(s) look like Android/EAS signing material:`,
  );
  for (const v of violations) {
    if (v.kind === "extension") {
      console.error(`  ${v.path} — tracked with signing-material extension "${v.detail}"`);
    } else if (v.kind === "filename") {
      console.error(`  ${v.path} — tracked under the reserved filename "${v.detail}"`);
    } else {
      console.error(`  ${v.path}:${v.line} — looks like ${v.detail} (a PEM private key)`);
    }
  }
  console.error(
    "  Signing material must never be committed. Remove the file from the tracked tree" +
      " (`git rm --cached <path>`), add its path or extension to .gitignore if it is not" +
      " already covered, and store the real keystore only in EAS's managed credentials" +
      " (`eas credentials`) or a secret manager outside this repository. If this is a" +
      " REAL credential that was ever committed, rotate it immediately and treat the" +
      " repository's history as compromised until it is scrubbed — contact the repository" +
      " owner rather than attempting a history rewrite unilaterally.",
  );
  process.exitCode = 1;
}

main();
