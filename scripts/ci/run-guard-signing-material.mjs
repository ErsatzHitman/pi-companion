#!/usr/bin/env node
// CLI entry point for the signing-material guard (T44B1). Run from the
// repository root (CI runs it via `node scripts/ci/run-guard-signing-material.mjs`).
// See scripts/ci/guard-signing-material.mjs for the curated extension/filename
// list, the reused PEM-header content check, and this guard's disclosed scope.
//
// Scans `git ls-files` (tracked files only — never a raw filesystem walk,
// which could otherwise wander outside the repository) exactly like
// `run-guard-secret-scan.mjs`, but this guard's job is to catch a signing file
// BY NAME even when it is binary, so it must not skip `.jks`/`.keystore`/
// `.apk`/`.aab`/etc. before running the name check.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { findSigningMaterialViolations } from "./guard-signing-material.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// T237: there used to be a `SKIP_CONTENT_READ_EXTENSIONS` set here
// (`.png`/`.jpg`/.../`.zip`/`.jar`/`.pdf`) that returned `undefined` before
// any content read, so the PEM-header content check never ran on those
// extensions — measured at the P9-W5 merge gate by tracking an identical PEM
// header as both `.txt` (violation reported) and `.zip` (none reported).
//
// T237 decided AGAINST narrowing that list and instead REMOVED it, because no
// extension in it is actually safe to skip once you read real files instead
// of reasoning about them:
//
//   - Node's `Buffer`-backed `"utf8"` decode never throws on invalid byte
//     sequences — it substitutes U+FFFD and returns a string. Verified
//     directly: `Buffer.from([0x00, 0xff, 0xfe, 0x50, 0x4b, 0x03,
//     0x04]).toString("utf8")` returns a 7-character string, no exception.
//     So the `catch` below is NOT "a real binary keystore always lands
//     here" (that claim, made by an earlier version of this comment, was
//     never true) — it exists only for a genuine I/O race (the file is
//     deleted or its permissions change between the `statSync` and the
//     `readFileSync`).
//   - Because decoding never throws, a binary file's literal ASCII bytes
//     survive into the decoded string wherever the file itself stores them
//     uncompressed. Measured directly: a real, valid PKZIP archive
//     (`System.IO.Compression.ZipFile`, `CompressionLevel.NoCompression`)
//     containing a file whose content was a PEM header decoded byte-for-byte
//     back to the original text, and `findSigningMaterialViolations` caught
//     it. The same PEM header zipped with ordinary DEFLATE compression did
//     NOT survive (compression scrambles the bytes) — so a compressed
//     archive still is not caught by content, but that is a limitation of
//     compression, not of this guard's extension handling, and it applies
//     identically to a `.txt` file gzipped by hand. PNG (`tEXt`/`zTXt`
//     chunks), JPEG (`COM` markers), ID3 audio tags, and uncompressed PDF
//     streams all have the same "literal bytes survive if the container
//     doesn't compress them" property — there is no extension in the old
//     list that is structurally immune to holding a pasted key, which is
//     what "narrow the list to the extensions that genuinely cannot hold a
//     pasted key" would have required.
//   - The performance rationale the old comment gave ("does not waste time
//     trying to UTF-8-decode images/fonts/audio") does not hold up measured
//     against this repository's real tracked assets: at the time of this
//     change, `git ls-files` names 24 tracked files under the old skip
//     list's extensions (8 `.png`, 8 `.ttf`, 8 `.woff2`; zero `.zip`/`.jar`/
//     `.pdf`), the largest is 344 KB, and reading and scanning every one of
//     them produces zero false positives and finishes in well under a
//     second — the existing `MAX_SCANNED_BYTES` cap below already bounds the
//     worst case regardless of extension.
//
// So: every tracked file's content is now read (subject to the size cap),
// with no extension-based skip. The name-based checks
// (`findSigningMaterialViolations`'s extension/filename matches) are
// unaffected either way — they never depended on content being read.
const MAX_SCANNED_BYTES = 5 * 1024 * 1024; // 5 MiB — generous for any hand-edited text file here.

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

/**
 * @param {string} absolutePath the file's real, absolute path on disk
 * @returns {string | undefined} the file's UTF-8 text content, or `undefined`
 *   when it is too large to be worth reading or a genuine I/O error occurs
 *   reading it (see the T237 comment above the skip list this function used
 *   to consult — it no longer skips by extension).
 */
export function readContentIfWorthwhile(absolutePath) {
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
    // A genuine I/O race (permission change, deletion) between the
    // `statSync` above and this read — NOT a UTF-8 decode failure; see the
    // T237 comment above for why decoding itself never throws here. The
    // name-based checks already ran on the file's path regardless of this.
    return undefined;
  }
}

function main() {
  const files = listTrackedFiles();
  const violations = [];

  for (const path of files) {
    const content = readContentIfWorthwhile(join(repoRoot, path));
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
