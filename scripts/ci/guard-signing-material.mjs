// T44B1: CI guard — no Android/EAS signing material or credentials export
// is tracked in this repository.
//
// ## Why this exists
//
// T44B1's own acceptance criterion "Signing material is not present in the
// repository" had ZERO enforcement before this guard, and the one existing
// guard whose job sounds like it should cover this — `guard-secret-scan.mjs`
// (T44A3) — cannot, by construction. Its CLI entry point
// (`run-guard-secret-scan.mjs`) skips a file by EXTENSION before ever
// reading it, and that skip list (`BINARY_EXTENSIONS`) explicitly names
// `.keystore`, `.jks`, `.apk` and `.aab`. Separately, this repository's
// `.gitignore` had no entry for any signing extension before this task
// (`grep -n "jks\|keystore\|\.p12" .gitignore` returned nothing). So a real
// keystore committed under any of those four extensions would have been
// tracked, un-ignored, and explicitly excluded from the one guard whose job
// is finding committed secrets — the "entry in a curated list whose
// runner's scope can never see the case" shape this repository keeps
// re-finding (see CLAUDE.md's T124/P6-W12 entries for the same shape
// elsewhere).
//
// This is a NEW, dedicated guard rather than a change to
// `guard-secret-scan.mjs`'s own `BINARY_EXTENSIONS`, because the two checks
// answer different questions. `guard-secret-scan.mjs` asks "does this TEXT
// file's CONTENT look like a live credential" — a poor fit for a binary
// keystore, whose secret is a key entry in a container format, not a PEM
// block sitting in text. This guard asks an extension/filename-first
// question — "is a file NAMED like signing material tracked at all" — which
// needs no content decode at all, and so catches a keystore whatever its
// bytes decode to.
//
// (CORRECTED at the P9-B merge gate. This said the two guards had to stay
// apart because "a real `.jks`/`.keystore` file is not valid UTF-8, so even
// with the extension unblocked, `run-guard-secret-scan.mjs`'s own
// `readFileSync(..., "utf8")` call would throw and its `catch { continue; }`
// would silently skip the very file the unblocking was meant to protect",
// and marked that "verified by reading that file's `main()` above". It is
// false, and T237's own commit measured the opposite one file away in this
// same wave without updating this sentence. `readFileSync(path, "utf8")`
// does not throw on invalid UTF-8 — Node substitutes U+FFFD — so the decode
// SUCCEEDS and that `catch` never runs. Re-measured at the gate: a
// 2056-byte file carrying the real JKS magic FE ED FE ED followed by
// deliberately invalid UTF-8 decoded to 2056 characters with `threw =
// false`, and did not round-trip back to the original bytes. "Verified by
// reading" is how the claim survived four waves; nobody ran it. The
// separation above is the real reason and does not rest on it.)
//
// The one thing this guard deliberately SHARES with `guard-secret-scan.mjs`
// is its "private-key-block" PEM-header pattern, reused verbatim via
// `findSecretMatches` rather than duplicated, so a raw PEM private key
// committed under an unrelated extension (a keystore renamed to `.txt`, a
// pasted key inside a config file, ...) is still caught by CONTENT even when
// its name gives no warning by itself. That is also why this guard's own
// content check does not itself skip `.jks`/`.keystore`/`.apk`/`.aab` the
// way `guard-secret-scan.mjs`'s CLI does — this guard's CLI skips no
// extension at all, and reads every tracked file it can.
//
// (CORRECTED at the P9-B merge gate. This pointed the reader at "the (much
// narrower) skip list this guard actually uses, which only exists for
// read-performance on assets that could never satisfy EITHER check here".
// T237 deleted that set in this same wave, so following the pointer now
// lands on a comment recording that it used to exist. The sentence never
// names `SKIP_CONTENT_READ_EXTENSIONS`, which is why an identifier grep for
// the removal missed it.)
//
// ## What this deliberately does NOT catch
//
// - A keystore's bytes re-encoded (base64, hex) inside some other tracked
//   file under neither a signing extension/filename nor a literal PEM
//   header — no shape-based scan can catch this; only a process control
//   (review diffs, never commit `.env`/`credentials.json`) can.
// - Anything not tracked by git: this guard scans `git ls-files` only,
//   never a raw filesystem walk or git history — the same scope discipline
//   `guard-secret-scan.mjs` documents for the identical reason.
// - A secret with no recognizable shape at all (see
//   `guard-secret-scan.mjs`'s own header for why no generic entropy
//   scanner is built here either).
//
// Pure, dependency-free check functions only. `run-guard-signing-
// material.mjs` is the CLI entry point CI actually runs; it does the
// `git ls-files` walk and file reads this module stays free of, so
// `guard-signing-material.test.mjs` can exercise the matcher against
// fixtures with no filesystem or git access at all.

