// T247: CI guard — fail an Android release whose tag disagrees with
// `apps/android/app.config.ts`'s own `version`.
//
// ## The defect this closes
//
// T235 derives `android.versionCode` from `apps/android/app.config.ts`'s own
// semver `version` string (see that file's own in-file decision record,
// directly above `computeVersionCodeFromSemver`). That fixes the
// second-install collision for any two releases that declare DIFFERENT
// versions — but nothing makes a human actually bump `version` before
// pushing a new release tag. Tagging `v0.2.0` while the file still says
// `"0.1.0"` rebuilds the exact previous `versionCode`, and the device
// refuses the install with `INSTALL_FAILED_VERSION_DOWNGRADE` — the
// original defect T235 fixed, reached again by a different route. T235's
// own decision record names this exact gap and files it for "whoever next
// touches `android-apk-release.yml`" — this task.
//
// ## Why this runs on the GitHub runner, and never inside `app.config.ts`
//
// EAS evaluates `app.config.ts` on ITS OWN build machine, against the
// uploaded archive — never against the GitHub Actions runner's shell
// environment. That is also why T235 derived `versionCode` from `version`
// rather than from the tag in the first place: nothing inside
// `app.config.ts` can read `RELEASE_TAG`. So the comparison this guard
// makes has to happen on the runner, before the archive is ever built —
// which is exactly where `.github/workflows/android-apk-release.yml` wires
// `run-guard-android-release-tag-version.mjs` in, ahead of every EAS step.
//
// ## Guard, not an inline `run:` step
//
// A `scripts/ci` guard is testable from this environment — fed a real tag
// string and a real `app.config.ts`, its result can be asserted and its
// failing/passing arms watched directly. An inline shell comparison living
// only in the workflow YAML cannot be executed here at all (this
// environment never runs a GitHub Actions job), so its correctness could
// only ever be reasoned about, not watched — which is exactly what this
// task's own acceptance criteria ("watched failing on a real mismatch",
// "watched passing" on a real match) rule out. The workflow step that calls
// this guard is therefore a single `run: node scripts/ci/run-guard-
// android-release-tag-version.mjs` line with no comparison logic of its
// own.
//
// ## Tag shapes: derived from the workflow's own triggers, not assumed
//
// `.github/workflows/android-apk-release.yml`'s trigger block is:
//
//   on:
//     push:
//       tags:
//         - "v*"
//         - "android-v*"
//     workflow_dispatch:
//       inputs:
//         tag:
//           description: "Existing tag to build (e.g. v0.1.0)"
//           required: true
//           type: string
//
// A `push` run's `RELEASE_TAG` (the workflow's own `env:` block sets it to
// `github.ref_name`) is therefore GUARANTEED by GitHub's own tag-glob
// matching to start with either literal `v` or literal `android-v` — no
// third shape can ever reach this job from a `push` trigger. The two
// prefixes are disjoint (`"android-v..."` does not start with `"v"` — it
// starts with `"a"`), so stripping order between them does not matter; both
// are tried below purely for clarity, not because one could shadow the
// other.
//
// A `workflow_dispatch` run's `RELEASE_TAG` (the same `env:` block falls
// back to `github.event.inputs.tag`) carries NO such guarantee: it is a
// free-text `type: string` input, and GitHub does not validate it against
// the `push` trigger's tag globs. An operator can type anything — an
// existing release tag (the documented, intended use), a bare version with
// no prefix, a branch name, a typo. `stripReleaseTagPrefix` returns `null`
// for anything that starts with neither recognized prefix, and this
// guard's caller treats that as a loud, distinct failure (kind
// `"unrecognized-tag-shape"`) rather than either extreme the task brief
// warns against:
//   - NOT "fail every manual run" — a `workflow_dispatch` run built against
//     a real `v0.1.0`-shaped tag (the documented, intended use of that
//     input) passes through exactly like a `push` run and is compared
//     normally.
//   - NOT "silently skip" — the check-that-cannot-fail shape this
//     repository's CLAUDE.md catalogues. A malformed manual input (no
//     recognized prefix at all) is exactly the shape of operator mistake
//     this guard exists to catch just as much as a real version mismatch
//     is, so it fails loudly with its own message naming the unexpected
//     tag, rather than reporting nothing.
//
// Pure, dependency-free check functions only. `run-guard-android-release-
// tag-version.mjs` is the CLI entry point CI actually runs, wired into
// `.github/workflows/android-apk-release.yml`'s `publish-android-apk` job.

