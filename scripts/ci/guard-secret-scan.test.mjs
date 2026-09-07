import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findSecretMatches, SECRET_PATTERNS } from "./guard-secret-scan.mjs";
import { readContentForScan } from "./run-guard-secret-scan.mjs";

// Every fixture below builds its secret-shaped string via `+` at runtime so
// the full, contiguous, matching token never appears as a literal run of
// characters in THIS file's own tracked source — see guard-secret-scan.mjs's
// module header ("A secret split across a string concatenation ... never
// appear contiguously in the file's raw bytes"). That is a genuine blind
// spot of a static scanner and this file deliberately relies on it so this
// guard's own test fixtures can never trip the real guard when it later
// scans every tracked file in the repository (proven by the "does not trip
// on its own test file" test below, which reads this very file's raw
// on-disk bytes).

test("SECRET_PATTERNS is non-empty and every pattern has a distinct id", () => {
  assert.ok(SECRET_PATTERNS.length > 0);
  const ids = SECRET_PATTERNS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("detects an AWS access key id", () => {
  const fixture = 'const key = "' + "AKIA" + "EXAMPLE1234567AB" + '";';
  const matches = findSecretMatches("fixture.ts", fixture);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patternId, "aws-access-key-id");
  assert.equal(matches[0].path, "fixture.ts");
  assert.equal(matches[0].line, 1);
});

test("detects an aws_secret_access_key assignment", () => {
  const secretValue = "abcdEFGH1234abcdEFGH1234abcdEFGH1234abcd"; // 41 chars is fine, only 40 need match
  const fixture = "aws_secret_access_key" + ' = "' + secretValue.slice(0, 40) + '"';
  const matches = findSecretMatches("fixture.env", fixture);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patternId, "aws-secret-access-key");
});

test("detects a classic GitHub personal access token", () => {
  const fixture = 'token: "' + "ghp_" + "A".repeat(36) + '"';
  const matches = findSecretMatches("fixture.ts", fixture);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patternId, "github-pat-classic");
});

test("detects a fine-grained GitHub personal access token", () => {
  const fixture = 'token: "' + "github_pat_" + "A".repeat(30) + '"';
  const matches = findSecretMatches("fixture.ts", fixture);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patternId, "github-pat-fine-grained");
});

test("detects a GitHub OAuth/app token variant", () => {
  const fixture = 'token: "' + "ghs_" + "B".repeat(36) + '"';
  const matches = findSecretMatches("fixture.ts", fixture);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patternId, "github-app-oauth-token");
});

test("detects a Slack API token", () => {
  const fixture = "SLACK_TOKEN=" + "xoxb-" + "1234567890-ABCDEFGHIJ";
  const matches = findSecretMatches("fixture.env", fixture);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patternId, "slack-token");
});

test("detects a Slack incoming webhook URL", () => {
  const fixture =
    "https://hooks.slack.com/services/" + "T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";
  const matches = findSecretMatches("fixture.env", fixture);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patternId, "slack-webhook-url");
});

test("detects a Google API key", () => {
  const fixture = 'apiKey: "' + "AIza" + "S".repeat(35) + '"';
  const matches = findSecretMatches("fixture.ts", fixture);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patternId, "google-api-key");
});

test("detects a Stripe live secret key", () => {
  const fixture = "STRIPE_KEY=" + "sk_live_" + "C".repeat(24);
  const matches = findSecretMatches("fixture.env", fixture);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patternId, "stripe-live-secret-key");
});

test("detects an npm access token", () => {
  const fixture = "//registry.npmjs.org/:_authToken=" + "npm_" + "D".repeat(36);
  const matches = findSecretMatches(".npmrc", fixture);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patternId, "npm-access-token");
});

test("detects a PEM private key block header", () => {
  const fixture =
    "-----BEGIN" + " RSA PRIVATE KEY-----\nMIIExampleNotARealKey\n-----END RSA PRIVATE KEY-----";
  const matches = findSecretMatches("fixture.pem", fixture);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].patternId, "private-key-block");
});

test("reports the correct 1-based line number for a match on a later line", () => {
  const fixture = [
    "line one",
    "line two",
    'const key = "' + "AKIA" + "EXAMPLE1234567AB" + '";',
    "line four",
  ].join("\n");
  const matches = findSecretMatches("fixture.ts", fixture);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].line, 3);
});

test("never returns the matched substring itself, only path/patternId/description/line", () => {
  const fixture = 'const key = "' + "AKIA" + "EXAMPLE1234567AB" + '";';
  const matches = findSecretMatches("fixture.ts", fixture);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0]).sort(), ["description", "line", "path", "patternId"]);
});

test("clean, ordinary source text produces no matches", () => {
  const fixture = [
    "export function connect(url: string) {",
    "  const client = new WebSocket(url);",
    "  return client;",
    "}",
  ].join("\n");
  assert.deepEqual(findSecretMatches("fixture.ts", fixture), []);
});

test("a bare vendor prefix with too few following characters is not a match (avoids the obvious false positive)", () => {
  const fixture = 'const example = "AKIA_this_is_just_a_word_not_a_key";';
  assert.deepEqual(findSecretMatches("fixture.ts", fixture), []);
});