import { findSecretMatches } from "./guard-secret-scan.mjs";

/**
 * File extensions (lowercase, with leading dot) that must never be tracked
 * in this repository:
 *  - `.keystore` / `.jks` — the Java/Android keystore formats `keytool` and
 *    EAS both use to hold a signing key.
 *  - `.p12` / `.pfx` — the generic PKCS#12 certificate-bundle format, which
 *    `keytool`/EAS also accept as a keystore container.
 *  - `.pepk` — Google Play App Signing's encrypted private-key export
 *    format (produced by Android Studio's / `pepk.jar`'s "export encrypted
 *    key" flow for Play App Signing opt-in).
 *  - `.apk` / `.aab` — a built application package. A release artifact must
 *    only ever be produced by CI and attached to a GitHub Release; one
 *    committed to the tree is either stale, or a sign that a real signed
 *    build (and whatever produced it) leaked into source control.
 *  - `.mobileprovision` — an iOS provisioning profile. This app is
 *    Android-only today (plan.md §6), but this task's own brief lists it
 *    explicitly in case an iOS target is ever added before this guard is
 *    revisited — see the module header above for the general shape this
 *    guard exists to prevent recurring.
 */
export const SIGNING_MATERIAL_EXTENSIONS = new Set([
  ".keystore",
  ".jks",
  ".p12",
  ".pfx",
  ".pepk",
  ".apk",
  ".aab",
  ".mobileprovision",
]);

/**
 * Exact basenames (matched against the last path segment only, so any
 * directory containing one of these is still caught) that must never be
 * tracked, regardless of extension:
 *  - `google-services.json` — a real Firebase project's config file. This
 *    product uses no Firebase project; this file should never exist here.
 *  - `credentials.json` — the file `eas credentials:configure --local`
 *    writes, which embeds the actual Android keystore (base64) and its
 *    passwords in plaintext JSON.
 */
export const SIGNING_MATERIAL_FILENAMES = new Set(["google-services.json", "credentials.json"]);

function extensionOf(path) {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

function basenameOf(path) {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * @param {string} path repo-relative path, as reported by `git ls-files`
 * @param {string} [content] the file's decoded text content, when readable
 *   as UTF-8 and small enough to be worth reading — omit entirely for a
 *   binary file (a real keystore never decodes as UTF-8 anyway, so the
 *   name-based checks below are what actually catches it). When omitted,
 *   only the name-based checks run.
 * @returns {{ path: string, kind: "extension" | "filename" | "pem-private-key", detail: string, line: number }[]}
 *   every violation found for this one file, in a stable order. Never
 *   includes the matched PEM bytes themselves — only `guard-secret-scan.mjs`'s
 *   own non-revealing `description` string, matching that guard's own
 *   "never print the matched substring" rule (see its module header).
 */
export function findSigningMaterialViolations(path, content) {
  const violations = [];

  const ext = extensionOf(path);
  if (SIGNING_MATERIAL_EXTENSIONS.has(ext)) {
    violations.push({ path, kind: "extension", detail: ext, line: 1 });
  }

  const base = basenameOf(path);
  if (SIGNING_MATERIAL_FILENAMES.has(base)) {
    violations.push({ path, kind: "filename", detail: base, line: 1 });
  }

  if (content !== undefined) {
    for (const match of findSecretMatches(path, content)) {
      if (match.patternId === "private-key-block") {
        violations.push({
          path,
          kind: "pem-private-key",
          detail: match.description,
          line: match.line,
        });
      }
    }
  }

  return violations;
}
