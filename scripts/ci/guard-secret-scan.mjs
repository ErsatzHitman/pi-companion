// T44A3: CI guard — no committed credential shaped like a live secret.
//
// ## Scope and design
//
// This is a CURATED, high-signal scan, not a generic entropy detector.
// Every pattern below targets one vendor's documented token PREFIX (AWS,
// GitHub, Slack, Google, Stripe, npm) or an unambiguous PEM private-key
// header — shapes real secret scanners (gitleaks, trufflehog) also treat as
// near-zero-false-positive, because no ordinary source text, test fixture,
// or example ever coincidentally matches a 20+ character vendor-prefixed
// token. A generic "high entropy string" or "KEY = ..." assignment scanner
// was deliberately NOT built: this repository is full of legitimate
// high-entropy strings (hashes, base64 fixtures, generated ids) that would
// make such a scanner permanently noisy and, per this repository's own
// established lesson about checks nobody trusts, quickly disabled rather
// than fixed.
//
// ## What this deliberately does NOT catch
//
// - A secret with no recognizable vendor prefix (a raw database password, a
//   bespoke internal token) — no shape-based scan can catch this; only a
//   process control (never commit `.env`, review diffs) can.
// - A secret split across a string concatenation or template literal whose
//   pieces never appear contiguously in the file's raw bytes. This is a
//   real evasion and a real limitation of a static, non-evaluating scanner
//   — the same shape `guard-declared-workspace-deps.mjs`'s own module
//   header discusses for a different reason (this repository's OWN test
//   suite exploits exactly this gap on purpose, safely: see
//   `guard-secret-scan.test.mjs`'s fixtures, which build a matching string
//   at runtime via `+` so the literal 20+ character token never appears
//   contiguously in this file's own tracked source).
// - A secret already fixed by history rewrite or already rotated: this
//   guard scans the CURRENT tracked tree only (`git ls-files`), never
//   history. A secret that ever reached a commit and was later deleted is
//   still in `git log`; this guard says nothing about that case at all.
//
// Every match reports only the file path, pattern id, and 1-based line
// number — NEVER the matched substring itself — so that if this guard ever
// finds a genuine secret, running it (or reading its CI log) does not
// itself become a second place that secret leaked to.
//
// Pure, dependency-free check functions only. `run-guard-secret-scan.mjs`
// is the CLI entry point CI actually runs; it does the `git ls-files` walk
// and file reads this module stays free of, so
// `guard-secret-scan.test.mjs` can exercise the matcher against fixtures
// with no filesystem or git access at all.

/**
 * @typedef {{ id: string, description: string, pattern: RegExp }} SecretPattern
 */

/** @type {SecretPattern[]} */
export const SECRET_PATTERNS = [
  {
    id: "aws-access-key-id",
    description: "AWS access key id (AKIA... 20 chars)",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: "aws-secret-access-key",
    description: "an aws_secret_access_key-style assignment holding a 40-char base64 value",
    pattern: /aws_secret_access_key\s*[:=]\s*['"][A-Za-z0-9/+]{40}['"]/i,
  },
  {
    id: "github-pat-classic",
    description: "classic GitHub personal access token (ghp_...)",
    pattern: /\bghp_[A-Za-z0-9]{36}\b/,
  },
  {
    id: "github-pat-fine-grained",
    description: "fine-grained GitHub personal access token (github_pat_...)",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/,
  },
  {
    id: "github-app-oauth-token",
    // Deliberately excludes "p" from the character class: "ghp_" is the
    // CLASSIC personal access token prefix, already its own pattern above.
    // Including "p" here made every classic-PAT fixture match BOTH
    // patterns — caught by this guard's own test suite, not assumed.
    description: "GitHub OAuth/App/user-to-server/refresh token (gho_/ghu_/ghs_/ghr_...)",
    pattern: /\bgh[orsu]_[A-Za-z0-9]{36}\b/,
  },
  {
    id: "slack-token",
    description: "Slack API token (xoxb-/xoxp-/xoxa-/xoxr-/xoxs-...)",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,64}\b/,
  },
  {
    id: "slack-webhook-url",
    description: "Slack incoming webhook URL",
    pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/,
  },
  {
    id: "google-api-key",
    description: "Google API key (AIza...)",
    pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/,
  },
  {
    id: "stripe-live-secret-key",
    description: "Stripe LIVE secret key (sk_live_...)",
    pattern: /\bsk_live_[0-9a-zA-Z]{20,}\b/,
  },
  {
    id: "npm-access-token",
    description: "npm access token (npm_...)",
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/,
  },
  {
    id: "private-key-block",
    description: "a PEM private key block header",
    pattern: /-----BEGIN\s?(RSA|EC|OPENSSH|DSA|PGP)?\s?PRIVATE KEY-----/,
  },
];

/**
 * @param {string} path repo-relative path, used only for the report — never scanned itself
 * @param {string} content the file's text content
 * @returns {{ path: string, patternId: string, description: string, line: number }[]}
 *   every match, deduplicated by (patternId, line), sorted by line then patternId.
 *   Never includes the matched substring.
 */
export function findSecretMatches(path, content) {
  const found = new Map();

  for (const { id, description, pattern } of SECRET_PATTERNS) {
    const global = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    for (const match of content.matchAll(global)) {
      // 1-based line number, computed from how many newlines precede the match.
      const line = content.slice(0, match.index).split("\n").length;
      const key = `${id}:${line}`;
      if (!found.has(key)) {
        found.set(key, { path, patternId: id, description, line });
      }
    }
  }

  return [...found.values()].sort(
    (a, b) => a.line - b.line || a.patternId.localeCompare(b.patternId),
  );
}
