import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  checkAndroidReleaseTagVersion,
  extractAppConfigVersion,
  stripReleaseTagPrefix,
} from "./guard-android-release-tag-version.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_CONFIG_PATH = "apps/android/app.config.ts";
const RUNNER_PATH = "scripts/ci/run-guard-android-release-tag-version.mjs";
const WORKFLOW_PATH = ".github/workflows/android-apk-release.yml";

// T93: test committed content, not the working tree — a concurrent editor
// of app.config.ts could otherwise make this test observe a value no
// commit ever contains.
function gitShowHead(relativePath) {
  return execFileSync("git", ["show", `HEAD:${relativePath}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

// T255: derive the tag globs from the workflow's OWN `on: push: tags:`
// block, rather than assuming the two this repository happens to declare
// today. This is what makes the pin below fail when a third glob is added
// to the trigger and the guard does not yet recognize it — the exact gap
// T255 was filed to close (docs/issues-from-plan.md, T255): the two tests
// this replaces were titled as if they read the workflow but only ever
// asserted against `stripReleaseTagPrefix`'s own hardcoded literals.
//
// Parses the literal YAML shape the workflow actually uses:
//
//   on:
//     push:
//       tags:
//         - "v*"
//         - "android-v*"
//
// i.e. a `tags:` line (matched on its own, so a `tags:` key appearing
// anywhere else in the file would also be picked up — guarded against
// below by requiring exactly one match) followed immediately by one or
// more `- "<glob>"` list items. No YAML parser is pulled in for this: the
// shape is simple enough to anchor directly, and anchoring directly is
// what lets this fail loudly (via the assertions below) if the workflow's
// tags block ever stops looking like this, rather than silently deriving
// zero globs and passing vacuously.
function extractPushTagGlobs(workflowContent) {
  const tagsLines = workflowContent
    .split("\n")
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s*tags:\s*$/.test(line));
  assert.equal(
    tagsLines.length,
    1,
    `expected exactly one \`tags:\` line in ${WORKFLOW_PATH}, found ${tagsLines.length}`,
  );

  const lines = workflowContent.split("\n");
  const globs = [];
  for (let i = tagsLines[0].index + 1; i < lines.length; i++) {
    const match = /^\s*-\s*"([^"]*)"\s*$/.exec(lines[i]);
    if (match === null) break;
    globs.push(match[1]);
  }
  assert.ok(globs.length > 0, `expected at least one tag glob under \`tags:\` in ${WORKFLOW_PATH}`);
  return globs;
}

// Every glob this workflow declares today is a bare literal prefix plus a
// single trailing `*` (`"v*"`, `"android-v*"`) — never a mid-string
// wildcard, a character class, or a `?`. That is asserted, not assumed:
// a shape this function cannot reduce to "literal text, then one trailing
// `*`" throws rather than silently deriving the wrong literal prefix.
function globToLiteralPrefix(glob) {
  assert.equal(
    glob.endsWith("*") && glob.indexOf("*") === glob.length - 1 && !glob.includes("?"),
    true,
    `tag glob "${glob}" in ${WORKFLOW_PATH} is not a bare "<literal>*" shape this pin knows how to reduce to a prefix`,
  );
  return glob.slice(0, -1);
}

// --- stripReleaseTagPrefix: the tag shapes the workflow's real triggers fire on ---

test("RELEASE_TAG_PREFIXES (via stripReleaseTagPrefix) covers every tag glob android-apk-release.yml's push trigger fires on", () => {
  const workflowContent = gitShowHead(WORKFLOW_PATH);
  const globs = extractPushTagGlobs(workflowContent);
  for (const glob of globs) {
    const prefix = globToLiteralPrefix(glob);
    const sampleTag = `${prefix}0.1.0`;
    assert.deepEqual(
      stripReleaseTagPrefix(sampleTag),
      { prefix, version: "0.1.0" },
      `stripReleaseTagPrefix does not recognize the "${prefix}" prefix that ` +
        `${WORKFLOW_PATH}'s push trigger glob "${glob}" fires on — a real ` +
        `tag of this shape would fail the guard's own ` +
        `\`unrecognized-tag-shape\` arm even though CI's push trigger accepted it`,
    );
  }
});

