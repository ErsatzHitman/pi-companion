import assert from "node:assert/strict";
import test from "node:test";

import { findSecretMatches, SECRET_PATTERNS } from "./guard-secret-scan.mjs";

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
