#!/usr/bin/env node
// CLI entry point for the secret-scan guard (T44A3). Run from the
// repository root (CI runs it via `node scripts/ci/run-guard-secret-scan.mjs`).
// See scripts/ci/guard-secret-scan.mjs for the curated patterns and their
// disclosed scope.
//
// Scans `git ls-files` (tracked files only — never a raw filesystem walk,
// which could otherwise wander outside the repository), reading every
// tracked file's content subject only to the size cap below — see the T248
// comment above `readContentForScan` for why this guard used to skip a set
// of extensions by name and no longer does.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { findSecretMatches } from "./guard-secret-scan.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const MAX_SCANNED_BYTES = 5 * 1024 * 1024; // 5 MiB — generous for any hand-edited text file here.

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

// T248: this guard used to skip a `BINARY_EXTENSIONS` set (`.png`/`.ttf`/
// `.woff2`/`.zip`/`.jar`/`.pdf`/etc.) before ever reading a file's bytes, on
// the premise that `readFileSync(path, "utf8")` would throw for a binary file
// and that reading fonts/images anyway would be wasteful. Both premises were
// measured, at the P9-B merge gate and again for this task, and neither
// holds — this is the identical finding T237 already made and fixed next
// door in `run-guard-signing-material.mjs`, re-measured here rather than
// assumed from that symmetry:
//
//   - `readFileSync(path, "utf8")` never throws on invalid UTF-8 — Node's
//     decoder substitutes U+FFFD and returns a string. A 2056-byte file
//     carrying the real JKS magic `FE ED FE ED` plus deliberately invalid
//     UTF-8 bytes decoded to a 2056-character string with no exception. So
//     the `catch` below is not "binary files land here" — it exists only
//     for a genuine I/O race between the `statSync` and the `readFileSync`
//     (the file is deleted or its permissions change in between).
//   - Because decoding never throws, a binary container's literal ASCII
//     bytes survive into the decoded string wherever the container itself
//     stores them uncompressed — a TTF `name` table entry, a PNG `tEXt`
//     chunk, an ID3 tag — so no extension in the old skip list was
//     structurally immune to holding a pattern-matching string; skipping it
//     traded away real coverage.
//   - The read cost of the 24 tracked files the old set used to skip
//     (8 `.png`, 8 `.ttf`, 8 `.woff2`; the largest is
//     `apps/android/assets/fonts/Inter-700.ttf` at 344,072 bytes) is real,
//     consistently positive, and small enough not to matter. The durable,
//     machine-independent figure is the byte share, because a timing on one
//     laptop tells the next reader nothing: those 24 files are 2,285,566 of
//     25,652,943 tracked bytes, or 8.91% (2.18 MiB of 24.46 MiB), which is
//     what a few percent of added wall time on a scan measured in tens of
//     milliseconds looks like. Measured, interleaved, 7 runs each way after
//     a warm-up: 106.1ms mean with the skip against 117.8ms without, a
//     +11.7ms difference whose ranges do not overlap at all (with-skip max
//     112.6ms below without-skip min 114.2ms). Scanning all 24 files
//     produced zero false positives (0 violations both ways). The existing
//     `MAX_SCANNED_BYTES` cap below already bounds the worst case
//     regardless of extension, exactly as it does for the signing-material
//     guard.
//
//     (CORRECTED at the P9-F merge gate. This said the cost was "not
//     measurable above run-to-run noise", quoting an ~8.6ms difference as
//     "smaller than the 30ms spread already present across the 5 'with
//     skip' runs alone". That does not reproduce: re-measured twice at the
//     gate, interleaved and warmed, the difference EXCEEDS the with-skip
//     spread and the two ranges separate cleanly. The conclusion — remove
//     the skip — is unchanged and correct; only the argument recorded for
//     the next reader was wrong, and a wrong argument is what a later wave
//     re-derives at cost. The cost is ~10ms and 8.91% of bytes: negligible
//     against the coverage it buys, not invisible.)
//
// So: every tracked file's content is now read (subject to the size cap),
// with no extension-based skip.
export function readContentForScan(absolutePath) {
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
    // T248 comment above for why decoding itself never throws here.
    return undefined;
  }
}

function main() {
  const files = listTrackedFiles();
  const violations = [];
  let scanned = 0;

  for (const path of files) {
    const content = readContentForScan(join(repoRoot, path));
    if (content === undefined) continue;

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

// Guarded the same way `run-guard-signing-material.mjs` is (fixed there at
// the P9-B merge gate): this module is now imported by its own test file
// (for `readContentForScan`), and running `main()` unconditionally at import
// time would set `process.exitCode = 1` from an import if the real tree ever
// had a violation, which `node --test` reports as the whole test FILE
// failing with every test inside it green and nothing naming the cause.
// `pathToFileURL` rather than a string compare because `process.argv[1]` is
// a `D:\...` path on Windows.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
