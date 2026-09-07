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

// T93: test committed content, not the working tree — a concurrent editor
// of app.config.ts could otherwise make this test observe a value no
// commit ever contains.
function gitShowHead(relativePath) {
  return execFileSync("git", ["show", `HEAD:${relativePath}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

// --- stripReleaseTagPrefix: the tag shapes the workflow's real triggers fire on ---

test("stripReleaseTagPrefix strips the 'v' prefix android-apk-release.yml's push trigger fires on", () => {
  assert.deepEqual(stripReleaseTagPrefix("v0.1.0"), { prefix: "v", version: "0.1.0" });
  assert.deepEqual(stripReleaseTagPrefix("v12.34.56"), { prefix: "v", version: "12.34.56" });
});

test("stripReleaseTagPrefix strips the 'android-v' prefix android-apk-release.yml's push trigger fires on", () => {
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