import { stripComments } from "./source-comment-stripper.mjs";

/** Tried in this order for clarity only — see this file's header for why
 * the two are disjoint and order cannot matter. */
const RELEASE_TAG_PREFIXES = ["android-v", "v"];

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * @param {string} tag the raw tag/ref-name string (`RELEASE_TAG`)
 * @returns {{ prefix: string, version: string } | null} the matched prefix
 *   and the text after it, or `null` when `tag` starts with neither
 *   recognized release-tag prefix
 */
export function stripReleaseTagPrefix(tag) {
  for (const prefix of RELEASE_TAG_PREFIXES) {
    if (tag.startsWith(prefix)) {
      return { prefix, version: tag.slice(prefix.length) };
    }
  }
  return null;
}

/**
 * Extracts `apps/android/app.config.ts`'s own `const version = "...";`
 * declaration. Comments are stripped first (via the shared,
 * order-independent `stripComments` — see `source-comment-stripper.mjs`)
 * so a doc comment merely mentioning `const version = "..."` text (this
 * file's own decision record does, in prose, describing the declaration)
 * can never be mistaken for the real one.
 * @param {string} appConfigContent raw `apps/android/app.config.ts` source
 * @returns {string | null} the declared version string, or `null` when no
 *   such declaration is found in the real (non-comment) source
 */
export function extractAppConfigVersion(appConfigContent) {
  const code = stripComments(appConfigContent);
  const match = /(?:^|\n)\s*const version = "([^"]*)";/.exec(code);
  return match === null ? null : match[1];
}

/**
 * @typedef {
 *   | { ok: true, tagVersion: string, configVersion: string }
 *   | { ok: false, kind: "unrecognized-tag-shape", releaseTag: string }
 *   | { ok: false, kind: "config-version-not-found" }
 *   | { ok: false, kind: "version-mismatch", tagVersion: string, configVersion: string }
 * } AndroidReleaseTagVersionResult
 */

/**
 * @param {{ releaseTag: string, appConfigContent: string }} input
 * @returns {AndroidReleaseTagVersionResult}
 */
export function checkAndroidReleaseTagVersion({ releaseTag, appConfigContent }) {
  const stripped = stripReleaseTagPrefix(releaseTag);
  // A stripped-but-non-semver remainder (e.g. a `workflow_dispatch` input
  // of `"v-oops"` or `"v"`) is exactly as unrecognized as no prefix at all
  // — checked here, before any comparison, so it is reported as a
  // malformed tag rather than a misleading "mismatch" against whatever
  // `app.config.ts` happens to declare.
  if (stripped === null || !SEMVER_PATTERN.test(stripped.version)) {
    return { ok: false, kind: "unrecognized-tag-shape", releaseTag };
  }
  const tagVersion = stripped.version;

  const configVersion = extractAppConfigVersion(appConfigContent);
  // A guard that cannot find the thing it is supposed to compare must
  // never report success by default (CLAUDE.md, "A fix that no test can
  // fail is not a fix") — fail loudly rather than silently treating
  // "nothing found" as "nothing wrong".
  if (configVersion === null) {
    return { ok: false, kind: "config-version-not-found" };
  }

  if (tagVersion !== configVersion) {
    return { ok: false, kind: "version-mismatch", tagVersion, configVersion };
  }

  return { ok: true, tagVersion, configVersion };
}