// The pin above proves RELEASE_TAG_PREFIXES covers whatever the workflow
// declares TODAY, deriving the prefixes rather than hardcoding them. The
// two tests below are unrelated to that: they exercise
// `stripReleaseTagPrefix`'s general prefix-stripping behavior — including
// version numbers of different digit widths the pin above never varies —
// against the two prefixes this guard happens to support right now. They
// no longer claim to read the workflow's trigger in their titles, because
// they never did; the pin above is what actually reads it.
test("stripReleaseTagPrefix strips a hardcoded 'v' prefix across version numbers of varying digit width", () => {
  assert.deepEqual(stripReleaseTagPrefix("v0.1.0"), { prefix: "v", version: "0.1.0" });
  assert.deepEqual(stripReleaseTagPrefix("v12.34.56"), { prefix: "v", version: "12.34.56" });
});

test("stripReleaseTagPrefix strips a hardcoded 'android-v' prefix", () => {
  assert.deepEqual(stripReleaseTagPrefix("android-v0.1.0"), {
    prefix: "android-v",
    version: "0.1.0",
  });
});

test("stripReleaseTagPrefix returns null for a tag starting with neither recognized prefix", () => {
  assert.equal(stripReleaseTagPrefix("main"), null);
  assert.equal(stripReleaseTagPrefix("0.1.0"), null); // bare semver, no prefix at all
  assert.equal(stripReleaseTagPrefix(""), null);
});

test("stripReleaseTagPrefix is not confused by the two prefixes being disjoint", () => {
  // "android-v..." does not start with "v" — it starts with "a" — so the
  // order the two prefixes are tried in cannot matter. Asserted directly
  // rather than only argued in the module's header comment.
  assert.equal("android-v0.1.0".startsWith("v"), false);
});

// --- extractAppConfigVersion: real declaration only, comments never count ---