test("does not trip on its own test file's raw on-disk bytes (proves the concatenation trick is real, not assumed)", async () => {
  const { readFileSync } = await import("node:fs");
  const selfPath = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const ownSource = readFileSync(selfPath, "utf8");
  assert.deepEqual(findSecretMatches("scripts/ci/guard-secret-scan.test.mjs", ownSource), []);
});

// ---------------------------------------------------------------------------
// T248: CLI-level coverage of `readContentForScan`
// (`run-guard-secret-scan.mjs`) — the wiring above the pure matcher, which
// used to skip a `BINARY_EXTENSIONS` set before ever reading a file's bytes.
// These tests write REAL files to a real temp directory on disk (never
// inside the repository tree, so they can never themselves become a tracked
// fixture the guard would have to scan) and call the real, exported CLI
// function against real absolute paths — not the matcher, and not a
// fixture string handed to it in memory.
//
// The AWS access-key fixture is assembled from separate string pieces at
// runtime, same convention as every other fixture in this file, so the
// literal token never appears as a contiguous run of characters in this
// file's own tracked source.
// ---------------------------------------------------------------------------

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "guard-secret-scan-t248-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const ext of [".png", ".ttf", ".woff2", ".jar", ".pdf", ".zip"]) {
  test(`T248: readContentForScan reads a real ${ext} file's content — no longer skipped by extension`, () => {
    withTempDir((dir) => {
      const content = "const key = " + '"' + "AKIA" + "EXAMPLE1234567AB" + '";';
      const filePath = join(dir, `key${ext}`);
      writeFileSync(filePath, content, "utf8");

      const read = readContentForScan(filePath);

      assert.equal(read, content);
      const violations = findSecretMatches(`key${ext}`, read);
      assert.equal(violations.length, 1);
      assert.equal(violations[0].patternId, "aws-access-key-id");
    });
  });
}

// The firing this proves was WATCHED, not asserted from the production code
// alone: this test locally re-creates the OLD `BINARY_EXTENSIONS`
// skip-by-extension mechanism (T248 deleted the real one) against the exact
// same real file and shows the two behaviours disagree — the old shape
// genuinely returns `undefined` for the same bytes the shipped
// `readContentForScan` reads.
test("T248: reproduces the pre-fix asymmetry directly — the OLD skip-by-extension shape misses what the shipped code now catches", () => {
  withTempDir((dir) => {
    const content = "const key = " + '"' + "AKIA" + "EXAMPLE1234567AB" + '";';
    const filePath = join(dir, "key.ttf");
    writeFileSync(filePath, content, "utf8");

    function oldReadContentForScan(absolutePath) {
      const oldBinaryExtensions = new Set([".png", ".ttf", ".woff2", ".zip", ".jar", ".pdf"]);
      const dot = absolutePath.lastIndexOf(".");
      const ext = dot === -1 ? "" : absolutePath.slice(dot).toLowerCase();
      if (oldBinaryExtensions.has(ext)) return undefined;
      return readContentForScan(absolutePath);
    }

    const oldBehaviour = oldReadContentForScan(filePath);
    const newBehaviour = readContentForScan(filePath);

    assert.equal(oldBehaviour, undefined, "the old skip-by-extension shape must miss this file");
    assert.equal(newBehaviour, content, "the shipped code must read this same file's content");
    assert.deepEqual(findSecretMatches("key.ttf", oldBehaviour ?? ""), []);
    assert.equal(findSecretMatches("key.ttf", newBehaviour)[0].patternId, "aws-access-key-id");
  });
});

test("T248: readContentForScan still respects the 5 MiB size cap regardless of extension", () => {
  withTempDir((dir) => {
    const filePath = join(dir, "big.ttf");
    // Just over 5 MiB — the cap is about SIZE, not extension.
    const oversized = "a".repeat(5 * 1024 * 1024 + 1);
    writeFileSync(filePath, oversized, "utf8");

    const read = readContentForScan(filePath);

    assert.equal(read, undefined);
  });
});

test("T248: readContentForScan returns undefined for a path that does not exist (no I/O throw escapes)", () => {
  withTempDir((dir) => {
    const missing = join(dir, "does-not-exist.ttf");
    assert.equal(readContentForScan(missing), undefined);
  });
});

test("T248: running the real guard's CLI against the real, committed tree still exits 0 and reports every tracked file scanned (no false positive on real tracked binary assets, no extension skipped any more)", () => {
  const result = execFileSync(process.execPath, ["scripts/ci/run-guard-secret-scan.mjs"], {
    encoding: "utf8",
    cwd: new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  });
  assert.match(result, /guard-secret-scan: OK/);
  const match = result.match(/\((\d+) of (\d+) tracked files scanned\)/);
  assert.ok(match, `expected a "N of M tracked files scanned" summary, got: ${result}`);
  assert.equal(
    match[1],
    match[2],
    "every tracked file should be scanned now that no extension is skipped",
  );
});
