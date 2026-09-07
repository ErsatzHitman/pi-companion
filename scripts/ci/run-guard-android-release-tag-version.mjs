#!/usr/bin/env node
// CLI entry point for the Android release tag/version guard (T247). Run
// from the repository root; wired into
// `.github/workflows/android-apk-release.yml`'s `publish-android-apk` job,
// which sets `RELEASE_TAG` in its own top-level `env:` block (from
// `github.ref_name` on a `push` trigger, or `github.event.inputs.tag` on a
// `workflow_dispatch` run) before this step runs.
//
// See scripts/ci/guard-android-release-tag-version.mjs for the checked
// rule, the tag shapes this derives from the workflow's real triggers, and
// why the comparison runs here (on the GitHub runner) rather than inside
// `apps/android/app.config.ts` (evaluated by EAS on its own build machine,
// which never sees this runner's shell environment at all).

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { checkAndroidReleaseTagVersion } from "./guard-android-release-tag-version.mjs";

const APP_CONFIG_PATH = "apps/android/app.config.ts";

export function main() {
  const releaseTag = process.env["RELEASE_TAG"];
  if (!releaseTag) {
    console.error("guard-android-release-tag-version: FAILED");
    console.error(
      "  RELEASE_TAG is not set in the environment. This guard must run inside " +
        "android-apk-release.yml's publish-android-apk job, after that workflow's own " +
        "top-level `env:` block has computed RELEASE_TAG.",
    );
    process.exitCode = 1;
    return;
  }

  const appConfigContent = readFileSync(APP_CONFIG_PATH, "utf8");
  const result = checkAndroidReleaseTagVersion({ releaseTag, appConfigContent });

  if (result.ok) {
    console.log(
      `guard-android-release-tag-version: OK — tag "${releaseTag}" declares version ` +
        `"${result.tagVersion}", matching ${APP_CONFIG_PATH}'s own "version": ` +
        `"${result.configVersion}".`,
    );
    return;
  }

  console.error("guard-android-release-tag-version: FAILED");
  if (result.kind === "unrecognized-tag-shape") {
    console.error(
      `  RELEASE_TAG "${result.releaseTag}" does not have a recognized release-tag shape. ` +
        `Expected a "v<major>.<minor>.<patch>" or "android-v<major>.<minor>.<patch>" tag ` +
        `(the two prefixes android-apk-release.yml's "push: tags:" trigger fires on). If this ` +
        `is a workflow_dispatch run, pass an existing tag matching one of those shapes, not an ` +
        `arbitrary ref or branch name.`,
    );
  } else if (result.kind === "config-version-not-found") {
    console.error(
      `  Could not find a "const version = \\"...\\";" declaration in ${APP_CONFIG_PATH}. This ` +
        `guard checked nothing, so it cannot be passing — either that declaration moved/changed ` +
        `shape, or ${APP_CONFIG_PATH} could not be read.`,
    );
  } else if (result.kind === "version-mismatch") {
    console.error(
      `  Tag "${releaseTag}" declares version "${result.tagVersion}", but ${APP_CONFIG_PATH}'s ` +
        `own "version" is "${result.configVersion}". Building this tag would reuse ` +
        `${APP_CONFIG_PATH}'s versionCode for "${result.configVersion}" under a tag that says ` +
        `"${result.tagVersion}" — the next install would either collide with a versionCode ` +
        `already on a tester's device (INSTALL_FAILED_VERSION_DOWNGRADE) or ship an APK whose ` +
        `declared version disagrees with the tag that named it. Bump ${APP_CONFIG_PATH}'s ` +
        `"version" to "${result.tagVersion}" (or retag) before releasing.`,
    );
  }
  process.exitCode = 1;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