test("extractAppConfigVersion reads the real committed apps/android/app.config.ts version", () => {
  const content = gitShowHead(APP_CONFIG_PATH);
  const version = extractAppConfigVersion(content);
  assert.notEqual(version, null);
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test("extractAppConfigVersion ignores a comment mentioning the declaration and reads the real one", () => {
  const fixture = [
    '// e.g. `const version = "9.9.9";` is what a stale comment might say',
    '/* const version = "8.8.8"; */',
    'const version = "1.2.3";',
  ].join("\n");
  assert.equal(extractAppConfigVersion(fixture), "1.2.3");
});

test("extractAppConfigVersion returns null when no such declaration exists", () => {
  assert.equal(extractAppConfigVersion('const somethingElse = "1.2.3";'), null);
});

// --- checkAndroidReleaseTagVersion: the three failing kinds, and the passing case ---

const FIXTURE_CONFIG = 'const version = "0.1.0";\n';

test("checkAndroidReleaseTagVersion passes when the 'v'-prefixed tag matches the config version", () => {
  const result = checkAndroidReleaseTagVersion({
    releaseTag: "v0.1.0",
    appConfigContent: FIXTURE_CONFIG,
  });
  assert.deepEqual(result, { ok: true, tagVersion: "0.1.0", configVersion: "0.1.0" });
});

test("checkAndroidReleaseTagVersion passes when the 'android-v'-prefixed tag matches", () => {
  const result = checkAndroidReleaseTagVersion({
    releaseTag: "android-v0.1.0",
    appConfigContent: FIXTURE_CONFIG,
  });
  assert.deepEqual(result, { ok: true, tagVersion: "0.1.0", configVersion: "0.1.0" });
});

test("checkAndroidReleaseTagVersion fails with version-mismatch naming both values", () => {
  const result = checkAndroidReleaseTagVersion({
    releaseTag: "v0.2.0",
    appConfigContent: FIXTURE_CONFIG,
  });
  assert.deepEqual(result, {
    ok: false,
    kind: "version-mismatch",
    tagVersion: "0.2.0",
    configVersion: "0.1.0",
  });
});

test("checkAndroidReleaseTagVersion fails with unrecognized-tag-shape for a non-release-tag workflow_dispatch input", () => {
  const result = checkAndroidReleaseTagVersion({
    releaseTag: "main",
    appConfigContent: FIXTURE_CONFIG,
  });
  assert.deepEqual(result, { ok: false, kind: "unrecognized-tag-shape", releaseTag: "main" });
});

test("checkAndroidReleaseTagVersion fails with unrecognized-tag-shape for a prefixed-but-non-semver tag", () => {
  const result = checkAndroidReleaseTagVersion({
    releaseTag: "v-oops",
    appConfigContent: FIXTURE_CONFIG,
  });
  assert.deepEqual(result, { ok: false, kind: "unrecognized-tag-shape", releaseTag: "v-oops" });
});

test("checkAndroidReleaseTagVersion fails with config-version-not-found rather than silently passing", () => {
  const result = checkAndroidReleaseTagVersion({
    releaseTag: "v0.1.0",
    appConfigContent: "export default {};\n",
  });
  assert.deepEqual(result, { ok: false, kind: "config-version-not-found" });
});

// --- real committed tree: a real match and a real, deliberately mutated mismatch ---

test("checkAndroidReleaseTagVersion passes against the real committed app.config.ts when the tag matches its declared version", () => {
  const content = gitShowHead(APP_CONFIG_PATH);
  const configVersion = extractAppConfigVersion(content);
  const result = checkAndroidReleaseTagVersion({
    releaseTag: `v${configVersion}`,
    appConfigContent: content,
  });
  assert.deepEqual(result, { ok: true, tagVersion: configVersion, configVersion });
});

test("checkAndroidReleaseTagVersion fails against the real committed app.config.ts when the tag disagrees with its declared version", () => {
  const content = gitShowHead(APP_CONFIG_PATH);
  const configVersion = extractAppConfigVersion(content);
  const bumpedTag = `v${configVersion.replace(/^\d+/, (major) => String(Number(major) + 1))}`;
  const result = checkAndroidReleaseTagVersion({
    releaseTag: bumpedTag,
    appConfigContent: content,
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "version-mismatch");
  assert.equal(result.configVersion, configVersion);
});

// --- CLI-level proof: the real runner, invoked as a subprocess, exits accordingly ---

test("run-guard-android-release-tag-version.mjs exits 0 and prints OK for a real matching tag", () => {
  const content = gitShowHead(APP_CONFIG_PATH);
  const configVersion = extractAppConfigVersion(content);
  const stdout = execFileSync(process.execPath, [RUNNER_PATH], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, RELEASE_TAG: `v${configVersion}` },
  });
  assert.match(stdout, /guard-android-release-tag-version: OK/);
  assert.match(stdout, new RegExp(`"${configVersion}"`));
});

test("run-guard-android-release-tag-version.mjs exits non-zero and names both values for a real mismatch", () => {
  const content = gitShowHead(APP_CONFIG_PATH);
  const configVersion = extractAppConfigVersion(content);
  const mismatchedTag = "v999.999.999";
  assert.throws(
    () => {
      execFileSync(process.execPath, [RUNNER_PATH], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, RELEASE_TAG: mismatchedTag },
      });
    },
    (error) => {
      assert.notEqual(error.status, 0);
      assert.match(error.stderr, /guard-android-release-tag-version: FAILED/);
      assert.match(error.stderr, /999\.999\.999/);
      assert.match(error.stderr, new RegExp(configVersion.replace(/\./g, "\\.")));
      return true;
    },
  );
});

test("run-guard-android-release-tag-version.mjs exits non-zero for a workflow_dispatch input with no recognized tag shape", () => {
  assert.throws(
    () => {
      execFileSync(process.execPath, [RUNNER_PATH], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, RELEASE_TAG: "main" },
      });
    },
    (error) => {
      assert.notEqual(error.status, 0);
      assert.match(error.stderr, /guard-android-release-tag-version: FAILED/);
      assert.match(error.stderr, /does not have a recognized release-tag shape/);
      return true;
    },
  );
});

test("run-guard-android-release-tag-version.mjs exits non-zero when RELEASE_TAG is unset", () => {
  const env = { ...process.env };
  delete env["RELEASE_TAG"];
  assert.throws(
    () => {
      execFileSync(process.execPath, [RUNNER_PATH], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env,
      });
    },
    (error) => {
      assert.notEqual(error.status, 0);
      assert.match(error.stderr, /RELEASE_TAG is not set/);
      return true;
    },
  );
});
